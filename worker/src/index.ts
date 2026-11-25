/**
 * Cloudflare Worker REST API & Cron Trigger implementation for Digital Logbook.
 * Uses Cloudflare D1 (SQLite), WebCrypto PBKDF2 password hashing, HttpOnly sessions,
 * and OneSignal REST API push notifications.
 */

import {
  calculateExpiryDate,
  calculatePaymentMetrics,
  formatDurationLabel,
  getTodayIso,
} from '../../shared/paymentCalc.ts';

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean }>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface ScheduledEvent {
  cron: string;
  scheduledTime: number;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface Env {
  DB: D1Database;
  ONESIGNAL_APP_ID?: string;
  ONESIGNAL_REST_API_KEY?: string;
  ALLOWED_ORIGIN?: string;
}

const COOKIE_NAME = 'dl_session';
const PBKDF2_ITERATIONS = 100000;

function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin') || '';
  const allowed = env.ALLOWED_ORIGIN ? [env.ALLOWED_ORIGIN] : [];
  if (origin && (allowed.length === 0 || allowed.includes(origin))) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    };
  }
  return {};
}

async function hashSecretWebCrypto(secret: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const hashHex = Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `pbkdf2:${saltHex}:${hashHex}`;
}

async function verifySecretWebCrypto(secret: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'pbkdf2') return false;
  const [, saltHex, hashHex] = parts;
  const salt = new Uint8Array((saltHex.match(/.{2}/g) || []).map((h) => parseInt(h, 16)));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  const derivedHex = Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (derivedHex.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < derivedHex.length; i++) {
    diff |= derivedHex.charCodeAt(i) ^ hashHex.charCodeAt(i);
  }
  return diff === 0;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

