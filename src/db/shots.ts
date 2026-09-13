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

function asBlob(value: unknown): ArrayBuffer | ArrayBufferView {
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value;
  throw new Error(`product_shots.embedding is not a BLOB (got ${typeof value})`);
}
