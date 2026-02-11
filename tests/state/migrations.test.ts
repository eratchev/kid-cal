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
import { runMigrations } from '../../src/state/migrations.js';

describe('runMigrations', () => {
  it('no-op when no pending migrations', () => {
    const db = new Database(':memory:');
    initializeSchema(db);

    // Should not throw — currently no migrations beyond version 1
    runMigrations(db);

    const version = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number };
    expect(version.version).toBe(1);

    db.close();
  });

  it('is idempotent when run multiple times', () => {
    const db = new Database(':memory:');
    initializeSchema(db);

    runMigrations(db);
    runMigrations(db);

    const version = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number };
    expect(version.version).toBe(1);

    db.close();
  });
});