async function runScheduledExpiryChecks(env: Env): Promise<void> {
  const today = getTodayIso();
  const { results: occupants } = await env.DB.prepare(
    `SELECT o.id, o.full_name, p.name AS property_name, r.room_number,
            lp.commencement_date, lp.expiry_date, lp.duration_months
     FROM occupants o
     JOIN properties p ON p.id = o.property_id
     JOIN rooms r ON r.id = o.room_id
     LEFT JOIN payment_periods lp ON lp.id = (
       SELECT pp.id FROM payment_periods pp WHERE pp.occupant_id = o.id
       ORDER BY pp.expiry_date DESC, pp.created_at DESC LIMIT 1
     )
     WHERE o.is_archived = 0`,
  ).all<{
    id: string;
    full_name: string;
    property_name: string;
    room_number: string;
    commencement_date: string | null;
    expiry_date: string | null;
    duration_months: number | null;
  }>();

  let expiringThisMonthCount = 0;
  const appId = (env.ONESIGNAL_APP_ID || '').trim();
  const restKey = (env.ONESIGNAL_REST_API_KEY || '').trim();

  const sendPush = async (title: string, message: string) => {
    if (!appId || !restKey) {
      return { status: 'skipped_not_configured', id: null, error: 'Missing OneSignal secrets' };
    }
    const resp = await fetch('https://api.onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Basic ${restKey}`,
      },
      body: JSON.stringify({
        app_id: appId,
        headings: { en: title },
        contents: { en: message },
        included_segments: ['Subscribed Users'],
      }),
    });
    const body = (await resp.json()) as { id?: string; errors?: unknown };
    return resp.ok
      ? { status: 'sent', id: body.id ?? null, error: null }
      : { status: 'failed', id: null, error: JSON.stringify(body.errors ?? body) };
  };

  for (const occ of occupants) {
    const metrics = calculatePaymentMetrics(occ.commencement_date, occ.expiry_date, occ.duration_months, today);
    if (metrics.status === 'PAID' && metrics.isExpiringThisMonth) {
      expiringThisMonthCount++;
    }

    let ruleType: string | null = null;
    let message = '';
    if (occ.expiry_date === today) {
      ruleType = 'expiry_day';
      message = `PAYMENT EXPIRY NOTICE: ${occ.full_name}, ${occ.room_number}, payment period expires today (${occ.expiry_date}).`;
    } else if (metrics.status === 'PAID' && [30, 14, 7].includes(metrics.daysRemaining)) {
      ruleType = `${metrics.daysRemaining}_days`;
      message = `PAYMENT EXPIRY REMINDER: ${occ.full_name}, ${occ.room_number}, has ${metrics.daysRemaining} days remaining on the current payment period.`;
    }

    if (!ruleType) continue;
    const dedupeKey = `${occ.id}:${ruleType}:${today}`;
    const exists = await env.DB.prepare('SELECT id FROM notifications WHERE dedupe_key = ?')
      .bind(dedupeKey)
      .first();
    if (exists) continue;

    const push = await sendPush('Payment Expiry Reminder', message);
    await env.DB.prepare(
      `INSERT INTO notifications (id, occupant_id, rule_type, reminder_date, dedupe_key, title, message, channel, delivery_status, onesignal_notification_id, error_message, recipient_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'onesignal', ?, ?, ?, 0, ?)`,
    )
      .bind(
        `ntf_${crypto.randomUUID()}`,
        occ.id,
        ruleType,
        today,
        dedupeKey,
        'Payment Expiry Reminder',
        message,
        push.status,
        push.id,
        push.error,
        new Date().toISOString(),
      )
      .run();
  }

  // Monthly summary on the 1st of the month
  if (today.endsWith('-01')) {
    const dedupeKey = `MONTHLY:${today.slice(0, 7)}:1`;
    const exists = await env.DB.prepare('SELECT id FROM notifications WHERE dedupe_key = ?')
      .bind(dedupeKey)
      .first();
    if (!exists) {
      const msg = `MONTHLY PAYMENT REPORT: ${expiringThisMonthCount} occupants have payments expiring this month.`;
      const push = await sendPush('Monthly Payment Report', msg);
      await env.DB.prepare(
        `INSERT INTO notifications (id, occupant_id, rule_type, reminder_date, dedupe_key, title, message, channel, delivery_status, onesignal_notification_id, error_message, recipient_count, created_at)
         VALUES (?, NULL, 'monthly_summary', ?, ?, ?, ?, 'onesignal', ?, ?, ?, 0, ?)`,
      )
        .bind(
          `ntf_${crypto.randomUUID()}`,
          today,
          dedupeKey,
          'Monthly Payment Report',
          msg,
          push.status,
          push.id,
          push.error,
          new Date().toISOString(),
        )
        .run();
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/api/auth/status' && request.method === 'GET') {
        const countRow = await env.DB.prepare('SELECT COUNT(*) AS count FROM administrators').first<{ count: number }>();
        const initialized = (countRow?.count ?? 0) > 0;
        if (!initialized) {
          return jsonResponse({ initialized: false, authenticated: false, admin: null }, 200, cors);
        }
        const token = getCookie(request, COOKIE_NAME);
        if (!token) {
          return jsonResponse({ initialized: true, authenticated: false, admin: null }, 200, cors);
        }
        const tokenHash = await sha256Hex(token);
        const session = await env.DB.prepare(
          `SELECT a.id, a.full_name, a.email, a.username, a.session_timeout_minutes, a.created_at
           FROM sessions s JOIN administrators a ON a.id = s.admin_id
           WHERE s.token_hash = ?`,
        )
          .bind(tokenHash)
          .first<{
            id: string;
            full_name: string;
            email: string;
            username: string;
            session_timeout_minutes: number;
            created_at: string;
          }>();
        if (!session) {
          return jsonResponse({ initialized: true, authenticated: false, admin: null }, 200, cors);
        }
        return jsonResponse(
          {
            initialized: true,
            authenticated: true,
            admin: {
              id: session.id,
              fullName: session.full_name,
              email: session.email,
              username: session.username,
              sessionTimeoutMinutes: session.session_timeout_minutes,
              createdAt: session.created_at,
            },
          },
          200,
          cors,
        );
      }

      if (path === '/api/auth/setup' && request.method === 'POST') {
        const countRow = await env.DB.prepare('SELECT COUNT(*) AS count FROM administrators').first<{ count: number }>();
        if ((countRow?.count ?? 0) > 0) {
          return jsonResponse({ error: 'Administrator already exists.' }, 403, cors);
        }
        const body = (await request.json()) as {
          fullName?: string;
          email?: string;
          username?: string;
          password?: string;
        };
        if (!body.fullName || !body.email || !body.password || body.password.length < 8) {
          return jsonResponse({ error: 'Invalid setup payload.' }, 400, cors);
        }
        const adminId = `adm_${crypto.randomUUID()}`;
        const recoveryKey = crypto.randomUUID().toUpperCase().slice(0, 19);
        const passwordHash = await hashSecretWebCrypto(body.password);
        const recoveryHash = await hashSecretWebCrypto(recoveryKey);
        const now = new Date().toISOString();
        await env.DB.prepare(
          `INSERT INTO administrators (id, full_name, email, username, password_hash, recovery_key_hash, session_timeout_minutes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 60, ?, ?)`,
        )
          .bind(
            adminId,
            body.fullName.trim(),
            body.email.trim().toLowerCase(),
            (body.username || body.email.split('@')[0]).trim().toLowerCase(),
            passwordHash,
            recoveryHash,
            now,
            now,
          )
          .run();
        return jsonResponse({ success: true, recoveryKey }, 201, cors);
      }

      if (path === '/api/auth/login' && request.method === 'POST') {
        const body = (await request.json()) as { identifier?: string; password?: string };
        const id = (body.identifier || '').trim().toLowerCase();
        const admin = await env.DB.prepare(
          'SELECT * FROM administrators WHERE LOWER(email) = ? OR LOWER(username) = ? LIMIT 1',
        )
          .bind(id, id)
          .first<{ id: string; password_hash: string; full_name: string; email: string; username: string }>();
        if (!admin || !(await verifySecretWebCrypto(body.password || '', admin.password_hash))) {
          return jsonResponse({ error: 'Invalid credentials.' }, 401, cors);
        }
        const rawToken = crypto.randomUUID() + crypto.randomUUID();
        const tokenHash = await sha256Hex(rawToken);
        const now = new Date();
        const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
        await env.DB.prepare(
          `INSERT INTO sessions (id, token_hash, admin_id, expires_at, last_activity_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
          .bind(`ses_${crypto.randomUUID()}`, tokenHash, admin.id, expires, now.toISOString(), now.toISOString())
          .run();

        return jsonResponse(
          { admin: { id: admin.id, fullName: admin.full_name, email: admin.email, username: admin.username } },
          200,
          {
            ...cors,
            'Set-Cookie': `${COOKIE_NAME}=${encodeURIComponent(rawToken)}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=604800`,
          },
        );
      }

      // Utility check for expiry calculation consistency
      if (path === '/api/health') {
        return jsonResponse(
          {
            status: 'ok',
            sampleCalc: calculateExpiryDate('2026-01-15', 12),
            label: formatDurationLabel(12),
          },
          200,
          cors,
        );
      }

      return jsonResponse({ error: 'Endpoint not found on Worker preview.' }, 404, cors);
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : 'Worker error' }, 500, cors);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduledExpiryChecks(env));
  },
};
