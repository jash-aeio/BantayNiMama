import type { DB } from '@op-engineering/op-sqlite';

import type { AppMeta } from '../domain/appMeta.ts';
import { extraShotsToReplace, SHOT_SOURCES, type ExtraShotSource, type ShotSource } from '../domain/correction.ts';
import { buildIndex, type IndexedShot, type VectorIndex } from '../domain/knn.ts';
import { referencePhotoPath } from '../domain/referencePhoto.ts';
import { blobToVector, dot, vectorToBlob } from '../domain/vector.ts';
import { inTransaction } from './transaction.ts';

type ShotMeta = Pick<AppMeta, 'modelId' | 'embeddingDim'>;

export interface NewShot {
  /** Chosen when the shot was captured, because the photo was already saved under it. */
  readonly id: string;
  /** Relative to the document directory (TR-43); must be referencePhotoPath(id). */
  readonly photoPath: string;
  /** L2-normalized (TR-22), produced by the model named in app_meta (TR-23). */
  readonly vector: Float32Array;
}

/**
 * The rules every stored vector follows, for product_shots and negative_shots alike. Checked before
 * BEGIN, so bad input never opens a transaction.
 */
export function assertNewShot(shot: NewShot, meta: ShotMeta): void {
  // A row pointing at another shot's photo would re-embed the wrong image after a model swap
  // (TR-24). referencePhotoPath also guarantees the path is relative (TR-43).
  if (shot.photoPath !== referencePhotoPath(shot.id)) {
    throw new Error(`Shot ${shot.id} must point at ${referencePhotoPath(shot.id)}, got "${shot.photoPath}" (TR-43)`);
  }
  if (shot.vector.length !== meta.embeddingDim) {
    throw new RangeError(`Shot vector has ${shot.vector.length} dimensions; ${meta.modelId} gives ${meta.embeddingDim} (TR-23)`);
  }
  // Search assumes unit vectors, so cosine is a plain dot product. A vector that is not one
  // would score every query wrong without ever throwing.
  if (Math.abs(dot(shot.vector, shot.vector) - 1) > 1e-3) {
    throw new RangeError('Shot vector is not L2-normalized (TR-22)');
  }
}

/**
 * Builds the in-memory search index from SQLite (ADR-014): every shot of a live product, then every
 * negative (TR-39), whose vector came from the current model. A negative joins as its own one-shot
 * product, keyed by its own id and flagged (knn.ts).
 *
 * Rows stamped with a different model_id are left out — their vectors are not comparable (TR-23).
 * They are counted rather than silently dropped, because a non-zero count means those products
 * cannot be recognized, and those negatives silence nothing, until they are re-embedded from their
 * JPEGs (TR-24).
 */
export function loadVectorIndex(db: DB, meta: ShotMeta): { index: VectorIndex; otherModelShots: number } {
  const productRows = db.executeSync(
    'SELECT s.id, s.product_id, s.embedding FROM product_shots s ' +
      'JOIN products p ON p.id = s.product_id ' +
      'WHERE p.deleted_at IS NULL AND s.model_id = ? ' +
      'ORDER BY s.created_at, s.id',
    [meta.modelId],
  ).rows;
  const negativeRows = db.executeSync(
    'SELECT id, embedding FROM negative_shots WHERE model_id = ? ORDER BY created_at, id',
    [meta.modelId],
  ).rows;

  const index = buildIndex(meta.embeddingDim, [
    ...productRows.map(
      (row): IndexedShot => ({
        shotId: String(row.id),
        productId: String(row.product_id),
        vector: blobToVector(asBlob(row.embedding), meta.embeddingDim),
      }),
    ),
    ...negativeRows.map(
      (row): IndexedShot => ({
        shotId: String(row.id),
        productId: String(row.id),
        vector: blobToVector(asBlob(row.embedding), meta.embeddingDim),
        negative: true,
      }),
    ),
  ]);

  const otherModelShots = Number(
    db.executeSync(
      'SELECT (SELECT count(*) FROM product_shots WHERE model_id <> ?) + (SELECT count(*) FROM negative_shots WHERE model_id <> ?) AS n',
      [meta.modelId, meta.modelId],
    ).rows[0]?.n ?? 0,
  );
  return { index, otherModelShots };
}

/**
 * Every photo_path a row points at: product shots, soft-deleted products' shots, and negatives. The
 * orphan sweep deletes whatever is not in this set, so leaving out a table here deletes every one of
 * its JPEGs at the next launch (ADR-017). Trashed products keep theirs for restore (SR-32), and all of
 * them for re-embedding (TR-24).
 *
 * Throws rather than returning an empty set on failure, for the same reason.
 */
export function referencedPhotoPaths(db: DB): Set<string> {
  return new Set(
    db
      .executeSync('SELECT photo_path FROM product_shots UNION SELECT photo_path FROM negative_shots')
      .rows.map((row) => String(row.photo_path)),
  );
}

