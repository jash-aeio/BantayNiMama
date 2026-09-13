import type { DB } from '@op-engineering/op-sqlite';

import type { AppMeta } from '../domain/appMeta.ts';
import type { IndexedShot } from '../domain/knn.ts';
import { isCentavos } from '../domain/money.ts';
import { isRelativePhotoPath } from '../domain/photoPath.ts';
import { dot, vectorToBlob } from '../domain/vector.ts';
import { newId } from './ids';
import { inTransaction } from './transaction';

/** SR-20 asks for 3–5 reference photos; TR-42 caps them at 5. */
export const MIN_SHOTS = 3;
export const MAX_SHOTS = 5;

export interface NewProduct {
  readonly name: string;
  /** Whole centavos (TR-41). */
  readonly pricePiece: number;
  readonly pricePack: number | null;
  readonly unitLabel: string | null;
  readonly category: string | null;
}

export interface NewShot {
  /** Relative to the document directory (TR-43). */
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
  for (const shot of shots) {
    if (!isRelativePhotoPath(shot.photoPath)) {
      throw new Error(`Photo path must be relative to the document directory, got "${shot.photoPath}" (TR-43)`);
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
  const indexed: IndexedShot[] = shots.map((shot) => ({ shotId: newId(), productId, vector: shot.vector }));

  inTransaction(db, () => {
    db.executeSync(
      'INSERT INTO products (id, name, price_piece, price_pack, unit_label, category, created_at, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [productId, name, product.pricePiece, product.pricePack, product.unitLabel, product.category, now, now],
    );
    shots.forEach((shot, i) => {
      db.executeSync(
        'INSERT INTO product_shots (id, product_id, photo_path, model_id, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [indexed[i]!.shotId, productId, shot.photoPath, meta.modelId, vectorToBlob(shot.vector), now],
      );
    });
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
  if (row === undefined) return null;
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

function storedCentavos(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  // The schema's CHECK should make this unreachable; if it is not, never show the price.
  if (!isCentavos(value)) throw new Error(`Stored price is not whole centavos: ${String(value)} (TR-41)`);
  return value;
}

function textOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}
