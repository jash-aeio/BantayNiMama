// Tests only (P2-2): an in-memory node:sqlite database behind the one op-sqlite call the repositories
// use, executeSync. That lets the real migration and repository SQL run under `npm test`.
//
// node:sqlite ships inside Node (v24.13.1: SQLite 3.51.2; the Infinix runs 3.51.3), so it adds no
// dependency to audit (TR-51) and works in airplane mode (TR-53). Excluded from the app build
// (tsconfig.json), and never imported by app code.

import type { DB, QueryResult, Scalar } from '@op-engineering/op-sqlite';
import { DatabaseSync } from 'node:sqlite';

export function openTestDatabase(): DB {
  const sqlite = new DatabaseSync(':memory:');
  // As openDatabase() does on the phone.
  sqlite.exec('PRAGMA foreign_keys = ON');

  const executeSync = (query: string, params: Scalar[] = []): QueryResult => {
    const rows = sqlite.prepare(query).all(...params.map(toInput));
    // Meaningful after a write, which is the only place the repositories read it.
    const changes = sqlite.prepare('SELECT changes() AS n').get() as { n: number };
    // Spread into plain objects, so deepEqual against a literal compares values, not prototypes.
    return { rows: rows.map((row) => ({ ...row }) as Record<string, Scalar>), rowsAffected: Number(changes.n) };
  };

  // Only what the repositories call. Anything else is undefined, so a new call fails loudly in a
  // test instead of passing against a stub. The cast is why: DB has ~30 members this does not need.
  return { executeSync, close: () => sqlite.close() } as unknown as DB;
}

/** op-sqlite binds ArrayBuffer and booleans; node:sqlite wants a byte view and integers. */
function toInput(value: Scalar): null | number | bigint | string | NodeJS.ArrayBufferView {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}
