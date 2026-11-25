import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  const dataDir = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, 'logbook.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const migrationPath = path.resolve(process.cwd(), 'migrations', '0001_initial.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf-8');
  db.exec(migrationSql);

  // Ensure default settings row exists
  const existingSettings = db.prepare('SELECT id FROM app_settings WHERE id = ?').get('default');
  if (!existingSettings) {
    db.prepare(
      `INSERT INTO app_settings (id, onesignal_app_id, currency_symbol, currency_code, auto_check_enabled, monthly_report_day, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'default',
      process.env.ONESIGNAL_APP_ID ?? '',
      '$',
      'USD',
      1,
      1,
      new Date().toISOString(),
    );
  }

  dbInstance = db;
  return db;
}

export function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function writeAuditLog(
  db: Database.Database,
  actorName: string,
  action: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown> = {},
): void {
  db.prepare(
    `INSERT INTO audit_logs (id, actor_name, action, entity_type, entity_id, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(generateId('aud'), actorName, action, entityType, entityId, JSON.stringify(details), new Date().toISOString());
}