export interface ShotRow {
  readonly id: string;
  /** null for a negative. */
  readonly productId: string | null;
  readonly photoPath: string;
  readonly modelId: string;
  readonly source: ShotSource | 'negative';
  /** The shot's product is in the trash, so the index leaves it out (SR-32). */
  readonly trashed: boolean;
}

/** Every vector row in both tables, whatever its model or product state — for the gate check. */
export function listShotRows(db: DB): ShotRow[] {
  return db
    .executeSync(
      'SELECT s.id AS id, s.product_id AS product_id, s.photo_path AS photo_path, s.model_id AS model_id, ' +
        's.source AS source, (p.deleted_at IS NOT NULL) AS trashed, s.created_at AS created_at ' +
        'FROM product_shots s JOIN products p ON p.id = s.product_id ' +
        'UNION ALL ' +
        "SELECT id, NULL, photo_path, model_id, 'negative', 0, created_at FROM negative_shots " +
        'ORDER BY created_at, id',
    )
    .rows.map((row) => ({
      id: String(row.id),
      productId: row.product_id === null ? null : String(row.product_id),
      photoPath: String(row.photo_path),
      modelId: String(row.model_id),
      source: row.source === 'negative' ? 'negative' : shotSource(row.source),
      trashed: row.trashed === 1,
    }));
}

export interface ReplacedShot {
  readonly shotId: string;
  readonly photoPath: string;
}

const EXTRA_SHOT_REQUIREMENT = { correction: 'SR-07', teach: 'SR-33' } as const satisfies Record<ExtraShotSource, string>;

/**
 * Saves a frame as an extra shot on a live product, in ONE transaction: a correction (SR-07, D-3) or
 * a taught photo (SR-33). The two share 3 slots (ADR-024). If the product already holds 3, the oldest
 * extra row of either kind is removed in the same transaction (extraShotsToReplace), so a kill can
 * never leave it with 4, or with 2 and no new one.
 *
 * Throws, writing nothing, when the product is missing or in the trash: the shot must land on a
 * product that exists (TR-45).
 *
 * After it returns, which is after COMMIT, the caller:
 * - deletes each `replaced` photo. A kill first leaves orphans, which the launch sweep removes;
 * - **rebuilds** the index when anything was replaced, because the old vector is still in it.
 *   Otherwise it appends `indexed`.
 */
export function insertExtraShot(
  db: DB,
  productId: string,
  shot: NewShot,
  source: ExtraShotSource,
  meta: ShotMeta,
  now: number = Date.now(),
): { indexed: IndexedShot; replaced: readonly ReplacedShot[] } {
  assertNewShot(shot, meta);
  if (source !== 'correction' && source !== 'teach') throw new Error(`Not an extra shot source: ${String(source)}`);
  return inTransaction(db, () => {
    const live = db.executeSync('SELECT 1 FROM products WHERE id = ? AND deleted_at IS NULL', [productId]).rows.length > 0;
    if (!live) throw new Error(`No live product ${productId} to add a ${source} shot to (${EXTRA_SHOT_REQUIREMENT[source]})`);

    const existing = db.executeSync('SELECT id, source, photo_path, created_at FROM product_shots WHERE product_id = ?', [productId]).rows;
    const toReplace = new Set(
      extraShotsToReplace(existing.map((row) => ({ id: String(row.id), source: shotSource(row.source), createdAt: Number(row.created_at) }))),
    );
    const replaced = existing
      .filter((row) => toReplace.has(String(row.id)))
      .map((row) => ({ shotId: String(row.id), photoPath: String(row.photo_path) }));

    for (const { shotId } of replaced) db.executeSync('DELETE FROM product_shots WHERE id = ?', [shotId]);
    db.executeSync(
      'INSERT INTO product_shots (id, product_id, photo_path, model_id, embedding, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [shot.id, productId, shot.photoPath, meta.modelId, vectorToBlob(shot.vector), source, now],
    );
    return { indexed: { shotId: shot.id, productId, vector: shot.vector }, replaced };
  });
}

/** SR-07: a correction from the reject sheet. See insertExtraShot. */
export function insertCorrectionShot(
  db: DB,
  productId: string,
  shot: NewShot,
  meta: ShotMeta,
  now: number = Date.now(),
): { indexed: IndexedShot; replaced: readonly ReplacedShot[] } {
  return insertExtraShot(db, productId, shot, 'correction', meta, now);
}

/** SR-33: a photo from *Teach again*. See insertExtraShot. */
export function insertTeachShot(
  db: DB,
  productId: string,
  shot: NewShot,
  meta: ShotMeta,
  now: number = Date.now(),
): { indexed: IndexedShot; replaced: readonly ReplacedShot[] } {
  return insertExtraShot(db, productId, shot, 'teach', meta, now);
}

function shotSource(value: unknown): ShotSource {
  if (!(SHOT_SOURCES as readonly unknown[]).includes(value)) throw new Error(`Unknown product_shots.source: ${String(value)}`);
  return value as ShotSource;
}

export function asBlob(value: unknown): ArrayBuffer | ArrayBufferView {
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value;
  throw new Error(`embedding is not a BLOB (got ${typeof value})`);
}
