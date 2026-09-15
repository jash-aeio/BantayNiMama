import type { DB } from '@op-engineering/op-sqlite';

import { META_KEYS } from '../domain/appMeta.ts';
import { planMigrations } from '../domain/migrations.ts';
import { MIGRATIONS, type Migration } from './schema.ts';
import { inTransaction } from './transaction.ts';

/**
 * Brings the database up to the latest schema (TR-44). Each version runs in its own transaction
 * together with its schema_version bump, so a crash mid-migration leaves the database at the
 * last version that fully applied — never between two.
 *
 * app_meta is created up front, outside any migration, because schema_version lives in it and
 * has to be readable before we know which migrations to run.
 *
 * `migrations` is for tests, which stop at an older version to build a database as a previous
 * release left it. The app always runs every migration.
 */
export function migrate(db: DB, migrations: readonly Migration[] = MIGRATIONS): { from: number; to: number } {
  db.executeSync('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');

  const from = readSchemaVersion(db);
  const plan = planMigrations(
    from,
    migrations.map((m) => m.version),
  );

  for (const version of plan) {
    const migration = migrations.find((m) => m.version === version)!;
    inTransaction(db, () => {
      for (const statement of migration.statements) db.executeSync(statement);
      db.executeSync(
        'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [META_KEYS.schemaVersion, String(version)],
      );
    });
  }
  return { from, to: from + plan.length };
}

function readSchemaVersion(db: DB): number {
  const value = db.executeSync('SELECT value FROM app_meta WHERE key = ?', [META_KEYS.schemaVersion]).rows[0]?.value;
  if (value === undefined) return 0;
  const text = String(value);
  if (!/^\d+$/.test(text)) throw new Error(`app_meta schema_version is not a whole number: "${text}"`);
  return Number(text);
}
