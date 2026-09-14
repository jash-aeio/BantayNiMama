import type { DB } from '@op-engineering/op-sqlite';

import type { AppMeta } from '../domain/appMeta.ts';
import { MAX_SHOTS, MIN_SHOTS, type NewProduct } from '../domain/enrollment.ts';
import type { IndexedShot } from '../domain/knn.ts';
import { isCentavos } from '../domain/money.ts';
import { referencePhotoPath } from '../domain/referencePhoto.ts';
import { dot, vectorToBlob } from '../domain/vector.ts';
import { newId } from './ids';
import { inTransaction } from './transaction';

export type { NewProduct };

export interface NewShot {
  /** Chosen when the shot was captured, because the photo was already saved under it. */
  readonly id: string;
  /** Relative to the document directory (TR-43); must be referencePhotoPath(id). */
  readonly photoPath: string;
  /** L2-normalized (TR-22), produced by the model named in app_meta (TR-23). */
  readonly vector: Float32Array;
}

export interface Product {
  readonly id: string;
  readonly name: string;
  readonly pricePiece: number | null;
  readonly pricePack: number | null;
  readonly unitLabel: string | null;
  readonly category: string | null;
  readonly isAmbiguous: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/**
 * Writes a product and all of its shots in ONE transaction (TR-45), and returns the shots ready
 * for appendToIndex.
 *
 * Everything is validated before BEGIN, so bad input never opens a transaction. The caller must
 * add the returned shots to the search index only after this returns — that is, after COMMIT —
 * so a rolled-back enrollment can never be matched (ARCHITECTURE.md §5, invariant 6).
 */
export function insertProductWithShots(
  db: DB,
  product: NewProduct,
  shots: readonly NewShot[],
  meta: Pick<AppMeta, 'modelId' | 'embeddingDim'>,
  now: number = Date.now(),
): { productId: string; shots: IndexedShot[] } {
  const name = product.name.trim();
  if (name === '') throw new Error('A product needs a name (SR-21)');
  if (!isCentavos(product.pricePiece)) {
    throw new RangeError(`Per-piece price must be whole centavos, got ${product.pricePiece} (TR-41)`);
  }
  if (product.pricePack !== null && !isCentavos(product.pricePack)) {
    throw new RangeError(`Per-pack price must be whole centavos, got ${product.pricePack} (TR-41)`);
  }
  if (shots.length < MIN_SHOTS || shots.length > MAX_SHOTS) {
    throw new RangeError(`A product needs ${MIN_SHOTS}–${MAX_SHOTS} shots, got ${shots.length} (SR-20, TR-42)`);
  }
  const ids = new Set<string>();
  for (const shot of shots) {
    if (ids.has(shot.id)) throw new Error(`Shot id ${shot.id} appears twice`);
    ids.add(shot.id);
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

  const productId = newId();
  const indexed: IndexedShot[] = shots.map((shot) => ({ shotId: shot.id, productId, vector: shot.vector }));

  inTransaction(db, () => {
    db.executeSync(
      'INSERT INTO products (id, name, price_piece, price_pack, unit_label, category, created_at, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [productId, name, product.pricePiece, product.pricePack, product.unitLabel, product.category, now, now],
    );
    for (const shot of shots) {
      db.executeSync(
        'INSERT INTO product_shots (id, product_id, photo_path, model_id, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [shot.id, productId, shot.photoPath, meta.modelId, vectorToBlob(shot.vector), now],
      );
    }
  });

  return { productId, shots: indexed };
}

/** A live (not soft-deleted) product, or null. */
export function getProduct(db: DB, id: string): Product | null {
  const row = db.executeSync(
    'SELECT id, name, price_piece, price_pack, unit_label, category, is_ambiguous, created_at, updated_at ' +
      'FROM products WHERE id = ? AND deleted_at IS NULL',
    [id],
  ).rows[0];
  return row === undefined ? null : rowToProduct(row);
}

export interface ProductListItem extends Product {
  readonly shots: number;
}

/** Live products with their shot counts, by name — the Products tab (P1-7). Not SR-30's search. */
export function listProducts(db: DB): ProductListItem[] {
  return db
    .executeSync(
      'SELECT p.id, p.name, p.price_piece, p.price_pack, p.unit_label, p.category, p.is_ambiguous, p.created_at, p.updated_at, ' +
        '(SELECT count(*) FROM product_shots s WHERE s.product_id = p.id) AS shots ' +
        'FROM products p WHERE p.deleted_at IS NULL ORDER BY p.name COLLATE NOCASE, p.id',
    )
    .rows.map((row) => ({ ...rowToProduct(row), shots: Number(row.shots) }));
}

function rowToProduct(row: Record<string, unknown>): Product {
  return {
    id: String(row.id),
    name: String(row.name),
    pricePiece: storedCentavos(row.price_piece),
    pricePack: storedCentavos(row.price_pack),
    unitLabel: textOrNull(row.unit_label),
    category: textOrNull(row.category),
    isAmbiguous: row.is_ambiguous === 1,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

/** Live products and all shot rows — the gate's persistence check counts these (PHASE_1_PLAN.md §4). */
export function catalogCounts(db: DB): { products: number; shots: number } {
  const row = db.executeSync(
    'SELECT (SELECT count(*) FROM products WHERE deleted_at IS NULL) AS products, (SELECT count(*) FROM product_shots) AS shots',
  ).rows[0];
  return { products: Number(row?.products ?? 0), shots: Number(row?.shots ?? 0) };
}

function storedCentavos(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  // The schema's CHECK should make this unreachable; if it is not, never show the price.
  if (!isCentavos(value)) throw new Error(`Stored price is not whole centavos: ${String(value)} (TR-41)`);
  return value;
}

function textOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}
