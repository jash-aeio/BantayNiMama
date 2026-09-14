import type { DB } from '@op-engineering/op-sqlite';

import { parseAppMeta, type AppMeta } from '../domain/appMeta.ts';

/** Reads and validates app_meta. Throws on a missing or malformed row rather than defaulting (TR-35). */
export function readAppMeta(db: DB): AppMeta {
  const values: Record<string, string> = {};
  for (const row of db.executeSync('SELECT key, value FROM app_meta').rows) {
    values[String(row.key)] = String(row.value);
  }
  return parseAppMeta(values);
}

/** One raw app_meta value, or null when the row is absent — for settings outside AppMeta, such as ui_language. */
export function readMetaValue(db: DB, key: string): string | null {
  const value = db.executeSync('SELECT value FROM app_meta WHERE key = ?', [key]).rows[0]?.value;
  return value === undefined || value === null ? null : String(value);
}

/**
 * Inserts or replaces one app_meta row.
 *
 * Only for UI settings. τ, δ and model_id are retuned deliberately, as data, never as a side
 * effect of app code (TR-35, ADR-008).
 */
export function writeMetaValue(db: DB, key: string, value: string): void {
  db.executeSync(
    'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
}
