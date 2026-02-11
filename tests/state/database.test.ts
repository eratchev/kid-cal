import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';

vi.mock('../../src/config.js', () => ({
  getConfig: () => ({
    DB_PATH: ':memory:',
    LOG_LEVEL: 'error',
  }),
}));
vi.mock('../../src/logger.js', () => ({
  getLogger: () => ({
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

import { initializeSchema } from '../../src/state/database.js';

describe('initializeSchema', () => {
  it('creates all tables', () => {
    const db = new Database(':memory:');
    initializeSchema(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain('processed_emails');
    expect(tableNames).toContain('events');
    expect(tableNames).toContain('action_items');
    expect(tableNames).toContain('sent_reminders');
    expect(tableNames).toContain('schema_version');

    db.close();
  });

  it('is idempotent (IF NOT EXISTS)', () => {
    const db = new Database(':memory:');
    initializeSchema(db);
    // Running again should not throw
    initializeSchema(db);

    const version = db.prepare('SELECT version FROM schema_version WHERE version = 1').get() as { version: number };
    expect(version.version).toBe(1);

    db.close();
  });

  it('records schema version', () => {
    const db = new Database(':memory:');
    initializeSchema(db);

    const row = db.prepare('SELECT version FROM schema_version').get() as { version: number };
    expect(row.version).toBe(1);

    db.close();
  });
});
