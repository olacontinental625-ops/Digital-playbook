import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type Database from 'better-sqlite3';
import { getDb, generateId, writeAuditLog } from './db.ts';
import type { AdminUser } from '../shared/types.ts';

const COOKIE_NAME = 'dl_session';
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const MAX_SESSION_DAYS = 7;

export interface AdminRow {
  id: string;
  full_name: string;
  email: string;
  username: string;
  password_hash: string;
  recovery_key_hash: string;
  session_timeout_minutes: number;
  created_at: string;
  updated_at: string;
}

export interface AuthenticatedRequest extends Request {
  admin?: AdminUser;
  sessionId?: string;
}

export function hashSecret(secret: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(secret, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifySecret(secret: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  try {
    const keyBuf = Buffer.from(keyHex, 'hex');
    const derived = crypto.scryptSync(secret, salt, 64);
    if (keyBuf.length !== derived.length) return false;
    return crypto.timingSafeEqual(keyBuf, derived);
  } catch {
    return false;
  }
}

export function generateRecoveryKey(): string {
  const hex = crypto.randomBytes(12).toString('hex').toUpperCase();
  return hex.match(/.{1,4}/g)?.join('-') ?? hex;
}

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) result[key] = decodeURIComponent(val);
  }
  return result;
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const maxAgeSec = MAX_SESSION_DAYS * 24 * 60 * 60;
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${maxAgeSec}`,
  ];
  if (isHttps) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(req: Request, res: Response): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'Max-Age=0'];
  if (isHttps) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function hasAdministrator(db: Database.Database): boolean {
  const row = db.prepare('SELECT COUNT(*) AS count FROM administrators').get() as { count: number };
  return row.count > 0;
}

export function toAdminUser(row: AdminRow): AdminUser {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    username: row.username,
    sessionTimeoutMinutes: row.session_timeout_minutes,
    createdAt: row.created_at,
  };
}

export function createSession(db: Database.Database, adminId: string, req: Request): { token: string; sessionId: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashSessionToken(token);
  const sessionId = generateId('ses');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + MAX_SESSION_DAYS * 24 * 60 * 60 * 1000);

  db.prepare(
    `INSERT INTO sessions (id, token_hash, admin_id, expires_at, last_activity_at, user_agent, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    tokenHash,
    adminId,
    expiresAt.toISOString(),
    now.toISOString(),
    String(req.headers['user-agent'] ?? '').slice(0, 250),
    getClientIp(req),
    now.toISOString(),
  );

  return { token, sessionId };
}

export function checkRateLimit(
  db: Database.Database,
  key: string,
): { allowed: boolean; retryAfterSeconds: number } {
  const row = db
    .prepare('SELECT attempts, locked_until FROM login_attempts WHERE attempt_key = ?')
    .get(key) as { attempts: number; locked_until: string | null } | undefined;

  if (!row || !row.locked_until) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const lockedMs = new Date(row.locked_until).getTime();
  const nowMs = Date.now();
  if (lockedMs > nowMs) {
    return { allowed: false, retryAfterSeconds: Math.ceil((lockedMs - nowMs) / 1000) };
  }

  // Lockout expired — reset counter
  db.prepare('DELETE FROM login_attempts WHERE attempt_key = ?').run(key);
  return { allowed: true, retryAfterSeconds: 0 };
}

export function recordFailedAttempt(db: Database.Database, key: string): { attempts: number; lockedUntil: string | null } {
  const now = new Date();
  const existing = db
    .prepare('SELECT attempts FROM login_attempts WHERE attempt_key = ?')
    .get(key) as { attempts: number } | undefined;

  const attempts = (existing?.attempts ?? 0) + 1;
  const lockedUntil =
    attempts >= MAX_LOGIN_ATTEMPTS
      ? new Date(now.getTime() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
      : null;

  db.prepare(
    `INSERT INTO login_attempts (attempt_key, attempts, locked_until, last_attempt_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(attempt_key) DO UPDATE SET
       attempts = excluded.attempts,
       locked_until = excluded.locked_until,
       last_attempt_at = excluded.last_attempt_at`,
  ).run(key, attempts, lockedUntil, now.toISOString());

  return { attempts, lockedUntil };
}

export function clearFailedAttempts(db: Database.Database, key: string): void {
  db.prepare('DELETE FROM login_attempts WHERE attempt_key = ?').run(key);
}

export function validateCsrfForCookieMutation(req: Request): boolean {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return true;
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return true;
  }
  if (req.headers['x-requested-with'] === 'DigitalLogbook') {
    return true;
  }
  const origin = req.headers.origin;
  const host = (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host;
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host) return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!validateCsrfForCookieMutation(req)) {
    res.status(403).json({ error: 'Cross-site request validation failed.' });
    return;
  }

  const db = getDb();
  const authHeader = req.headers.authorization;
  let token: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else {
    const cookies = parseCookies(req.headers.cookie);
    token = cookies[COOKIE_NAME];
  }

  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  const tokenHash = hashSessionToken(token);
  const row = db
    .prepare(
      `SELECT s.id AS session_id, s.expires_at, s.last_activity_at, a.*
       FROM sessions s
       JOIN administrators a ON a.id = s.admin_id
       WHERE s.token_hash = ?`,
    )
    .get(tokenHash) as (AdminRow & { session_id: string; expires_at: string; last_activity_at: string }) | undefined;

  if (!row) {
    clearSessionCookie(req, res);
    res.status(401).json({ error: 'Session is invalid or has ended.' });
    return;
  }

  const nowMs = Date.now();
  const expiresMs = new Date(row.expires_at).getTime();
  const lastActivityMs = new Date(row.last_activity_at).getTime();
  const idleLimitMs = Math.max(5, row.session_timeout_minutes) * 60 * 1000;

  if (nowMs > expiresMs || nowMs - lastActivityMs > idleLimitMs) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.session_id);
    clearSessionCookie(req, res);
    res.status(401).json({ error: 'Session expired due to inactivity. Please log in again.' });
    return;
  }

  // Update sliding activity timestamp
  db.prepare('UPDATE sessions SET last_activity_at = ? WHERE id = ?').run(
    new Date(nowMs).toISOString(),
    row.session_id,
  );

  req.admin = toAdminUser(row);
  req.sessionId = row.session_id;
  next();
}

export function cleanupExpiredSessions(db: Database.Database): void {
  const nowIso = new Date().toISOString();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowIso);
}

export function auditAdminEvent(
  db: Database.Database,
  adminName: string,
  action: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown> = {},
): void {
  writeAuditLog(db, adminName, action, entityType, entityId, details);
}
