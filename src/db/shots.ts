import type { DB } from '@op-engineering/op-sqlite';

import type { AppMeta } from '../domain/appMeta.ts';
import { buildIndex, type VectorIndex } from '../domain/knn.ts';
import { blobToVector } from '../domain/vector.ts';

/**
 * Builds the in-memory search index from SQLite (ADR-014): every shot of a live product whose
 * vector came from the current model.
 *
 * Shots stamped with a different model_id are left out — their vectors are not comparable (TR-23).
 * They are counted rather than silently dropped, because a non-zero count means those products
 * cannot be recognized until they are re-embedded from their JPEGs (TR-24).
 */
export function loadVectorIndex(
  db: DB,
  meta: Pick<AppMeta, 'modelId' | 'embeddingDim'>,
): { index: VectorIndex; otherModelShots: number } {
  const rows = db.executeSync(
    'SELECT s.id, s.product_id, s.embedding FROM product_shots s ' +
      'JOIN products p ON p.id = s.product_id ' +
      'WHERE p.deleted_at IS NULL AND s.model_id = ? ' +
      'ORDER BY s.created_at, s.id',
    [meta.modelId],
  ).rows;

  const index = buildIndex(
    meta.embeddingDim,
    rows.map((row) => ({
      shotId: String(row.id),
      productId: String(row.product_id),
      vector: blobToVector(asBlob(row.embedding), meta.embeddingDim),
    })),
  );

  const otherModelShots = Number(
    db.executeSync('SELECT count(*) AS n FROM product_shots WHERE model_id <> ?', [meta.modelId]).rows[0]?.n ?? 0,
  );
  return { index, otherModelShots };
}

/**
 * Every photo_path a shot row points at, soft-deleted products included: their JPEGs must survive
 * for restore (SR-32) and for re-embedding (TR-24). Throws rather than returning an empty set on
 * failure, because the orphan sweep deletes whatever is not in this set.
 */
export function referencedPhotoPaths(db: DB): Set<string> {
  return new Set(db.executeSync('SELECT photo_path FROM product_shots').rows.map((row) => String(row.photo_path)));
}

export interface ShotRow {
  readonly id: string;
  readonly productId: string;
  readonly photoPath: string;
  readonly modelId: string;
}

/** Every shot row, whatever its model or product state — for the gate check (PHASE_1_PLAN.md §4). */
export function listShotRows(db: DB): ShotRow[] {
  return db.executeSync('SELECT id, product_id, photo_path, model_id FROM product_shots ORDER BY created_at, id').rows.map(
    (row) => ({
      id: String(row.id),
      productId: String(row.product_id),
      photoPath: String(row.photo_path),
      modelId: String(row.model_id),
    }),
  );
}

function asBlob(value: unknown): ArrayBuffer | ArrayBufferView {
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value;
  throw new Error(`product_shots.embedding is not a BLOB (got ${typeof value})`);
}
