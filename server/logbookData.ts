import type Database from 'better-sqlite3';
import {
  calculateExpiryDate,
  calculatePaymentMetrics,
  formatDurationLabel,
  getTodayIso,
} from '../shared/paymentCalc.ts';
import type {
  DashboardSummary,
  LogbookEntry,
  PaymentTransactionRecord,
  PropertyRecord,
  RoomRecord,
} from '../shared/types.ts';
import { generateId, writeAuditLog } from './db.ts';

interface RawOccupantRow {
  id: string;
  serial_number: number;
  full_name: string;
  phone: string;
  property_id: string;
  property_name: string;
  room_id: string;
  room_number: string;
  notes: string;
  custom_fields_json: string;
  is_archived: number;
  is_sample: number;
  created_at: string;
  updated_at: string;
  latest_period_id: string | null;
  transaction_date: string | null;
  amount_paid: number | null;
  duration_months: number | null;
  duration_label: string | null;
  commencement_date: string | null;
  expiry_date: string | null;
  remarks: string | null;
}

export function getLogbookEntries(db: Database.Database, includeArchived = false): LogbookEntry[] {
  const today = getTodayIso();
  const rows = db
    .prepare(
      `SELECT
         o.id,
         o.serial_number,
         o.full_name,
         o.phone,
         o.property_id,
         p.name AS property_name,
         o.room_id,
         r.room_number,
         o.notes,
         o.custom_fields_json,
         o.is_archived,
         o.is_sample,
         o.created_at,
         o.updated_at,
         lp.id AS latest_period_id,
         lp.transaction_date,
         lp.amount_paid,
         lp.duration_months,
         lp.duration_label,
         lp.commencement_date,
         lp.expiry_date,
         lp.remarks
       FROM occupants o
       JOIN properties p ON p.id = o.property_id
       JOIN rooms r ON r.id = o.room_id
       LEFT JOIN payment_periods lp ON lp.id = (
         SELECT pp.id
         FROM payment_periods pp
         WHERE pp.occupant_id = o.id
         ORDER BY pp.expiry_date DESC, pp.created_at DESC
         LIMIT 1
       )
       ${includeArchived ? '' : 'WHERE o.is_archived = 0'}
       ORDER BY o.serial_number ASC`,
    )
    .all() as RawOccupantRow[];

  return rows.map((row) => {
    const metrics = calculatePaymentMetrics(
      row.commencement_date,
      row.expiry_date,
      row.duration_months,
      today,
    );

    let customFields: Record<string, string> = {};
    try {
      const parsed = JSON.parse(row.custom_fields_json || '{}');
      if (parsed && typeof parsed === 'object') {
        customFields = parsed as Record<string, string>;
      }
    } catch {
      customFields = {};
    }

    return {
      id: row.id,
      serialNumber: row.serial_number,
      fullName: row.full_name,
      phone: row.phone,
      propertyId: row.property_id,
      propertyName: row.property_name,
      roomId: row.room_id,
      roomNumber: row.room_number,
      notes: row.notes,
      customFields,
      isArchived: row.is_archived === 1,
      isSample: row.is_sample === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      latestPeriodId: row.latest_period_id,
      transactionDate: row.transaction_date,
      amountPaid: row.amount_paid,
      unpaidBalance: 0,
      durationMonths: row.duration_months,
      durationLabel: row.duration_label,
      commencementDate: row.commencement_date,
      expiryDate: row.expiry_date,
      remarks: row.remarks || row.notes || '',
      monthsUsed: metrics.monthsUsed,
      monthsRemaining: metrics.monthsRemaining,
      daysRemaining: metrics.daysRemaining,
      status: metrics.status,
      isExpired: metrics.isExpired,
      isExpiringWithin7Days: metrics.isExpiringWithin7Days,
      isExpiringWithin30Days: metrics.isExpiringWithin30Days,
      isExpiringThisMonth: metrics.isExpiringThisMonth,
      urgencyLevel: metrics.urgencyLevel,
    };
  });
}

