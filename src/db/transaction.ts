import type { DB } from '@op-engineering/op-sqlite';

/**
 * Runs `work` inside one SQLite transaction and returns its result; on any throw, rolls back and
 * rethrows the original error.
 *
 * Synchronous on purpose. executeSync blocks the JS thread from BEGIN to COMMIT, so no other
 * query — say, a product lookup for the scanner — can interleave with a half-written enrollment.
 * op-sqlite's async transaction() would allow that. IMMEDIATE takes the write lock at BEGIN
 * rather than at the first write, so a conflict fails before anything is written.
 */
export function inTransaction<T>(db: DB, work: () => T): T {
  db.executeSync('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.executeSync('COMMIT');
    return result;
  } catch (e) {
    try {
      db.executeSync('ROLLBACK');
    } catch {
      // Keep the original error: it explains why the transaction failed.
    }
    throw e;
  }
}
