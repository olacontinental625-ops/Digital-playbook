import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import {
  calculateExpiryDate,
  formatDurationLabel,
  getTodayIso,
} from './shared/paymentCalc.ts';
import { getDb, generateId, writeAuditLog } from './server/db.ts';
import {
  auditAdminEvent,
  checkRateLimit,
  cleanupExpiredSessions,
  clearFailedAttempts,
  clearSessionCookie,
  createSession,
  generateRecoveryKey,
  getClientIp,
  hasAdministrator,
  hashSecret,
  hashSessionToken,
  parseCookies,
  recordFailedAttempt,
  requireAuth,
  setSessionCookie,
  toAdminUser,
  validateCsrfForCookieMutation,
  verifySecret,
  type AdminRow,
  type AuthenticatedRequest,
} from './server/auth.ts';
import {
  clearSampleData,
  getDashboardSummary,
  getLogbookEntries,
  getPropertiesWithCounts,
  getRoomsWithOccupancy,
  getTransactionsList,
  seedSampleData,
} from './server/logbookData.ts';
import {
  dispatchOneSignalPush,
  getNotificationsHistory,
  getPushSubscriptions,
  runExpiryAndMonthlyChecks,
} from './server/notifications.ts';

const PORT = Number(process.env.PORT || 3000);

function cleanStr(val: unknown, maxLen = 500): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

function isIsoDate(val: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(val);
}