export function getDashboardSummary(db: Database.Database): DashboardSummary {
  const entries = getLogbookEntries(db, false);
  const roomsCount = (db.prepare('SELECT COUNT(*) AS count FROM rooms').get() as { count: number }).count;
  const totalCollectedRow = db
    .prepare('SELECT COALESCE(SUM(amount_received), 0) AS total FROM payment_transactions')
    .get() as { total: number };
  const sampleRow = db
    .prepare('SELECT COUNT(*) AS count FROM occupants WHERE is_sample = 1')
    .get() as { count: number };
  const settings = db
    .prepare('SELECT currency_symbol, currency_code FROM app_settings WHERE id = ?')
    .get('default') as { currency_symbol: string; currency_code: string } | undefined;

  let paidOccupants = 0;
  let notPaidOccupants = 0;
  let expiringThisMonth = 0;
  let expiringWithin7Days = 0;

  for (const e of entries) {
    if (e.status === 'PAID') {
      paidOccupants++;
      if (e.isExpiringThisMonth) expiringThisMonth++;
      if (e.isExpiringWithin7Days) expiringWithin7Days++;
    } else {
      notPaidOccupants++;
    }
  }

  return {
    totalOccupants: entries.length,
    totalRooms: roomsCount,
    paidOccupants,
    notPaidOccupants,
    expiringThisMonth,
    expiringWithin7Days,
    totalAmountCollected: Number(totalCollectedRow.total || 0),
    totalUnpaidBalance: 0,
    hasSampleData: sampleRow.count > 0,
    currencySymbol: settings?.currency_symbol ?? '$',
    currencyCode: settings?.currency_code ?? 'USD',
  };
}

