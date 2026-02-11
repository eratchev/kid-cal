import type Database from 'better-sqlite3';
import { getLogger } from '../logger.js';

interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
}

const migrations: Migration[] = [
  // Version 1 is the initial schema created in database.ts
  // Future migrations go here:
  // {
  //   version: 2,
  //   description: 'Add some_column to events',
  //   up: (db) => {
  //     db.exec('ALTER TABLE events ADD COLUMN some_column TEXT');
  //   },
  // },
];

export function runMigrations(db: Database.Database): void {
  const logger = getLogger();

  const currentVersion = db.prepare(
    'SELECT MAX(version) as version FROM schema_version'
  ).get() as { version: number } | undefined;

  const current = currentVersion?.version ?? 0;

  const pending = migrations.filter((m) => m.version > current);
  if (pending.length === 0) {
    logger.debug('No pending migrations');
    return;
  }

  for (const migration of pending) {
    logger.info({ version: migration.version, description: migration.description }, 'Running migration');
    db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(migration.version);
    })();
  }

  logger.info({ migrationsRun: pending.length }, 'Migrations complete');
}
