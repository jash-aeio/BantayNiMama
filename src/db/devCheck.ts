import type { DB } from '@op-engineering/op-sqlite';

import { nearestShots } from '../domain/knn.ts';
import { l2Normalize } from '../domain/vector.ts';
import { readAppMeta } from './meta';
import { migrate } from './migrate';
import { openDatabase } from './open';
import { getProduct, insertProductWithShots } from './products';
import { loadVectorIndex } from './shots';
import { inTransaction } from './transaction';

// P1-2 device check — the plan's "done when" (docs/PHASE_1_PLAN.md). Three things on the phone:
//   1. The real bantay.db migrates to schema v1 and app_meta parses.
//   2. enroll → close → reopen → search: a product written in one connection is found by its own
//      vector in the next, with the price intact (TR-45, TR-41, ADR-014).
//   3. A transaction that throws leaves no row behind (TR-45).
// Checks 2 and 3 use a throwaway database file that is deleted afterwards.
// Temporary: replaced by real enrollment in P1-5.

const THROWAWAY_DB = 'p1-2-storage-check.db';
const PRICE = 1250; // ₱12.50

export function runStorageCheck(): string {
  return [
    check('migrate bantay.db', migrateMainDatabase),
    check('enroll → close → reopen → search', roundTrip),
    check('failed transaction rolls back (TR-45)', rollback),
  ].join('\n');
}

function migrateMainDatabase(): string {
  const db = openDatabase();
  try {
    const { from, to } = migrate(db);
    const meta = readAppMeta(db);
    return (
      `schema ${from} → ${to} · ${meta.modelId} · ${meta.embeddingDim}-d · ` +
      `τ ${meta.thresholds.tau} δ ${meta.thresholds.delta} · confirm_below ${meta.confirmBelow ?? 'not set'}`
    );
  } finally {
    db.close();
  }
}

function roundTrip(): string {
  freshThrowaway().close();
  const written = enrollInOneConnection();

  const db = openDatabase(THROWAWAY_DB);
  try {
    const meta = readAppMeta(db);
    const t0 = performance.now();
    const { index } = loadVectorIndex(db, meta);
    const loadMs = performance.now() - t0;

    const top = nearestShots(index, written.query, 1)[0];
    const product = getProduct(db, written.productId);

    if (index.size !== written.shotCount) throw new Error(`reopened with ${index.size} shots, wrote ${written.shotCount}`);
    if (top === undefined || top.shotId !== written.queryShotId) {
      throw new Error(`nearest shot is ${top?.shotId ?? 'none'}, expected ${written.queryShotId}`);
    }
    if (Math.abs(top.similarity - 1) > 1e-5) throw new Error(`own-shot similarity ${top.similarity}, expected 1`);
    if (product?.pricePiece !== PRICE) throw new Error(`price came back as ${product?.pricePiece}, wrote ${PRICE}`);

    return (
      `${index.size} shots reloaded in ${loadMs.toFixed(1)} ms · own shot top-1 at ${top.similarity.toFixed(6)} · ` +
      `price ${product.pricePiece} centavos`
    );
  } finally {
    db.delete();
  }
}

function enrollInOneConnection(): { productId: string; queryShotId: string; query: Float32Array; shotCount: number } {
  const db = openDatabase(THROWAWAY_DB);
  try {
    migrate(db);
    const meta = readAppMeta(db);
    const vectors = [0, 1, 2].map((seed) => unitVector(meta.embeddingDim, seed));
    const written = insertProductWithShots(
      db,
      { name: 'Storage check', pricePiece: PRICE, pricePack: null, unitLabel: 'piraso', category: null },
      vectors.map((vector, i) => ({ photoPath: `photos/storage-check-${i}.jpg`, vector })),
      meta,
    );
    return { productId: written.productId, queryShotId: written.shots[1]!.shotId, query: vectors[1]!, shotCount: vectors.length };
  } finally {
    db.close();
  }
}

function rollback(): string {
  const db = freshThrowaway();
  try {
    migrate(db);
    const deliberate = new Error('deliberate failure after the first INSERT');
    try {
      inTransaction(db, () => {
        db.executeSync(
          "INSERT INTO products (id, name, price_piece, created_at, updated_at) VALUES ('rollback-check', 'Rollback check', 100, 0, 0)",
        );
        throw deliberate;
      });
    } catch (e) {
      if (e !== deliberate) throw e;
    }
    const count = Number(db.executeSync("SELECT count(*) AS n FROM products WHERE id = 'rollback-check'").rows[0]?.n);
    if (count !== 0) throw new Error(`the row survived the rollback (count ${count})`);
    return 'the half-written product is gone';
  } finally {
    db.delete();
  }
}

/** Opens the throwaway file after deleting any copy a crashed earlier run left behind. */
function freshThrowaway(): DB {
  openDatabase(THROWAWAY_DB).delete();
  return openDatabase(THROWAWAY_DB);
}

/** A deterministic unit vector; different seeds point in clearly different directions. */
function unitVector(dim: number, seed: number): Float32Array {
  return l2Normalize(Array.from({ length: dim }, (_, i) => Math.sin((i + 1) * (seed + 1) * 0.7)));
}

function check(name: string, run: () => string): string {
  try {
    return `OK   ${name}: ${run()}`;
  } catch (e) {
    return `FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`;
  }
}