export function getPropertiesWithCounts(db: Database.Database): PropertyRecord[] {
  const rows = db
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM rooms r WHERE r.property_id = p.id) AS room_count,
        (SELECT COUNT(*) FROM occupants o WHERE o.property_id = p.id AND o.is_archived = 0) AS occupied_count
       FROM properties p
       ORDER BY p.name ASC`,
    )
    .all() as Array<{
      id: string;
      name: string;
      address: string;
      description: string;
      is_sample: number;
      room_count: number;
      occupied_count: number;
      created_at: string;
    }>;

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    address: r.address,
    description: r.description,
    isSample: r.is_sample === 1,
    roomCount: r.room_count,
    occupiedCount: r.occupied_count,
    createdAt: r.created_at,
  }));
}

export function getRoomsWithOccupancy(db: Database.Database): RoomRecord[] {
  const entries = getLogbookEntries(db, false);
  const occupantByRoom = new Map<string, LogbookEntry>();
  for (const e of entries) {
    occupantByRoom.set(e.roomId, e);
  }

  const rows = db
    .prepare(
      `SELECT r.*, p.name AS property_name
       FROM rooms r
       JOIN properties p ON p.id = r.property_id
       ORDER BY p.name ASC, r.room_number ASC`,
    )
    .all() as Array<{
      id: string;
      property_id: string;
      property_name: string;
      room_number: string;
      floor_or_wing: string;
      notes: string;
      is_sample: number;
      created_at: string;
    }>;

  return rows.map((r) => {
    const occ = occupantByRoom.get(r.id);
    return {
      id: r.id,
      propertyId: r.property_id,
      propertyName: r.property_name,
      roomNumber: r.room_number,
      floorOrWing: r.floor_or_wing,
      notes: r.notes,
      isSample: r.is_sample === 1,
      activeOccupantId: occ?.id ?? null,
      activeOccupantName: occ?.fullName ?? null,
      activeOccupantStatus: occ?.status ?? null,
      createdAt: r.created_at,
    };
  });
}

export function getTransactionsList(db: Database.Database, occupantId?: string): PaymentTransactionRecord[] {
  const sql = `
    SELECT
      t.*,
      o.full_name AS occupant_name,
      o.serial_number AS serial_number,
      p.name AS property_name,
      r.room_number AS room_number
    FROM payment_transactions t
    JOIN occupants o ON o.id = t.occupant_id
    JOIN properties p ON p.id = o.property_id
    JOIN rooms r ON r.id = o.room_id
    ${occupantId ? 'WHERE t.occupant_id = ?' : ''}
    ORDER BY t.transaction_date DESC, t.created_at DESC
  `;

  const rows = (occupantId ? db.prepare(sql).all(occupantId) : db.prepare(sql).all()) as Array<{
    id: string;
    occupant_id: string;
    occupant_name: string;
    serial_number: number;
    property_name: string;
    room_number: string;
    period_id: string;
    transaction_date: string;
    amount_received: number;
    duration_months: number;
    duration_label: string;
    commencement_date: string;
    expiry_date: string;
    transaction_ref: string;
    recorded_by: string;
    remarks: string;
    is_correction: number;
    correction_note: string;
    is_sample: number;
    created_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    occupantId: r.occupant_id,
    occupantName: r.occupant_name,
    serialNumber: r.serial_number,
    propertyName: r.property_name,
    roomNumber: r.room_number,
    periodId: r.period_id,
    transactionDate: r.transaction_date,
    amountReceived: r.amount_received,
    durationMonths: r.duration_months,
    durationLabel: r.duration_label,
    commencementDate: r.commencement_date,
    expiryDate: r.expiry_date,
    transactionRef: r.transaction_ref,
    recordedBy: r.recorded_by,
    remarks: r.remarks,
    isCorrection: r.is_correction === 1,
    correctionNote: r.correction_note,
    isSample: r.is_sample === 1,
    createdAt: r.created_at,
  }));
}

function addDaysIso(dateIso: string, deltaDays: number): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

function addMonthsRelativeIso(dateIso: string, deltaMonths: number): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + deltaMonths, d));
  return dt.toISOString().slice(0, 10);
}

/**
 * Seeds clearly labelled demonstration data (is_sample = 1) relative to today's real calendar date
 * so the administrator can test all dashboards, duration calculators, expiry buckets, and exports.
 */
export function seedSampleData(db: Database.Database, adminName: string): void {
  const existingSample = db.prepare('SELECT COUNT(*) AS count FROM occupants WHERE is_sample = 1').get() as {
    count: number;
  };
  if (existingSample.count > 0) {
    return;
  }

  const today = getTodayIso();
  const nowIso = new Date().toISOString();

  const prop1 = generateId('prop');
  const prop2 = generateId('prop');

  const insertProp = db.prepare(
    `INSERT INTO properties (id, name, address, description, is_sample, created_at) VALUES (?, ?, ?, ?, 1, ?)`,
  );
  insertProp.run(prop1, 'Oakridge Residence (Sample)', '14 Oakridge Avenue', 'Sample demonstration block A', nowIso);
  insertProp.run(prop2, 'Harbor Court Annex (Sample)', '88 Harbor Road', 'Sample demonstration block B', nowIso);

  const insertRoom = db.prepare(
    `INSERT INTO rooms (id, property_id, room_number, floor_or_wing, notes, is_sample, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)`,
  );

  const rooms = [
    { id: generateId('room'), propId: prop1, num: 'Room 01', wing: 'Ground Floor' },
    { id: generateId('room'), propId: prop1, num: 'Room 02', wing: 'Ground Floor' },
    { id: generateId('room'), propId: prop1, num: 'Room 05', wing: 'First Floor' },
    { id: generateId('room'), propId: prop1, num: 'Room 08', wing: 'Second Floor' },
    { id: generateId('room'), propId: prop2, num: 'Unit 101', wing: 'East Wing' },
    { id: generateId('room'), propId: prop2, num: 'Unit 104', wing: 'West Wing' },
    { id: generateId('room'), propId: prop2, num: 'Unit 107', wing: 'West Wing' },
  ];

  for (const r of rooms) {
    insertRoom.run(r.id, r.propId, r.num, r.wing, 'Sample unit', nowIso);
  }

  const maxSerialRow = db.prepare('SELECT COALESCE(MAX(serial_number), 0) AS max_sn FROM occupants').get() as {
    max_sn: number;
  };
  let serial = maxSerialRow.max_sn;

  const sampleOccupants = [
    {
      name: 'John Doe (Sample)',
      phone: '+1 555-0105',
      propId: prop1,
      roomId: rooms[2].id,
      durationMonths: 12,
      amount: 2400,
      commencement: addMonthsRelativeIso(addDaysIso(today, 7), -12),
      remarks: 'Sample record — expiring in 7 days',
    },
    {
      name: 'Clara Vance (Sample)',
      phone: '+1 555-0112',
      propId: prop1,
      roomId: rooms[0].id,
      durationMonths: 12,
      amount: 2600,
      commencement: addMonthsRelativeIso(today, -3),
      remarks: 'Sample record — active 12-month lease',
    },
    {
      name: 'Samuel Okafor (Sample)',
      phone: '+1 555-0148',
      propId: prop2,
      roomId: rooms[4].id,
      durationMonths: 6,
      amount: 1350,
      commencement: addMonthsRelativeIso(addDaysIso(today, 14), -6),
      remarks: 'Sample record — expiring in 14 days',
    },
    {
      name: 'Miriam Al-Mansoor (Sample)',
      phone: '+1 555-0177',
      propId: prop1,
      roomId: rooms[1].id,
      durationMonths: 12,
      amount: 2400,
      commencement: addMonthsRelativeIso(addDaysIso(today, -12), -12),
      remarks: 'Sample record — expired 12 days ago',
    },
    {
      name: 'David K. Mensah (Sample)',
      phone: '+1 555-0193',
      propId: prop2,
      roomId: rooms[5].id,
      durationMonths: 3,
      amount: 720,
      commencement: addMonthsRelativeIso(addDaysIso(today, 25), -3),
      remarks: 'Sample record — expiring within 30 days',
    },
    {
      name: 'Elena Rostova (Sample)',
      phone: '+1 555-0210',
      propId: prop1,
      roomId: rooms[3].id,
      durationMonths: 18,
      amount: 3900,
      commencement: addMonthsRelativeIso(today, -5),
      remarks: 'Sample record — 18-month term',
    },
  ];

  const insertOcc = db.prepare(
    `INSERT INTO occupants (id, serial_number, full_name, phone, property_id, room_id, notes, custom_fields_json, is_archived, is_sample, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '{}', 0, 1, ?, ?)`,
  );
  const insertPeriod = db.prepare(
    `INSERT INTO payment_periods (id, occupant_id, property_id, room_id, transaction_date, amount_paid, duration_months, duration_label, commencement_date, expiry_date, remarks, is_sample, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  );
  const insertTx = db.prepare(
    `INSERT INTO payment_transactions (id, occupant_id, period_id, transaction_date, amount_received, duration_months, duration_label, commencement_date, expiry_date, transaction_ref, recorded_by, remarks, is_correction, correction_note, is_sample, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', 1, ?)`,
  );

  for (const s of sampleOccupants) {
    serial += 1;
    const occId = generateId('occ');
    const periodId = generateId('per');
    const txId = generateId('tx');
    const expiry = calculateExpiryDate(s.commencement, s.durationMonths);
    const label = formatDurationLabel(s.durationMonths);
    const txRef = `SAMPLE-${String(serial).padStart(4, '0')}`;

    insertOcc.run(occId, serial, s.name, s.phone, s.propId, s.roomId, s.remarks, nowIso, nowIso);
    insertPeriod.run(
      periodId,
      occId,
      s.propId,
      s.roomId,
      s.commencement,
      s.amount,
      s.durationMonths,
      label,
      s.commencement,
      expiry,
      s.remarks,
      nowIso,
    );
    insertTx.run(
      txId,
      occId,
      periodId,
      s.commencement,
      s.amount,
      s.durationMonths,
      label,
      s.commencement,
      expiry,
      txRef,
      adminName,
      s.remarks,
      nowIso,
    );
  }

  writeAuditLog(db, adminName, 'SEED_SAMPLE_DATA', 'system', 'sample', {
    occupantsAdded: sampleOccupants.length,
  });
}

export function clearSampleData(db: Database.Database, adminName: string): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM payment_transactions WHERE is_sample = 1').run();
    db.prepare('DELETE FROM payment_periods WHERE is_sample = 1').run();
    db.prepare('DELETE FROM occupants WHERE is_sample = 1').run();
    db.prepare('DELETE FROM rooms WHERE is_sample = 1').run();
    db.prepare('DELETE FROM properties WHERE is_sample = 1').run();
    writeAuditLog(db, adminName, 'CLEAR_SAMPLE_DATA', 'system', 'sample', {});
  });
  tx();
}
