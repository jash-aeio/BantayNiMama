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
