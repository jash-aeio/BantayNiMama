import type { DB } from '@op-engineering/op-sqlite';

import type { AppMeta } from '../domain/appMeta.ts';
import { NEGATIVE_SOURCES, type NegativeSource } from '../domain/correction.ts';
import type { IndexedShot } from '../domain/knn.ts';
import { vectorToBlob } from '../domain/vector.ts';
import { assertNewShot, type NewShot } from './shots.ts';
import { inTransaction } from './transaction.ts';

// Store-local negatives — SR-14, TR-39, ADR-017. The table has no name or price column, so nothing
// here can return one. Photos first, row last, as at enrollment: the caller has already saved the
// JPEG, and adds the returned shot to the index only after this returns.

export interface Negative {
  readonly id: string;
  readonly photoPath: string;
  readonly source: NegativeSource;
  readonly createdAt: number;
}

/**
 * Inserts one negative. A single INSERT is its own transaction. Its vector is the saved JPEG's, as at
 * enrollment, so a model swap can re-embed it (TR-24).
 */
export function insertNegativeShot(
  db: DB,
  shot: NewShot,
  source: NegativeSource,
  meta: Pick<AppMeta, 'modelId' | 'embeddingDim'>,
  now: number = Date.now(),
): IndexedShot {
  assertNewShot(shot, meta);
  if (!NEGATIVE_SOURCES.includes(source)) throw new Error(`Unknown negative source: ${String(source)}`);
  db.executeSync(
    'INSERT INTO negative_shots (id, photo_path, model_id, embedding, source, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [shot.id, shot.photoPath, meta.modelId, vectorToBlob(shot.vector), source, now],
  );
  return { shotId: shot.id, productId: shot.id, vector: shot.vector, negative: true };
}

/** Newest first — the *Not in my list* items in the Directory (P2-7). */
export function listNegatives(db: DB): Negative[] {
  return db.executeSync('SELECT id, photo_path, source, created_at FROM negative_shots ORDER BY created_at DESC, id').rows.map(
    (row) => ({
      id: String(row.id),
      photoPath: String(row.photo_path),
      source: row.source as NegativeSource,
      createdAt: Number(row.created_at),
    }),
  );
}

/**
 * Deletes one negative's row and returns its photo path, or null if there was none. This is the undo
 * for a tindera who marked her own product by mistake. Afterwards the caller deletes the photo and
 * rebuilds the index (E-4), because the vector is still in it.
 */
export function deleteNegative(db: DB, id: string): string | null {
  return inTransaction(db, () => {
    const row = db.executeSync('SELECT photo_path FROM negative_shots WHERE id = ?', [id]).rows[0];
    if (row === undefined) return null;
    db.executeSync('DELETE FROM negative_shots WHERE id = ?', [id]);
    return String(row.photo_path);
  });
}
