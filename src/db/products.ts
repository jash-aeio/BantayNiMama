import type { DB } from '@op-engineering/op-sqlite';

import type { AppMeta } from '../domain/appMeta.ts';
import { MAX_SHOTS, MIN_SHOTS, type NewProduct } from '../domain/enrollment.ts';
import type { IndexedShot } from '../domain/knn.ts';
import { isCentavos } from '../domain/money.ts';
import { vectorToBlob } from '../domain/vector.ts';
import { newId } from './ids.ts';
import { assertNewShot, type NewShot } from './shots.ts';
import { inTransaction } from './transaction.ts';

export type { NewProduct, NewShot };

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
 *
 * `markAmbiguous` (P2-5, SR-23's hint) flags existing look-alikes as repacked in the same
 * transaction. If it were a second write, a failed enrollment could leave the old product flagged
 * with no twin, or a saved twin could leave the old product unflagged and able to lock as the new
 * one (ADR-018). An id that is not a live product is skipped.
 */
export function insertProductWithShots(
  db: DB,
  product: NewProduct,
  shots: readonly NewShot[],
  meta: Pick<AppMeta, 'modelId' | 'embeddingDim'>,
  now: number = Date.now(),
  markAmbiguous: readonly string[] = [],
): { productId: string; shots: IndexedShot[] } {
  const name = product.name.trim();
  if (name === '') throw new Error('A product needs a name (SR-21)');
  assertPrices(product.pricePiece, product.pricePack);
  for (const id of markAmbiguous) {
    if (typeof id !== 'string' || id === '') throw new Error('A product to mark as repacked needs an id (SR-10)');
  }
  if (shots.length < MIN_SHOTS || shots.length > MAX_SHOTS) {
    throw new RangeError(`A product needs ${MIN_SHOTS}–${MAX_SHOTS} shots, got ${shots.length} (SR-20, TR-42)`);
  }
  const ids = new Set<string>();
  for (const shot of shots) {
    if (ids.has(shot.id)) throw new Error(`Shot id ${shot.id} appears twice`);
    ids.add(shot.id);
    assertNewShot(shot, meta);
  }

  const productId = newId();
  const indexed: IndexedShot[] = shots.map((shot) => ({ shotId: shot.id, productId, vector: shot.vector }));

  inTransaction(db, () => {
    db.executeSync(
      'INSERT INTO products (id, name, price_piece, price_pack, unit_label, category, is_ambiguous, created_at, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [productId, name, product.pricePiece, product.pricePack, product.unitLabel, product.category, product.isAmbiguous === true ? 1 : 0, now, now],
    );
    // Before the shots, so a failed shot INSERT rolls these back too (tested).
    for (const id of markAmbiguous) {
      db.executeSync('UPDATE products SET is_ambiguous = 1, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [now, id]);
    }
    for (const shot of shots) {
      db.executeSync(
        'INSERT INTO product_shots (id, product_id, photo_path, model_id, embedding, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [shot.id, productId, shot.photoPath, meta.modelId, vectorToBlob(shot.vector), 'enroll', now],
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

/**
 * A product's name whether or not it is in the trash, or null. For the gate panel's logs only, so a
 * delete and its undo still read by name. Never for the scan card, which must not name a trashed
 * product (getProduct).
 */
export function productNameIncludingTrash(db: DB, id: string): string | null {
  const row = db.executeSync('SELECT name FROM products WHERE id = ?', [id]).rows[0];
  return row === undefined ? null : String(row.name);
}

/** SR-10: live products flagged repacked, for resolveFrame's ambiguousIds. */
export function ambiguousProductIds(db: DB): string[] {
  return db
    .executeSync('SELECT id FROM products WHERE is_ambiguous = 1 AND deleted_at IS NULL ORDER BY id')
    .rows.map((row) => String(row.id));
}

export interface QuickPickProduct extends Product {
  /** The first enrollment photo, for the tile; null if the product somehow has none. */
  readonly photoPath: string | null;
}

/** SR-10, P2-5: live repacked products with a tile photo, by name. The grid's order is quickPickTiles'. */
export function listQuickPickProducts(db: DB): QuickPickProduct[] {
  return db
    .executeSync(
      'SELECT p.id, p.name, p.price_piece, p.price_pack, p.unit_label, p.category, p.is_ambiguous, p.created_at, p.updated_at, ' +
        "(SELECT s.photo_path FROM product_shots s WHERE s.product_id = p.id AND s.source = 'enroll' ORDER BY s.created_at, s.id LIMIT 1) AS photo_path " +
        'FROM products p WHERE p.is_ambiguous = 1 AND p.deleted_at IS NULL ORDER BY p.name COLLATE NOCASE, p.id',
    )
    .rows.map((row) => ({ ...rowToProduct(row), photoPath: textOrNull(row.photo_path) }));
}

/**
 * SR-13: the photo on the confirm card, the product's first enrollment shot, or null. The helper
 * compares the item with it before tapping Yes (PHASE_2_PLAN.md §8, reflexive Yes).
 */
export function firstEnrollPhotoPath(db: DB, productId: string): string | null {
  const row = db.executeSync(
    "SELECT photo_path FROM product_shots WHERE product_id = ? AND source = 'enroll' ORDER BY created_at, id LIMIT 1",
    [productId],
  ).rows[0];
  return row === undefined ? null : String(row.photo_path);
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

/**
 * SR-06: sets both prices and records the change, in ONE transaction. Returns false, writing
 * nothing, when the prices are already these. planPriceEdit decides that first, and this checks it
 * again, so a no-op can never add a history row.
 *
 * **A `price_history` row holds the prices in force *before* `changed_at`.** The current prices stay in
 * `products`. So the first edit keeps the price a product was enrolled at, including for the Phase 1
 * products that have no history row.
 *
 * Throws, writing nothing, when the product is missing or in the trash. The editor is bound to the
 * product id captured at tap time (gate A2), and a price must never land on something else.
 */
export function updatePrice(
  db: DB,
  productId: string,
  prices: { readonly pricePiece: number; readonly pricePack: number | null },
  now: number = Date.now(),
): boolean {
  assertPrices(prices.pricePiece, prices.pricePack);
  return inTransaction(db, () => {
    const row = db.executeSync('SELECT price_piece, price_pack FROM products WHERE id = ? AND deleted_at IS NULL', [productId]).rows[0];
    if (row === undefined) throw new Error(`No live product ${productId} to reprice (SR-06)`);
    const before = { pricePiece: storedCentavos(row.price_piece), pricePack: storedCentavos(row.price_pack) };
    if (before.pricePiece === prices.pricePiece && before.pricePack === prices.pricePack) return false;

    db.executeSync('UPDATE products SET price_piece = ?, price_pack = ?, updated_at = ? WHERE id = ?', [
      prices.pricePiece,
      prices.pricePack,
      now,
      productId,
    ]);
    db.executeSync('INSERT INTO price_history (id, product_id, price_piece, price_pack, changed_at) VALUES (?, ?, ?, ?, ?)', [
      newId(),
      productId,
      before.pricePiece,
      before.pricePack,
      now,
    ]);
    return true;
  });
}

export interface PriceHistoryRow {
  /** The prices in force until changedAt. */
  readonly pricePiece: number | null;
  readonly pricePack: number | null;
  readonly changedAt: number;
}

/** Oldest first. */
export function listPriceHistory(db: DB, productId: string): PriceHistoryRow[] {
  return db
    .executeSync('SELECT price_piece, price_pack, changed_at FROM price_history WHERE product_id = ? ORDER BY changed_at, id', [productId])
    .rows.map((row) => ({
      pricePiece: storedCentavos(row.price_piece),
      pricePack: storedCentavos(row.price_pack),
      changedAt: Number(row.changed_at),
    }));
}

export interface PriceChange {
  readonly productId: string;
  readonly name: string;
  /** The prices in force until changedAt (ADR-021). */
  readonly pricePiece: number | null;
  readonly pricePack: number | null;
  readonly changedAt: number;
}

/**
 * Every price_history row counted, and the newest few, whatever each product's state. For the gate
 * panel only: gate A2 checks the change is recorded, and release builds do not log (P1-7).
 */
export function priceHistorySummary(db: DB, limit = 5): { rows: number; recent: PriceChange[] } {
  const rows = Number(db.executeSync('SELECT count(*) AS n FROM price_history').rows[0]?.n ?? 0);
  const recent = db
    .executeSync(
      'SELECT h.product_id, p.name, h.price_piece, h.price_pack, h.changed_at FROM price_history h ' +
        'JOIN products p ON p.id = h.product_id ORDER BY h.changed_at DESC, h.id DESC LIMIT ?',
      [limit],
    )
    .rows.map((row) => ({
      productId: String(row.product_id),
      name: String(row.name),
      pricePiece: storedCentavos(row.price_piece),
      pricePack: storedCentavos(row.price_pack),
      changedAt: Number(row.changed_at),
    }));
  return { rows, recent };
}

/**
 * SR-08, SR-32: moves a live product to the trash. Its shots and photos stay, for restore and for
 * re-embedding (TR-24). Returns false when there was no live product to delete. Afterwards the caller
 * rebuilds the index (E-4).
 */
export function softDeleteProduct(db: DB, id: string, now: number = Date.now()): boolean {
  return (
    db.executeSync('UPDATE products SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [now, now, id])
      .rowsAffected > 0
  );
}

/** SR-32: undo, or restore from the trash. Returns false when the product was not in the trash. The caller rebuilds the index. */
export function restoreProduct(db: DB, id: string, now: number = Date.now()): boolean {
  return (
    db.executeSync('UPDATE products SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL', [now, id])
      .rowsAffected > 0
  );
}

/** SR-10: the *repacked* flag, on a live product. Returns false when there was none. */
export function setAmbiguous(db: DB, id: string, ambiguous: boolean, now: number = Date.now()): boolean {
  return (
    db.executeSync('UPDATE products SET is_ambiguous = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [
      ambiguous ? 1 : 0,
      now,
      id,
    ]).rowsAffected > 0
  );
}

export interface TrashItem {
  readonly id: string;
  readonly name: string;
  readonly deletedAt: number;
  /** The first enrollment photo, for a thumbnail; null if the product somehow has none. */
  readonly photoPath: string | null;
}

/** Most recently deleted first (SR-32). */
export function listTrash(db: DB): TrashItem[] {
  return db
    .executeSync(
      'SELECT p.id, p.name, p.deleted_at, ' +
        "(SELECT s.photo_path FROM product_shots s WHERE s.product_id = p.id AND s.source = 'enroll' ORDER BY s.created_at, s.id LIMIT 1) AS photo_path " +
        'FROM products p WHERE p.deleted_at IS NOT NULL ORDER BY p.deleted_at DESC, p.id',
    )
    .rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      deletedAt: Number(row.deleted_at),
      photoPath: textOrNull(row.photo_path),
    }));
}

/**
 * SR-32: removes trashed products for good. Rows go in ONE transaction, shots and history before the
 * product (foreign keys). The photo paths come back for the caller to delete after COMMIT. A kill in
 * between leaves orphan photos, which the launch sweep removes (invariant 7).
 *
 * An id that is not in the trash, because it was restored or never deleted, is skipped. Which ids are
 * old enough is trash.ts's call (purgeableIds).
 */
export function purgeProducts(db: DB, ids: readonly string[]): string[] {
  if (ids.length === 0) return [];
  return inTransaction(db, () => {
    const photoPaths: string[] = [];
    for (const id of ids) {
      if (db.executeSync('SELECT 1 FROM products WHERE id = ? AND deleted_at IS NOT NULL', [id]).rows.length === 0) continue;
      for (const row of db.executeSync('SELECT photo_path FROM product_shots WHERE product_id = ?', [id]).rows) {
        photoPaths.push(String(row.photo_path));
      }
      db.executeSync('DELETE FROM product_shots WHERE product_id = ?', [id]);
      db.executeSync('DELETE FROM price_history WHERE product_id = ?', [id]);
      db.executeSync('DELETE FROM products WHERE id = ?', [id]);
    }
    return photoPaths;
  });
}

export interface CatalogCounts {
  /** Live products. */
  readonly products: number;
  /** Every product_shots row, trashed products' included. */
  readonly shots: number;
  readonly correctionShots: number;
  readonly negatives: number;
  readonly trashedProducts: number;
}

/** The gate's persistence check counts these (PHASE_1_PLAN.md §4, PHASE_2_PLAN.md §4 A1). */
export function catalogCounts(db: DB): CatalogCounts {
  const row = db.executeSync(
    'SELECT (SELECT count(*) FROM products WHERE deleted_at IS NULL) AS products, ' +
      '(SELECT count(*) FROM product_shots) AS shots, ' +
      "(SELECT count(*) FROM product_shots WHERE source = 'correction') AS correction_shots, " +
      '(SELECT count(*) FROM negative_shots) AS negatives, ' +
      '(SELECT count(*) FROM products WHERE deleted_at IS NOT NULL) AS trashed_products',
  ).rows[0];
  return {
    products: Number(row?.products ?? 0),
    shots: Number(row?.shots ?? 0),
    correctionShots: Number(row?.correction_shots ?? 0),
    negatives: Number(row?.negatives ?? 0),
    trashedProducts: Number(row?.trashed_products ?? 0),
  };
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

function assertPrices(pricePiece: number, pricePack: number | null): void {
  if (!isCentavos(pricePiece)) {
    throw new RangeError(`Per-piece price must be whole centavos, got ${pricePiece} (TR-41)`);
  }
  if (pricePack !== null && !isCentavos(pricePack)) {
    throw new RangeError(`Per-pack price must be whole centavos, got ${pricePack} (TR-41)`);
  }
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
