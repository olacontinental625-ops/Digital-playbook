-- Digital Logbook & Payment Management System
-- Compatible with both Cloudflare D1 (SQLite) and local SQLite (better-sqlite3)

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS administrators (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  recovery_key_hash TEXT NOT NULL,
  session_timeout_minutes INTEGER NOT NULL DEFAULT 60,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  admin_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  user_agent TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (admin_id) REFERENCES administrators(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS login_attempts (
  attempt_key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_attempt_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  address TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  is_sample INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  room_number TEXT NOT NULL,
  floor_or_wing TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  is_sample INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(property_id, room_number),
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS occupants (
  id TEXT PRIMARY KEY,
  serial_number INTEGER NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  property_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  custom_fields_json TEXT NOT NULL DEFAULT '{}',
  is_archived INTEGER NOT NULL DEFAULT 0,
  is_sample INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE RESTRICT,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS payment_periods (
  id TEXT PRIMARY KEY,
  occupant_id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  transaction_date TEXT NOT NULL,
  amount_paid REAL NOT NULL,
  duration_months INTEGER NOT NULL,
  duration_label TEXT NOT NULL,
  commencement_date TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  remarks TEXT NOT NULL DEFAULT '',
  is_sample INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (occupant_id) REFERENCES occupants(id) ON DELETE CASCADE,
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE RESTRICT,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS payment_transactions (
  id TEXT PRIMARY KEY,
  occupant_id TEXT NOT NULL,
  period_id TEXT NOT NULL,
  transaction_date TEXT NOT NULL,
  amount_received REAL NOT NULL,
  duration_months INTEGER NOT NULL,
  duration_label TEXT NOT NULL,
  commencement_date TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  transaction_ref TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  remarks TEXT NOT NULL DEFAULT '',
  is_correction INTEGER NOT NULL DEFAULT 0,
  correction_note TEXT NOT NULL DEFAULT '',
  is_sample INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (occupant_id) REFERENCES occupants(id) ON DELETE CASCADE,
  FOREIGN KEY (period_id) REFERENCES payment_periods(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS custom_column_configs (
  id TEXT PRIMARY KEY,
  column_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  occupant_id TEXT,
  rule_type TEXT NOT NULL,
  reminder_date TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'onesignal',
  delivery_status TEXT NOT NULL DEFAULT 'queued',
  onesignal_notification_id TEXT,
  error_message TEXT,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (occupant_id) REFERENCES occupants(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL UNIQUE,
  device_label TEXT NOT NULL DEFAULT 'Browser Device',
  browser TEXT NOT NULL DEFAULT '',
  permission_status TEXT NOT NULL DEFAULT 'default',
  is_active INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  id TEXT PRIMARY KEY,
  onesignal_app_id TEXT NOT NULL DEFAULT '',
  currency_symbol TEXT NOT NULL DEFAULT '$',
  currency_code TEXT NOT NULL DEFAULT 'USD',
  auto_check_enabled INTEGER NOT NULL DEFAULT 1,
  monthly_report_day INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_occupants_property ON occupants(property_id);
CREATE INDEX IF NOT EXISTS idx_occupants_room ON occupants(room_id);
CREATE INDEX IF NOT EXISTS idx_periods_occupant ON payment_periods(occupant_id, expiry_date);
CREATE INDEX IF NOT EXISTS idx_transactions_occupant ON payment_transactions(occupant_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_notifications_date ON notifications(reminder_date, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
