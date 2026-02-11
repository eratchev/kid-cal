import Database from 'better-sqlite3';
import { getConfig } from '../config.js';
import { getLogger } from '../logger.js';

let _db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!_db) {
    const config = getConfig();
    const logger = getLogger();

    _db = new Database(config.DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');

    logger.info({ path: config.DB_PATH }, 'Database opened');
  }
  return _db;
}

export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
    getLogger().info('Database closed');
  }
}

export function initializeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS processed_emails (
      message_id TEXT PRIMARY KEY,
      "from" TEXT NOT NULL,
      subject TEXT NOT NULL,
      processed_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
      error_message TEXT,
      event_count INTEGER NOT NULL DEFAULT 0,
      action_item_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_message_id TEXT NOT NULL REFERENCES processed_emails(message_id),
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      start_date TEXT NOT NULL,
      end_date TEXT,
      all_day INTEGER NOT NULL DEFAULT 0,
      location TEXT,
      calendar_event_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS action_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_message_id TEXT NOT NULL REFERENCES processed_emails(message_id),
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      deadline TEXT,
      priority TEXT NOT NULL CHECK (priority IN ('high', 'medium', 'low')) DEFAULT 'medium',
      calendar_event_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sent_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER REFERENCES events(id),
      action_item_id INTEGER REFERENCES action_items(id),
      reminder_type TEXT NOT NULL,
      sent_at TEXT NOT NULL DEFAULT (datetime('now')),
      twilio_message_sid TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_events_start_date ON events(start_date);
    CREATE INDEX IF NOT EXISTS idx_action_items_deadline ON action_items(deadline);
    CREATE INDEX IF NOT EXISTS idx_sent_reminders_event ON sent_reminders(event_id, reminder_type);
    CREATE INDEX IF NOT EXISTS idx_sent_reminders_action ON sent_reminders(action_item_id, reminder_type);
  `);

  // Record schema version if not exists
  const hasVersion = db.prepare('SELECT version FROM schema_version WHERE version = 1').get();
  if (!hasVersion) {
    db.prepare('INSERT INTO schema_version (version) VALUES (1)').run();
  }
}