async function startServer() {
  const db = getDb();
  cleanupExpiredSessions(db);

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));

  // ---------------------------------------------------------------------------
  // PUBLIC AUTH & INITIAL SETUP ROUTES
  // ---------------------------------------------------------------------------

  app.get('/api/auth/status', (req, res) => {
    const initialized = hasAdministrator(db);
    if (!initialized) {
      res.json({ initialized: false, authenticated: false, admin: null });
      return;
    }

    const cookies = parseCookies(req.headers.cookie);
    const authHeader = req.headers.authorization;
    const token =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : cookies.dl_session;

    if (!token) {
      res.json({ initialized: true, authenticated: false, admin: null });
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
      res.json({ initialized: true, authenticated: false, admin: null });
      return;
    }

    const nowMs = Date.now();
    const idleLimitMs = Math.max(5, row.session_timeout_minutes) * 60 * 1000;
    if (nowMs > new Date(row.expires_at).getTime() || nowMs - new Date(row.last_activity_at).getTime() > idleLimitMs) {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(row.session_id);
      clearSessionCookie(req, res);
      res.json({ initialized: true, authenticated: false, admin: null });
      return;
    }

    db.prepare('UPDATE sessions SET last_activity_at = ? WHERE id = ?').run(
      new Date(nowMs).toISOString(),
      row.session_id,
    );

    res.json({
      initialized: true,
      authenticated: true,
      admin: toAdminUser(row),
    });
  });

  app.post('/api/auth/setup', (req, res) => {
    if (!validateCsrfForCookieMutation(req)) {
      res.status(403).json({ error: 'Cross-site request validation failed.' });
      return;
    }

    if (hasAdministrator(db)) {
      res.status(403).json({
        error: 'Administrator account already exists. Initial setup is permanently locked.',
      });
      return;
    }

    const fullName = cleanStr(req.body?.fullName, 120);
    const email = cleanStr(req.body?.email, 160).toLowerCase();
    const username = cleanStr(req.body?.username || email.split('@')[0], 80).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const confirmPassword = typeof req.body?.confirmPassword === 'string' ? req.body.confirmPassword : '';

    if (fullName.length < 2) {
      res.status(400).json({ error: 'Please enter the administrator full name.' });
      return;
    }
    if (!email.includes('@') || email.length < 5) {
      res.status(400).json({ error: 'Please enter a valid administrator email address.' });
      return;
    }
    if (username.length < 3 || !/^[a-z0-9._-]+$/.test(username)) {
      res.status(400).json({
        error: 'Username must be at least 3 characters (letters, numbers, dot, underscore, hyphen).',
      });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters long.' });
      return;
    }
    if (password !== confirmPassword) {
      res.status(400).json({ error: 'Password and confirmation do not match.' });
      return;
    }

    const adminId = generateId('adm');
    const nowIso = new Date().toISOString();
    const passwordHash = hashSecret(password);
    const recoveryKey = generateRecoveryKey();
    const recoveryKeyHash = hashSecret(recoveryKey);

    const createAdminTx = db.transaction(() => {
      if (hasAdministrator(db)) {
        throw new Error('ALREADY_INITIALIZED');
      }
      db.prepare(
        `INSERT INTO administrators (id, full_name, email, username, password_hash, recovery_key_hash, session_timeout_minutes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 60, ?, ?)`,
      ).run(adminId, fullName, email, username, passwordHash, recoveryKeyHash, nowIso, nowIso);
    });

    try {
      createAdminTx();
    } catch (err) {
      if (err instanceof Error && err.message === 'ALREADY_INITIALIZED') {
        res.status(403).json({ error: 'Administrator account already exists.' });
        return;
      }
      throw err;
    }

    const adminRow = db.prepare('SELECT * FROM administrators WHERE id = ?').get(adminId) as AdminRow;
    const { token } = createSession(db, adminId, req);
    setSessionCookie(req, res, token);
    auditAdminEvent(db, fullName, 'INITIAL_ADMIN_CREATED', 'administrator', adminId, { email, username });

    res.status(201).json({
      admin: toAdminUser(adminRow),
      recoveryKey,
    });
  });

  app.post('/api/auth/login', (req, res) => {
    if (!validateCsrfForCookieMutation(req)) {
      res.status(403).json({ error: 'Cross-site request validation failed.' });
      return;
    }

    if (!hasAdministrator(db)) {
      res.status(400).json({ error: 'No administrator account configured yet. Complete initial setup first.' });
      return;
    }

    const identifier = cleanStr(req.body?.identifier, 160).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!identifier || !password) {
      res.status(400).json({ error: 'Username/email and password are required.' });
      return;
    }

    const ip = getClientIp(req);
    const ipLimit = checkRateLimit(db, `${ip}|*`);
    const idLimit = checkRateLimit(db, `${ip}|${identifier}`);
    if (!ipLimit.allowed || !idLimit.allowed) {
      const waitSec = Math.max(ipLimit.retryAfterSeconds, idLimit.retryAfterSeconds);
      const waitMin = Math.ceil(waitSec / 60);
      res.status(429).json({
        error: `Too many failed login attempts. Please try again in ${waitMin} minute${waitMin === 1 ? '' : 's'}.`,
      });
      return;
    }

    const adminRow = db
      .prepare('SELECT * FROM administrators WHERE LOWER(email) = ? OR LOWER(username) = ? LIMIT 1')
      .get(identifier, identifier) as AdminRow | undefined;

    if (!adminRow || !verifySecret(password, adminRow.password_hash)) {
      recordFailedAttempt(db, `${ip}|*`);
      const resAttempt = recordFailedAttempt(db, `${ip}|${identifier}`);
      const remaining = Math.max(0, 5 - resAttempt.attempts);
      res.status(401).json({
        error:
          remaining > 0
            ? `Invalid credentials. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining before temporary lockout.`
            : 'Invalid credentials. Account login temporarily locked for 15 minutes.',
      });
      return;
    }

    clearFailedAttempts(db, `${ip}|*`);
    clearFailedAttempts(db, `${ip}|${identifier}`);

    const { token } = createSession(db, adminRow.id, req);
    setSessionCookie(req, res, token);
    auditAdminEvent(db, adminRow.full_name, 'ADMIN_LOGIN', 'administrator', adminRow.id, { ip });

    res.json({ admin: toAdminUser(adminRow) });
  });

  app.post('/api/auth/recover', (req, res) => {
    if (!validateCsrfForCookieMutation(req)) {
      res.status(403).json({ error: 'Cross-site request validation failed.' });
      return;
    }

    const identifier = cleanStr(req.body?.identifier, 160).toLowerCase();
    const recoveryKey = cleanStr(req.body?.recoveryKey, 64).toUpperCase();
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
    const confirmPassword = typeof req.body?.confirmPassword === 'string' ? req.body.confirmPassword : '';

    if (!identifier || !recoveryKey || !newPassword) {
      res.status(400).json({ error: 'Email/username, recovery key, and new password are required.' });
      return;
    }
    if (newPassword.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters long.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      res.status(400).json({ error: 'Passwords do not match.' });
      return;
    }

    const ip = getClientIp(req);
    const rateCheck = checkRateLimit(db, `recover|${ip}`);
    if (!rateCheck.allowed) {
      res.status(429).json({
        error: 'Too many recovery attempts. Please wait before trying again.',
      });
      return;
    }

    const adminRow = db
      .prepare('SELECT * FROM administrators WHERE LOWER(email) = ? OR LOWER(username) = ? LIMIT 1')
      .get(identifier, identifier) as AdminRow | undefined;

    if (!adminRow || !verifySecret(recoveryKey, adminRow.recovery_key_hash)) {
      recordFailedAttempt(db, `recover|${ip}`);
      res.status(401).json({ error: 'Invalid administrator identifier or recovery key.' });
      return;
    }

    clearFailedAttempts(db, `recover|${ip}`);

    const newHash = hashSecret(newPassword);
    const newRecoveryKey = generateRecoveryKey();
    const newRecoveryHash = hashSecret(newRecoveryKey);
    const nowIso = new Date().toISOString();

    db.transaction(() => {
      db.prepare(
        'UPDATE administrators SET password_hash = ?, recovery_key_hash = ?, updated_at = ? WHERE id = ?',
      ).run(newHash, newRecoveryHash, nowIso, adminRow.id);
      db.prepare('DELETE FROM sessions WHERE admin_id = ?').run(adminRow.id);
      auditAdminEvent(db, adminRow.full_name, 'PASSWORD_RECOVERED', 'administrator', adminRow.id, { ip });
    })();

    clearSessionCookie(req, res);
    res.json({
      success: true,
      newRecoveryKey,
      message: 'Password reset successfully. Save your new recovery key and sign in.',
    });
  });

  app.post('/api/auth/logout', (req, res) => {
    if (!validateCsrfForCookieMutation(req)) {
      res.status(403).json({ error: 'Cross-site request validation failed.' });
      return;
    }
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.dl_session;
    if (token) {
      const tokenHash = hashSessionToken(token);
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    }
    clearSessionCookie(req, res);
    res.json({ success: true });
  });

  // ---------------------------------------------------------------------------
  // PROTECTED ADMINISTRATIVE API ROUTES
  // ---------------------------------------------------------------------------

  app.use('/api', requireAuth);

  app.get('/api/dashboard', (_req, res) => {
    const summary = getDashboardSummary(db);
    const entries = getLogbookEntries(db, false);
    const recentTransactions = getTransactionsList(db).slice(0, 8);
    const urgentEntries = entries
      .filter((e) => e.status === 'NOT PAID' || e.isExpiringWithin30Days || e.isExpiringThisMonth)
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'NOT PAID' ? -1 : 1;
        return a.daysRemaining - b.daysRemaining;
      })
      .slice(0, 10);

    res.json({ summary, urgentEntries, recentTransactions });
  });

  app.get('/api/logbook', (req, res) => {
    const includeArchived = req.query.archived === '1';
    const entries = getLogbookEntries(db, includeArchived);
    const customColumns = db
      .prepare('SELECT * FROM custom_column_configs ORDER BY sort_order ASC, created_at ASC')
      .all() as Array<{
        id: string;
        column_key: string;
        label: string;
        field_type: string;
        sort_order: number;
        is_visible: number;
        created_at: string;
      }>;

    res.json({
      entries,
      customColumns: customColumns.map((c) => ({
        id: c.id,
        columnKey: c.column_key,
        label: c.label,
        fieldType: c.field_type,
        sortOrder: c.sort_order,
        isVisible: c.is_visible === 1,
        createdAt: c.created_at,
      })),
    });
  });

  app.post('/api/occupants', (req: AuthenticatedRequest, res) => {
    const fullName = cleanStr(req.body?.fullName, 140);
    const phone = cleanStr(req.body?.phone, 40);
    let propertyId = cleanStr(req.body?.propertyId, 80);
    const propertyNameInput = cleanStr(req.body?.propertyName, 120);
    let roomId = cleanStr(req.body?.roomId, 80);
    const roomNumberInput = cleanStr(req.body?.roomNumber, 60);
    const notes = cleanStr(req.body?.notes, 500);
    const confirmDuplicateRoom = Boolean(req.body?.confirmDuplicateRoom);
    const customFields =
      req.body?.customFields && typeof req.body.customFields === 'object' ? req.body.customFields : {};

    const amountPaid = Number(req.body?.amountPaid ?? 0);
    const durationMonths = Math.round(Number(req.body?.durationMonths ?? 0));
    const commencementDate = cleanStr(req.body?.commencementDate, 10);
    const transactionDate = cleanStr(req.body?.transactionDate, 10) || getTodayIso();
    const recordInitialPayment = req.body?.recordInitialPayment !== false;

    if (!fullName) {
      res.status(400).json({ error: 'Occupant full name is required.' });
      return;
    }
    if (!phone) {
      res.status(400).json({ error: 'Phone number is required.' });
      return;
    }
    if (!propertyId && !propertyNameInput) {
      res.status(400).json({ error: 'Property/location is required.' });
      return;
    }
    if (!roomId && !roomNumberInput) {
      res.status(400).json({ error: 'Room or unit number is required.' });
      return;
    }

    if (recordInitialPayment) {
      if (!Number.isFinite(amountPaid) || amountPaid <= 0) {
        res.status(400).json({ error: 'Amount paid must be greater than zero.' });
        return;
      }
      if (!Number.isFinite(durationMonths) || durationMonths < 1 || durationMonths > 120) {
        res.status(400).json({ error: 'Payment duration must be between 1 and 120 months.' });
        return;
      }
      if (!isIsoDate(commencementDate) || !isIsoDate(transactionDate)) {
        res.status(400).json({ error: 'Valid YYYY-MM-DD dates are required.' });
        return;
      }
    }

    const nowIso = new Date().toISOString();

    // Resolve or create property if typed inline
    if (!propertyId && propertyNameInput) {
      const existingProp = db
        .prepare('SELECT id FROM properties WHERE LOWER(name) = LOWER(?)')
        .get(propertyNameInput) as { id: string } | undefined;
      if (existingProp) {
        propertyId = existingProp.id;
      } else {
        propertyId = generateId('prop');
        db.prepare('INSERT INTO properties (id, name, address, description, is_sample, created_at) VALUES (?, ?, ?, ?, 0, ?)').run(
          propertyId,
          propertyNameInput,
          '',
          '',
          nowIso,
        );
      }
    }

    // Resolve or create room if typed inline
    if (!roomId && roomNumberInput) {
      const existingRoom = db
        .prepare('SELECT id FROM rooms WHERE property_id = ? AND LOWER(room_number) = LOWER(?)')
        .get(propertyId, roomNumberInput) as { id: string } | undefined;
      if (existingRoom) {
        roomId = existingRoom.id;
      } else {
        roomId = generateId('room');
        db.prepare(
          'INSERT INTO rooms (id, property_id, room_number, floor_or_wing, notes, is_sample, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
        ).run(roomId, propertyId, roomNumberInput, '', '', nowIso);
      }
    }

    // Duplicate active room assignment check
    const existingOccupant = db
      .prepare('SELECT id, full_name FROM occupants WHERE room_id = ? AND is_archived = 0 LIMIT 1')
      .get(roomId) as { id: string; full_name: string } | undefined;

    if (existingOccupant && !confirmDuplicateRoom) {
      res.status(409).json({
        requiresConfirmation: true,
        existingOccupantName: existingOccupant.full_name,
        error: `Room is already assigned to ${existingOccupant.full_name}. Confirm to assign an additional occupant to this room.`,
      });
      return;
    }

    const maxSerialRow = db.prepare('SELECT COALESCE(MAX(serial_number), 0) AS max_sn FROM occupants').get() as {
      max_sn: number;
    };
    const serialNumber = maxSerialRow.max_sn + 1;
    const occupantId = generateId('occ');
    const adminName = req.admin?.fullName ?? 'Administrator';

    const sanitizedCustom: Record<string, string> = {};
    for (const [k, v] of Object.entries(customFields as Record<string, unknown>)) {
      if (typeof v === 'string' || typeof v === 'number') {
        sanitizedCustom[cleanStr(k, 60)] = cleanStr(String(v), 200);
      }
    }

    const createTx = db.transaction(() => {
      db.prepare(
        `INSERT INTO occupants (id, serial_number, full_name, phone, property_id, room_id, notes, custom_fields_json, is_archived, is_sample, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
      ).run(
        occupantId,
        serialNumber,
        fullName,
        phone,
        propertyId,
        roomId,
        notes,
        JSON.stringify(sanitizedCustom),
        nowIso,
        nowIso,
      );

      if (recordInitialPayment) {
        const expiryDate =
          req.body?.expiryDate && isIsoDate(String(req.body.expiryDate))
            ? String(req.body.expiryDate)
            : calculateExpiryDate(commencementDate, durationMonths);
        const durationLabel = formatDurationLabel(durationMonths);
        const periodId = generateId('per');
        const txId = generateId('tx');
        const txRef =
          cleanStr(req.body?.transactionRef, 60) ||
          `DL-${todayCompact(transactionDate)}-${String(serialNumber).padStart(4, '0')}`;

        db.prepare(
          `INSERT INTO payment_periods (id, occupant_id, property_id, room_id, transaction_date, amount_paid, duration_months, duration_label, commencement_date, expiry_date, remarks, is_sample, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        ).run(
          periodId,
          occupantId,
          propertyId,
          roomId,
          transactionDate,
          amountPaid,
          durationMonths,
          durationLabel,
          commencementDate,
          expiryDate,
          notes,
          nowIso,
        );

        db.prepare(
          `INSERT INTO payment_transactions (id, occupant_id, period_id, transaction_date, amount_received, duration_months, duration_label, commencement_date, expiry_date, transaction_ref, recorded_by, remarks, is_correction, correction_note, is_sample, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', 0, ?)`,
        ).run(
          txId,
          occupantId,
          periodId,
          transactionDate,
          amountPaid,
          durationMonths,
          durationLabel,
          commencementDate,
          expiryDate,
          txRef,
          adminName,
          notes,
          nowIso,
        );
      }

      writeAuditLog(db, adminName, 'OCCUPANT_REGISTERED', 'occupant', occupantId, {
        serialNumber,
        fullName,
        propertyId,
        roomId,
        confirmDuplicateRoom,
      });
    });

    createTx();
    const created = getLogbookEntries(db, true).find((e) => e.id === occupantId);
    res.status(201).json({ occupant: created });
  });

  app.put('/api/occupants/:id', (req: AuthenticatedRequest, res) => {
    const id = req.params.id;
    const existing = db.prepare('SELECT * FROM occupants WHERE id = ?').get(id) as
      | { id: string; room_id: string; property_id: string }
      | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Occupant record not found.' });
      return;
    }

    const fullName = cleanStr(req.body?.fullName, 140);
    const phone = cleanStr(req.body?.phone, 40);
    const propertyId = cleanStr(req.body?.propertyId, 80) || existing.property_id;
    const roomId = cleanStr(req.body?.roomId, 80) || existing.room_id;
    const notes = cleanStr(req.body?.notes, 500);
    const isArchived = Boolean(req.body?.isArchived);
    const confirmDuplicateRoom = Boolean(req.body?.confirmDuplicateRoom);
    const customFields =
      req.body?.customFields && typeof req.body.customFields === 'object' ? req.body.customFields : {};

    if (!fullName || !phone) {
      res.status(400).json({ error: 'Full name and phone number are required.' });
      return;
    }

    if (roomId !== existing.room_id && !isArchived) {
      const otherOccupant = db
        .prepare('SELECT id, full_name FROM occupants WHERE room_id = ? AND id != ? AND is_archived = 0 LIMIT 1')
        .get(roomId, id) as { id: string; full_name: string } | undefined;
      if (otherOccupant && !confirmDuplicateRoom) {
        res.status(409).json({
          requiresConfirmation: true,
          existingOccupantName: otherOccupant.full_name,
          error: `Room is already assigned to ${otherOccupant.full_name}. Confirm to reassign.`,
        });
        return;
      }
    }

    const sanitizedCustom: Record<string, string> = {};
    for (const [k, v] of Object.entries(customFields as Record<string, unknown>)) {
      if (typeof v === 'string' || typeof v === 'number') {
        sanitizedCustom[cleanStr(k, 60)] = cleanStr(String(v), 200);
      }
    }

    const adminName = req.admin?.fullName ?? 'Administrator';
    const nowIso = new Date().toISOString();

    db.prepare(
      `UPDATE occupants
       SET full_name = ?, phone = ?, property_id = ?, room_id = ?, notes = ?, custom_fields_json = ?, is_archived = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      fullName,
      phone,
      propertyId,
      roomId,
      notes,
      JSON.stringify(sanitizedCustom),
      isArchived ? 1 : 0,
      nowIso,
      id,
    );

    writeAuditLog(db, adminName, 'OCCUPANT_UPDATED', 'occupant', id, {
      fullName,
      propertyId,
      roomId,
      isArchived,
    });

    const updated = getLogbookEntries(db, true).find((e) => e.id === id);
    res.json({ occupant: updated });
  });

  app.get('/api/occupants/:id/history', (req, res) => {
    const id = req.params.id;
    const entry = getLogbookEntries(db, true).find((e) => e.id === id);
    if (!entry) {
      res.status(404).json({ error: 'Occupant not found.' });
      return;
    }
    const transactions = getTransactionsList(db, id);
    res.json({ occupant: entry, transactions });
  });

  app.post('/api/occupants/:id/payments', (req: AuthenticatedRequest, res) => {
    const occupantId = req.params.id;
    const occupant = db
      .prepare('SELECT id, serial_number, property_id, room_id, full_name FROM occupants WHERE id = ?')
      .get(occupantId) as
      | { id: string; serial_number: number; property_id: string; room_id: string; full_name: string }
      | undefined;

    if (!occupant) {
      res.status(404).json({ error: 'Occupant not found.' });
      return;
    }

    const amountReceived = Number(req.body?.amountReceived ?? 0);
    const durationMonths = Math.round(Number(req.body?.durationMonths ?? 0));
    const commencementDate = cleanStr(req.body?.commencementDate, 10);
    const transactionDate = cleanStr(req.body?.transactionDate, 10) || getTodayIso();
    const remarks = cleanStr(req.body?.remarks, 500);
    const transactionRef =
      cleanStr(req.body?.transactionRef, 60) ||
      `DL-${todayCompact(transactionDate)}-${String(occupant.serial_number).padStart(4, '0')}-${crypto
        .randomBytes(2)
        .toString('hex')
        .toUpperCase()}`;

    if (!Number.isFinite(amountReceived) || amountReceived <= 0) {
      res.status(400).json({ error: 'Amount received must be greater than zero.' });
      return;
    }
    if (!Number.isFinite(durationMonths) || durationMonths < 1 || durationMonths > 120) {
      res.status(400).json({ error: 'Payment duration must be between 1 and 120 months.' });
      return;
    }
    if (!isIsoDate(commencementDate) || !isIsoDate(transactionDate)) {
      res.status(400).json({ error: 'Valid YYYY-MM-DD dates are required.' });
      return;
    }

    const expiryDate =
      req.body?.expiryDate && isIsoDate(String(req.body.expiryDate))
        ? String(req.body.expiryDate)
        : calculateExpiryDate(commencementDate, durationMonths);
    const durationLabel = formatDurationLabel(durationMonths);
    const adminName = req.admin?.fullName ?? 'Administrator';
    const nowIso = new Date().toISOString();
    const periodId = generateId('per');
    const txId = generateId('tx');

    db.transaction(() => {
      db.prepare(
        `INSERT INTO payment_periods (id, occupant_id, property_id, room_id, transaction_date, amount_paid, duration_months, duration_label, commencement_date, expiry_date, remarks, is_sample, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      ).run(
        periodId,
        occupantId,
        occupant.property_id,
        occupant.room_id,
        transactionDate,
        amountReceived,
        durationMonths,
        durationLabel,
        commencementDate,
        expiryDate,
        remarks,
        nowIso,
      );

      db.prepare(
        `INSERT INTO payment_transactions (id, occupant_id, period_id, transaction_date, amount_received, duration_months, duration_label, commencement_date, expiry_date, transaction_ref, recorded_by, remarks, is_correction, correction_note, is_sample, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', 0, ?)`,
      ).run(
        txId,
        occupantId,
        periodId,
        transactionDate,
        amountReceived,
        durationMonths,
        durationLabel,
        commencementDate,
        expiryDate,
        transactionRef,
        adminName,
        remarks,
        nowIso,
      );

      db.prepare('UPDATE occupants SET updated_at = ? WHERE id = ?').run(nowIso, occupantId);

      writeAuditLog(db, adminName, 'PAYMENT_RECORDED', 'payment_transaction', txId, {
        occupantId,
        occupantName: occupant.full_name,
        amountReceived,
        durationMonths,
        commencementDate,
        expiryDate,
        transactionRef,
      });
    })();

    const updated = getLogbookEntries(db, true).find((e) => e.id === occupantId);
    const transactions = getTransactionsList(db, occupantId);
    res.status(201).json({ occupant: updated, transactions });
  });

  app.post('/api/transactions/:id/correction', (req: AuthenticatedRequest, res) => {
    const txId = req.params.id;
    const original = db.prepare('SELECT * FROM payment_transactions WHERE id = ?').get(txId) as
      | {
          id: string;
          occupant_id: string;
          period_id: string;
          amount_received: number;
          duration_months: number;
          duration_label: string;
          commencement_date: string;
          expiry_date: string;
          transaction_ref: string;
        }
      | undefined;

    if (!original) {
      res.status(404).json({ error: 'Transaction record not found.' });
      return;
    }

    const correctionNote = cleanStr(req.body?.correctionNote, 400);
    const adjustedAmount = Number(req.body?.adjustedAmount ?? original.amount_received);
    const adjustedExpiry = cleanStr(req.body?.adjustedExpiryDate, 10) || original.expiry_date;

    if (!correctionNote || correctionNote.length < 5) {
      res.status(400).json({ error: 'A detailed audit correction reason (min 5 characters) is required.' });
      return;
    }
    if (!Number.isFinite(adjustedAmount) || adjustedAmount < 0) {
      res.status(400).json({ error: 'Adjusted amount must be a valid non-negative number.' });
      return;
    }
    if (!isIsoDate(adjustedExpiry)) {
      res.status(400).json({ error: 'Valid expiry date (YYYY-MM-DD) is required.' });
      return;
    }

    const adminName = req.admin?.fullName ?? 'Administrator';
    const nowIso = new Date().toISOString();
    const today = getTodayIso();
    const correctionId = generateId('tx');

    db.transaction(() => {
      db.prepare('UPDATE payment_periods SET amount_paid = ?, expiry_date = ?, remarks = ? WHERE id = ?').run(
        adjustedAmount,
        adjustedExpiry,
        `[Corrected] ${correctionNote}`,
        original.period_id,
      );

      db.prepare(
        `INSERT INTO payment_transactions (id, occupant_id, period_id, transaction_date, amount_received, duration_months, duration_label, commencement_date, expiry_date, transaction_ref, recorded_by, remarks, is_correction, correction_note, is_sample, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, ?)`,
      ).run(
        correctionId,
        original.occupant_id,
        original.period_id,
        today,
        adjustedAmount - original.amount_received,
        original.duration_months,
        original.duration_label,
        original.commencement_date,
        adjustedExpiry,
        `CORR-${original.transaction_ref}`,
        adminName,
        `Audit adjustment for ${original.transaction_ref}`,
        correctionNote,
        nowIso,
      );

      writeAuditLog(db, adminName, 'PAYMENT_AUDITED_CORRECTION', 'payment_transaction', original.id, {
        correctionId,
        previousAmount: original.amount_received,
        adjustedAmount,
        previousExpiry: original.expiry_date,
        adjustedExpiry,
        correctionNote,
      });
    })();

    const transactions = getTransactionsList(db, original.occupant_id);
    const occupant = getLogbookEntries(db, true).find((e) => e.id === original.occupant_id);
    res.json({ occupant, transactions });
  });

  // ---------------------------------------------------------------------------
  // PROPERTIES & ROOMS
  // ---------------------------------------------------------------------------

  app.get('/api/properties', (_req, res) => {
    res.json({
      properties: getPropertiesWithCounts(db),
      rooms: getRoomsWithOccupancy(db),
    });
  });

  app.post('/api/properties', (req: AuthenticatedRequest, res) => {
    const name = cleanStr(req.body?.name, 120);
    const address = cleanStr(req.body?.address, 250);
    const description = cleanStr(req.body?.description, 300);
    if (!name) {
      res.status(400).json({ error: 'Property name is required.' });
      return;
    }

    const exists = db.prepare('SELECT id FROM properties WHERE LOWER(name) = LOWER(?)').get(name);
    if (exists) {
      res.status(409).json({ error: 'A property with this name already exists.' });
      return;
    }

    const id = generateId('prop');
    const nowIso = new Date().toISOString();
    db.prepare(
      'INSERT INTO properties (id, name, address, description, is_sample, created_at) VALUES (?, ?, ?, ?, 0, ?)',
    ).run(id, name, address, description, nowIso);
    writeAuditLog(db, req.admin?.fullName ?? 'Administrator', 'PROPERTY_CREATED', 'property', id, { name });

    res.status(201).json({ properties: getPropertiesWithCounts(db) });
  });

  app.delete('/api/properties/:id', (req: AuthenticatedRequest, res) => {
    const id = req.params.id;
    const occCount = (
      db.prepare('SELECT COUNT(*) AS count FROM occupants WHERE property_id = ?').get(id) as { count: number }
    ).count;
    if (occCount > 0) {
      res.status(409).json({
        error: 'Cannot delete a property that still has registered occupants.',
      });
      return;
    }
    db.prepare('DELETE FROM properties WHERE id = ?').run(id);
    writeAuditLog(db, req.admin?.fullName ?? 'Administrator', 'PROPERTY_DELETED', 'property', id, {});
    res.json({ properties: getPropertiesWithCounts(db), rooms: getRoomsWithOccupancy(db) });
  });

  app.post('/api/rooms', (req: AuthenticatedRequest, res) => {
    const propertyId = cleanStr(req.body?.propertyId, 80);
    const roomNumber = cleanStr(req.body?.roomNumber, 60);
    const floorOrWing = cleanStr(req.body?.floorOrWing, 80);
    const notes = cleanStr(req.body?.notes, 200);

    if (!propertyId || !roomNumber) {
      res.status(400).json({ error: 'Property and room/unit number are required.' });
      return;
    }

    const exists = db
      .prepare('SELECT id FROM rooms WHERE property_id = ? AND LOWER(room_number) = LOWER(?)')
      .get(propertyId, roomNumber);
    if (exists) {
      res.status(409).json({ error: 'This room/unit number already exists in the selected property.' });
      return;
    }

    const id = generateId('room');
    db.prepare(
      'INSERT INTO rooms (id, property_id, room_number, floor_or_wing, notes, is_sample, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
    ).run(id, propertyId, roomNumber, floorOrWing, notes, new Date().toISOString());

    writeAuditLog(db, req.admin?.fullName ?? 'Administrator', 'ROOM_CREATED', 'room', id, {
      propertyId,
      roomNumber,
    });
    res.status(201).json({ rooms: getRoomsWithOccupancy(db) });
  });

  app.delete('/api/rooms/:id', (req: AuthenticatedRequest, res) => {
    const id = req.params.id;
    const occCount = (
      db.prepare('SELECT COUNT(*) AS count FROM occupants WHERE room_id = ?').get(id) as { count: number }
    ).count;
    if (occCount > 0) {
      res.status(409).json({ error: 'Cannot delete a room that has occupant records.' });
      return;
    }
    db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
    writeAuditLog(db, req.admin?.fullName ?? 'Administrator', 'ROOM_DELETED', 'room', id, {});
    res.json({ rooms: getRoomsWithOccupancy(db) });
  });

  // ---------------------------------------------------------------------------
  // CONFIGURABLE CUSTOM LOGBOOK COLUMNS
  // ---------------------------------------------------------------------------

  app.get('/api/custom-columns', (_req, res) => {
    const rows = db
      .prepare('SELECT * FROM custom_column_configs ORDER BY sort_order ASC, created_at ASC')
      .all() as Array<{
        id: string;
        column_key: string;
        label: string;
        field_type: string;
        sort_order: number;
        is_visible: number;
        created_at: string;
      }>;
    res.json({
      customColumns: rows.map((c) => ({
        id: c.id,
        columnKey: c.column_key,
        label: c.label,
        fieldType: c.field_type,
        sortOrder: c.sort_order,
        isVisible: c.is_visible === 1,
        createdAt: c.created_at,
      })),
    });
  });

  app.post('/api/custom-columns', (req: AuthenticatedRequest, res) => {
    const label = cleanStr(req.body?.label, 60);
    const fieldType = ['text', 'number', 'date'].includes(req.body?.fieldType)
      ? req.body.fieldType
      : 'text';
    if (!label) {
      res.status(400).json({ error: 'Column label is required.' });
      return;
    }
    const columnKey = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);
    if (!columnKey) {
      res.status(400).json({ error: 'Column label must contain alphanumeric characters.' });
      return;
    }

    const exists = db.prepare('SELECT id FROM custom_column_configs WHERE column_key = ?').get(columnKey);
    if (exists) {
      res.status(409).json({ error: 'A custom column with this key already exists.' });
      return;
    }

    const maxOrder = (
      db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM custom_column_configs').get() as { m: number }
    ).m;
    const id = generateId('col');
    db.prepare(
      'INSERT INTO custom_column_configs (id, column_key, label, field_type, sort_order, is_visible, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)',
    ).run(id, columnKey, label, fieldType, maxOrder + 1, new Date().toISOString());

    writeAuditLog(db, req.admin?.fullName ?? 'Administrator', 'CUSTOM_COLUMN_ADDED', 'custom_column', id, {
      label,
      fieldType,
    });
    res.status(201).json({ id, columnKey, label, fieldType, sortOrder: maxOrder + 1, isVisible: true });
  });

  app.delete('/api/custom-columns/:id', (req: AuthenticatedRequest, res) => {
    const id = req.params.id;
    db.prepare('DELETE FROM custom_column_configs WHERE id = ?').run(id);
    writeAuditLog(db, req.admin?.fullName ?? 'Administrator', 'CUSTOM_COLUMN_REMOVED', 'custom_column', id, {});
    res.json({ success: true });
  });

  // ---------------------------------------------------------------------------
  // NOTIFICATIONS & ONESIGNAL PUSH
  // ---------------------------------------------------------------------------

  app.get('/api/notifications', (_req, res) => {
    const settings = db.prepare('SELECT * FROM app_settings WHERE id = ?').get('default') as {
      onesignal_app_id: string;
      auto_check_enabled: number;
      monthly_report_day: number;
    };
    const appId = (process.env.ONESIGNAL_APP_ID || settings?.onesignal_app_id || '').trim();
    const restKeyConfigured = Boolean((process.env.ONESIGNAL_REST_API_KEY || '').trim());

    res.json({
      notifications: getNotificationsHistory(db),
      subscriptions: getPushSubscriptions(db),
      config: {
        onesignalAppId: appId,
        onesignalRestKeyConfigured: restKeyConfigured,
        autoCheckEnabled: settings?.auto_check_enabled === 1,
        monthlyReportDay: settings?.monthly_report_day ?? 1,
      },
    });
  });

  app.post('/api/notifications/run-check', async (req: AuthenticatedRequest, res) => {
    const forceMonthly = Boolean(req.body?.forceMonthlySummary);
    const result = await runExpiryAndMonthlyChecks(db, req.admin?.fullName ?? 'Administrator', forceMonthly);
    res.json({
      ...result,
      notifications: getNotificationsHistory(db),
    });
  });

  app.post('/api/notifications/subscriptions', (req: AuthenticatedRequest, res) => {
    const playerId = cleanStr(req.body?.playerId, 160);
    const deviceLabel = cleanStr(req.body?.deviceLabel, 100) || 'Admin Browser';
    const browser = cleanStr(req.body?.browser, 80) || 'Web Browser';
    const permissionStatus = cleanStr(req.body?.permissionStatus, 30) || 'granted';

    if (!playerId) {
      res.status(400).json({ error: 'Subscription ID is required.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const id = generateId('sub');
    db.prepare(
      `INSERT INTO push_subscriptions (id, player_id, device_label, browser, permission_status, is_active, last_seen_at, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(player_id) DO UPDATE SET
         device_label = excluded.device_label,
         browser = excluded.browser,
         permission_status = excluded.permission_status,
         is_active = 1,
         last_seen_at = excluded.last_seen_at`,
    ).run(id, playerId, deviceLabel, browser, permissionStatus, nowIso, nowIso);

    writeAuditLog(db, req.admin?.fullName ?? 'Administrator', 'PUSH_SUBSCRIPTION_SAVED', 'push_subscription', playerId, {
      deviceLabel,
      permissionStatus,
    });
    res.json({ subscriptions: getPushSubscriptions(db) });
  });

  app.delete('/api/notifications/subscriptions/:id', (req: AuthenticatedRequest, res) => {
    db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(req.params.id);
    res.json({ subscriptions: getPushSubscriptions(db) });
  });

  app.post('/api/notifications/test', async (req: AuthenticatedRequest, res) => {
    const title = 'Digital Logbook Test Alert';
    const message = 'Push notification connectivity check from Digital Logbook Admin Console.';
    const result = await dispatchOneSignalPush(db, title, message);
    const today = getTodayIso();
    const id = generateId('ntf');

    db.prepare(
      `INSERT INTO notifications (
         id, occupant_id, rule_type, reminder_date, dedupe_key, title, message,
         channel, delivery_status, onesignal_notification_id, error_message, recipient_count, created_at
       ) VALUES (?, NULL, 'manual_test', ?, ?, ?, ?, 'onesignal', ?, ?, ?, ?, ?)`,
    ).run(
      id,
      today,
      `TEST:${Date.now()}:${crypto.randomBytes(3).toString('hex')}`,
      title,
      message,
      result.deliveryStatus,
      result.onesignalNotificationId,
      result.errorMessage,
      result.recipientCount,
      new Date().toISOString(),
    );

    res.json({
      result,
      notifications: getNotificationsHistory(db),
    });
  });

  // ---------------------------------------------------------------------------
  // REPORTS & ANALYTICS
  // ---------------------------------------------------------------------------

  app.get('/api/reports', (req, res) => {
    const fromDate = cleanStr(req.query.from as string, 10);
    const toDate = cleanStr(req.query.to as string, 10);
    const propertyId = cleanStr(req.query.propertyId as string, 80);
    const roomId = cleanStr(req.query.roomId as string, 80);

    const allEntries = getLogbookEntries(db, false);
    const filteredEntries = allEntries.filter((e) => {
      if (propertyId && e.propertyId !== propertyId) return false;
      if (roomId && e.roomId !== roomId) return false;
      return true;
    });

    const allTransactions = getTransactionsList(db);
    const entryById = new Map(allEntries.map((e) => [e.id, e]));
    const filteredTransactions = allTransactions.filter((t) => {
      const occ = entryById.get(t.occupantId);
      if (propertyId && occ?.propertyId !== propertyId) return false;
      if (roomId && occ?.roomId !== roomId) return false;
      if (fromDate && t.transactionDate < fromDate) return false;
      if (toDate && t.transactionDate > toDate) return false;
      return true;
    });

    // Monthly collection aggregation
    const monthlyMap = new Map<string, { month: string; totalAmount: number; transactionCount: number }>();
    for (const tx of filteredTransactions) {
      const month = tx.transactionDate.slice(0, 7);
      const curr = monthlyMap.get(month) ?? { month, totalAmount: 0, transactionCount: 0 };
      curr.totalAmount += tx.amountReceived;
      curr.transactionCount += 1;
      monthlyMap.set(month, curr);
    }
    const monthlyCollections = Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month));

    const totalCollected = filteredTransactions.reduce((sum, t) => sum + t.amountReceived, 0);
    const paidCount = filteredEntries.filter((e) => e.status === 'PAID').length;
    const notPaidCount = filteredEntries.filter((e) => e.status === 'NOT PAID').length;
    const expiringThisMonthCount = filteredEntries.filter((e) => e.status === 'PAID' && e.isExpiringThisMonth).length;

    res.json({
      totals: {
        totalCollected,
        paidCount,
        notPaidCount,
        expiringThisMonthCount,
        transactionCount: filteredTransactions.length,
      },
      monthlyCollections,
      occupancyRecords: filteredEntries,
      transactions: filteredTransactions,
    });
  });

  // ---------------------------------------------------------------------------
  // SETTINGS, ACCOUNT SECURITY, AUDIT LOGS & BACKUP
  // ---------------------------------------------------------------------------

  app.get('/api/settings', (_req, res) => {
    const row = db.prepare('SELECT * FROM app_settings WHERE id = ?').get('default') as {
      onesignal_app_id: string;
      currency_symbol: string;
      currency_code: string;
      auto_check_enabled: number;
      monthly_report_day: number;
    };
    res.json({
      settings: {
        onesignalAppId: process.env.ONESIGNAL_APP_ID || row.onesignal_app_id || '',
        onesignalRestKeyConfigured: Boolean((process.env.ONESIGNAL_REST_API_KEY || '').trim()),
        currencySymbol: row.currency_symbol,
        currencyCode: row.currency_code,
        autoCheckEnabled: row.auto_check_enabled === 1,
        monthlyReportDay: row.monthly_report_day,
      },
    });
  });

  app.put('/api/settings', (req: AuthenticatedRequest, res) => {
    const onesignalAppId = cleanStr(req.body?.onesignalAppId, 120);
    const currencySymbol = cleanStr(req.body?.currencySymbol, 6) || '$';
    const currencyCode = cleanStr(req.body?.currencyCode, 8).toUpperCase() || 'USD';
    const autoCheckEnabled = req.body?.autoCheckEnabled !== false ? 1 : 0;
    const monthlyReportDay = Math.min(28, Math.max(1, Math.round(Number(req.body?.monthlyReportDay || 1))));

    db.prepare(
      `UPDATE app_settings
       SET onesignal_app_id = ?, currency_symbol = ?, currency_code = ?, auto_check_enabled = ?, monthly_report_day = ?, updated_at = ?
       WHERE id = 'default'`,
    ).run(onesignalAppId, currencySymbol, currencyCode, autoCheckEnabled, monthlyReportDay, new Date().toISOString());

    writeAuditLog(db, req.admin?.fullName ?? 'Administrator', 'SETTINGS_UPDATED', 'app_settings', 'default', {
      currencySymbol,
      currencyCode,
      autoCheckEnabled,
      monthlyReportDay,
    });

    res.json({
      settings: {
        onesignalAppId: process.env.ONESIGNAL_APP_ID || onesignalAppId,
        onesignalRestKeyConfigured: Boolean((process.env.ONESIGNAL_REST_API_KEY || '').trim()),
        currencySymbol,
        currencyCode,
        autoCheckEnabled: autoCheckEnabled === 1,
        monthlyReportDay,
      },
    });
  });

  app.put('/api/account/profile', (req: AuthenticatedRequest, res) => {
    const adminId = req.admin?.id;
    if (!adminId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const fullName = cleanStr(req.body?.fullName, 120);
    const email = cleanStr(req.body?.email, 160).toLowerCase();
    const username = cleanStr(req.body?.username, 80).toLowerCase();
    const sessionTimeoutMinutes = Math.min(480, Math.max(5, Math.round(Number(req.body?.sessionTimeoutMinutes || 60))));

    if (fullName.length < 2 || !email.includes('@') || username.length < 3) {
      res.status(400).json({ error: 'Valid name, email, and username are required.' });
      return;
    }

    db.prepare(
      `UPDATE administrators
       SET full_name = ?, email = ?, username = ?, session_timeout_minutes = ?, updated_at = ?
       WHERE id = ?`,
    ).run(fullName, email, username, sessionTimeoutMinutes, new Date().toISOString(), adminId);

    const updated = db.prepare('SELECT * FROM administrators WHERE id = ?').get(adminId) as AdminRow;
    writeAuditLog(db, fullName, 'ADMIN_PROFILE_UPDATED', 'administrator', adminId, {
      email,
      username,
      sessionTimeoutMinutes,
    });

    res.json({ admin: toAdminUser(updated) });
  });

  app.put('/api/account/password', (req: AuthenticatedRequest, res) => {
    const adminId = req.admin?.id;
    if (!adminId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
    const confirmPassword = typeof req.body?.confirmPassword === 'string' ? req.body.confirmPassword : '';

    const adminRow = db.prepare('SELECT * FROM administrators WHERE id = ?').get(adminId) as AdminRow;
    if (!verifySecret(currentPassword, adminRow.password_hash)) {
      res.status(401).json({ error: 'Current password is incorrect.' });
      return;
    }
    if (newPassword.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      res.status(400).json({ error: 'New password and confirmation do not match.' });
      return;
    }

    db.prepare('UPDATE administrators SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      hashSecret(newPassword),
      new Date().toISOString(),
      adminId,
    );
    writeAuditLog(db, adminRow.full_name, 'ADMIN_PASSWORD_CHANGED', 'administrator', adminId, {});
    res.json({ success: true });
  });

  app.post('/api/account/recovery-key/rotate', (req: AuthenticatedRequest, res) => {
    const adminId = req.admin?.id;
    if (!adminId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const adminRow = db.prepare('SELECT * FROM administrators WHERE id = ?').get(adminId) as AdminRow;
    if (!verifySecret(currentPassword, adminRow.password_hash)) {
      res.status(401).json({ error: 'Current password is incorrect.' });
      return;
    }

    const newRecoveryKey = generateRecoveryKey();
    db.prepare('UPDATE administrators SET recovery_key_hash = ?, updated_at = ? WHERE id = ?').run(
      hashSecret(newRecoveryKey),
      new Date().toISOString(),
      adminId,
    );
    writeAuditLog(db, adminRow.full_name, 'RECOVERY_KEY_ROTATED', 'administrator', adminId, {});
    res.json({ recoveryKey: newRecoveryKey });
  });

  app.get('/api/audit-logs', (_req, res) => {
    const rows = db
      .prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 150')
      .all() as Array<{
        id: string;
        actor_name: string;
        action: string;
        entity_type: string;
        entity_id: string;
        details_json: string;
        created_at: string;
      }>;

    res.json({
      logs: rows.map((r) => ({
        id: r.id,
        actorName: r.actor_name,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        details: (() => {
          try {
            return JSON.parse(r.details_json || '{}');
          } catch {
            return {};
          }
        })(),
        createdAt: r.created_at,
      })),
    });
  });

  app.get('/api/backup/export', (req: AuthenticatedRequest, res) => {
    const backup = {
      exportedAt: new Date().toISOString(),
      exportedBy: req.admin?.fullName ?? 'Administrator',
      properties: db.prepare('SELECT * FROM properties').all(),
      rooms: db.prepare('SELECT * FROM rooms').all(),
      occupants: db.prepare('SELECT * FROM occupants').all(),
      payment_periods: db.prepare('SELECT * FROM payment_periods').all(),
      payment_transactions: db.prepare('SELECT * FROM payment_transactions').all(),
      custom_column_configs: db.prepare('SELECT * FROM custom_column_configs').all(),
      notifications: db.prepare('SELECT * FROM notifications').all(),
      audit_logs: db.prepare('SELECT * FROM audit_logs').all(),
    };
    writeAuditLog(db, req.admin?.fullName ?? 'Administrator', 'BACKUP_EXPORTED', 'system', 'backup', {});
    res.setHeader('Content-Disposition', `attachment; filename="digital-logbook-backup-${getTodayIso()}.json"`);
    res.json(backup);
  });

  app.post('/api/sample-data/seed', (req: AuthenticatedRequest, res) => {
    seedSampleData(db, req.admin?.fullName ?? 'Administrator');
    res.json({ success: true });
  });

  app.post('/api/sample-data/clear', (req: AuthenticatedRequest, res) => {
    clearSampleData(db, req.admin?.fullName ?? 'Administrator');
    res.json({ success: true });
  });

  // ---------------------------------------------------------------------------
  // BACKGROUND DAILY EXPIRY CHECK SCHEDULER (mirrors Cloudflare Cron Trigger)
  // ---------------------------------------------------------------------------
  const runAutoCheckIfEnabled = async () => {
    try {
      if (!hasAdministrator(db)) return;
      const settings = db
        .prepare('SELECT auto_check_enabled FROM app_settings WHERE id = ?')
        .get('default') as { auto_check_enabled: number } | undefined;
      if (settings?.auto_check_enabled === 1) {
        await runExpiryAndMonthlyChecks(db, 'Automated Scheduler', false);
      }
    } catch (err) {
      console.error('Scheduled expiry check error:', err);
    }
  };
  setTimeout(runAutoCheckIfEnabled, 4000);
  setInterval(runAutoCheckIfEnabled, 6 * 60 * 60 * 1000);

  // ---------------------------------------------------------------------------
  // VITE DEV MIDDLEWARE / PRODUCTION STATIC ASSETS
  // ---------------------------------------------------------------------------
  const distPath = path.resolve(process.cwd(), 'dist');
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(distPath);

  if (isProd) {
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    app.get('/@vite/client', (_req, res) => {
      res.type('application/javascript').send(`
const sheetsMap = new Map();
const linkSheetsMap = new Map();
if (typeof document !== 'undefined') {
  document.querySelectorAll('style[data-vite-dev-id]').forEach((el) => {
    sheetsMap.set(el.getAttribute('data-vite-dev-id'), el);
  });
  document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id]').forEach((el) => {
    linkSheetsMap.set(el.getAttribute('data-vite-dev-id'), el);
  });
}
let lastInsertedStyle;
export function updateStyle(id, content) {
  if (linkSheetsMap.has(id)) return;
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    if (!lastInsertedStyle) {
      document.head.appendChild(style);
      setTimeout(() => { lastInsertedStyle = undefined; }, 0);
    } else {
      lastInsertedStyle.insertAdjacentElement('afterend', style);
    }
    lastInsertedStyle = style;
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
export function removeStyle(id) {
  if (linkSheetsMap.has(id)) {
    document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id="' + CSS.escape(id) + '"]').forEach((el) => el.remove());
    linkSheetsMap.delete(id);
  }
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    invalidate() {},
    decline() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== '.' && url[0] !== '/') return url;
  const pathname = url.replace(/[?#].*$/, '');
  const { search, hash } = new URL(url, 'http://vite.dev');
  return pathname + '?' + queryToInject + (search ? '&' + search.slice(1) : '') + (hash || '');
}
export class ErrorOverlay extends HTMLElement {}
`);
    });
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Digital Logbook server listening on http://0.0.0.0:${PORT}`);
  });
}

function todayCompact(isoDate: string): string {
  return isoDate.replace(/-/g, '');
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
