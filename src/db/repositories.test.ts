// Schema v2 repositories against real SQLite — PHASE_2_PLAN.md P2-2. Includes the three readers of
// negative_shots (E-1): the index loader, the orphan sweep's reference set, and the gate check's rows.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { referencePhotoPath, unreferencedPhotos } from '../domain/referencePhoto.ts';
import { l2Normalize, vectorToBlob } from '../domain/vector.ts';
import { migrate } from './migrate.ts';
import { deleteNegative, insertNegativeShot, listNegatives } from './negatives.ts';
import { openTestDatabase } from './nodeSqlite.testing.ts';
import {
  ambiguousProductIds,
  catalogCounts,
  firstEnrollPhotoPath,
  getProduct,
  insertProductWithShots,
  listPriceHistory,
  listProducts,
  listQuickPickProducts,
  listTrash,
  priceHistorySummary,
  productNameIncludingTrash,
  purgeProducts,
  restoreProduct,
  setAmbiguous,
  softDeleteProduct,
  updatePrice,
} from './products.ts';
import { insertCorrectionShot, listShotRows, loadVectorIndex, referencedPhotoPaths, type NewShot } from './shots.ts';

const meta = { modelId: 'mobilenet_v3_large_embedder_v1', embeddingDim: 4 };

/** A unit vector that differs per seed, so every stored shot is distinguishable. */
const vectorFor = (seed: number) => l2Normalize([1 + seed, (seed * 7) % 5, (seed * 3) % 4, 1]);
const shot = (id: string, seed = id.length): NewShot => ({ id, photoPath: referencePhotoPath(id), vector: vectorFor(seed) });

function fresh() {
  const db = openTestDatabase();
  migrate(db);
  return db;
}

function enroll(db: ReturnType<typeof fresh>, name: string, shotIds: string[], now = 1_000) {
  return insertProductWithShots(
    db,
    { name, pricePiece: 1250, pricePack: null, unitLabel: null, category: null },
    shotIds.map((id, i) => shot(id, i)),
    meta,
    now,
  ).productId;
}

describe('the three readers of negative_shots (E-1)', () => {
  test('loadVectorIndex: live products and negatives, flagged; trashed products and other models left out', () => {
    const db = fresh();
    const kape = enroll(db, 'Kape', ['k1', 'k2', 'k3']);
    const gone = enroll(db, 'Gatas', ['g1', 'g2', 'g3']);
    softDeleteProduct(db, gone, 2_000);
    insertNegativeShot(db, shot('n1', 9), 'confirm_no', meta, 3_000);
    db.executeSync(
      "INSERT INTO negative_shots (id, photo_path, model_id, embedding, source, created_at) VALUES ('n2', 'photos/n2.jpg', 'another-model', ?, 'wrong_lock', 3000)",
      [vectorToBlob(vectorFor(4))],
    );

    const { index, otherModelShots } = loadVectorIndex(db, meta);
    assert.deepEqual(index.shotIds, ['k1', 'k2', 'k3', 'n1']);
    assert.deepEqual(index.productIds, [kape, kape, kape, 'n1']);
    assert.deepEqual([...index.negativeIds], ['n1']);
    assert.equal(otherModelShots, 1);
  });

  test('referencedPhotoPaths keeps negatives\' and trashed products\' photos out of the orphan sweep', () => {
    const db = fresh();
    softDeleteProduct(db, enroll(db, 'Gatas', ['g1', 'g2', 'g3']));
    insertNegativeShot(db, shot('n1'), 'wrong_chip', meta);

    const onDisk = ['photos/g1.jpg', 'photos/g2.jpg', 'photos/g3.jpg', 'photos/n1.jpg', 'photos/stray.jpg'];
    assert.deepEqual(unreferencedPhotos(onDisk, referencedPhotoPaths(db)), ['photos/stray.jpg']);
  });

  test('listShotRows gives the gate check every vector row: sources, negatives and trashed products', () => {
    const db = fresh();
    const kape = enroll(db, 'Kape', ['k1', 'k2', 'k3'], 1_000);
    softDeleteProduct(db, enroll(db, 'Gatas', ['g1', 'g2', 'g3'], 1_100));
    insertCorrectionShot(db, kape, shot('c1'), meta, 2_000);
    insertNegativeShot(db, shot('n1'), 'confirm_no', meta, 3_000);

    assert.deepEqual(
      listShotRows(db).map((r) => [r.id, r.source, r.trashed, r.productId === null]),
      [
        ['k1', 'enroll', false, false],
        ['k2', 'enroll', false, false],
        ['k3', 'enroll', false, false],
        ['g1', 'enroll', true, false],
        ['g2', 'enroll', true, false],
        ['g3', 'enroll', true, false],
        ['c1', 'correction', false, false],
        ['n1', 'negative', false, true],
      ],
    );
    assert.deepEqual(catalogCounts(db), { products: 1, shots: 7, correctionShots: 1, negatives: 1, trashedProducts: 1 });
  });
});

describe('negatives (SR-14)', () => {
  test('insert, list newest first, delete returns the photo to remove', () => {
    const db = fresh();
    const indexed = insertNegativeShot(db, shot('n1'), 'confirm_no', meta, 1_000);
    insertNegativeShot(db, shot('n2'), 'wrong_lock', meta, 2_000);

    assert.equal(indexed.negative, true);
    assert.equal(indexed.productId, 'n1');
    assert.deepEqual(listNegatives(db).map((n) => [n.id, n.source]), [
      ['n2', 'wrong_lock'],
      ['n1', 'confirm_no'],
    ]);
    assert.equal(deleteNegative(db, 'n1'), 'photos/n1.jpg');
    assert.equal(deleteNegative(db, 'n1'), null);
    assert.deepEqual(listNegatives(db).map((n) => n.id), ['n2']);
  });

  test('refuses a bad shot or source before writing anything', () => {
    const db = fresh();
    assert.throws(() => insertNegativeShot(db, { ...shot('n1'), photoPath: '/data/photos/n1.jpg' }, 'confirm_no', meta), /TR-43/);
    assert.throws(() => insertNegativeShot(db, { ...shot('n1'), vector: Float32Array.from([1, 1, 1, 1]) }, 'confirm_no', meta), /TR-22/);
    assert.throws(() => insertNegativeShot(db, shot('n1'), 'guess' as never, meta), /Unknown negative source/);
    assert.equal(catalogCounts(db).negatives, 0);
  });
});

describe('insertCorrectionShot (SR-07, TR-42, D-3)', () => {
  test('adds up to 3 corrections, then replaces the oldest; enrollment shots are never touched', () => {
    const db = fresh();
    const kape = enroll(db, 'Kape', ['k1', 'k2', 'k3', 'k4', 'k5']);

    for (const [i, id] of ['c1', 'c2', 'c3'].entries()) {
      assert.deepEqual(insertCorrectionShot(db, kape, shot(id), meta, 2_000 + i).replaced, []);
    }
    const fourth = insertCorrectionShot(db, kape, shot('c4'), meta, 3_000);

    assert.deepEqual(fourth.replaced, [{ shotId: 'c1', photoPath: 'photos/c1.jpg' }]);
    assert.deepEqual(fourth.indexed, { shotId: 'c4', productId: kape, vector: shot('c4').vector });
    assert.deepEqual(
      listShotRows(db).map((r) => r.id),
      ['k1', 'k2', 'k3', 'k4', 'k5', 'c2', 'c3', 'c4'],
    );
  });

  test('a failed insert rolls back the replacement too, so the product never drops to 2 corrections', () => {
    const db = fresh();
    const kape = enroll(db, 'Kape', ['k1', 'k2', 'k3']);
    ['c1', 'c2', 'c3'].forEach((id, i) => insertCorrectionShot(db, kape, shot(id), meta, 2_000 + i));

    // k1 already exists, so the INSERT fails after the oldest correction's DELETE has run.
    assert.throws(() => insertCorrectionShot(db, kape, shot('k1'), meta, 3_000), /UNIQUE|PRIMARY KEY/);
    assert.equal(catalogCounts(db).correctionShots, 3);
  });

  test('refuses a product in the trash and writes nothing', () => {
    const db = fresh();
    const kape = enroll(db, 'Kape', ['k1', 'k2', 'k3']);
    softDeleteProduct(db, kape);
    assert.throws(() => insertCorrectionShot(db, kape, shot('c1'), meta), /No live product/);
    assert.equal(catalogCounts(db).correctionShots, 0);
  });
});

describe('updatePrice (SR-06, TR-41)', () => {
  test('sets both prices and keeps the prices it replaced in price_history', () => {
    const db = fresh();
    const kape = enroll(db, 'Kape', ['k1', 'k2', 'k3']);

    assert.equal(updatePrice(db, kape, { pricePiece: 1375, pricePack: 15000 }, 5_000), true);
    assert.equal(updatePrice(db, kape, { pricePiece: 1400, pricePack: null }, 6_000), true);

    const product = getProduct(db, kape)!;
    assert.deepEqual([product.pricePiece, product.pricePack, product.updatedAt], [1400, null, 6_000]);
    assert.deepEqual(listPriceHistory(db, kape), [
      { pricePiece: 1250, pricePack: null, changedAt: 5_000 },
      { pricePiece: 1375, pricePack: 15000, changedAt: 6_000 },
    ]);
  });

  test('priceHistorySummary counts every row and lists the newest first, trashed products included', () => {
    const db = fresh();
    const kape = enroll(db, 'Kape', ['k1', 'k2', 'k3']);
    const gatas = enroll(db, 'Gatas', ['g1', 'g2', 'g3']);
    updatePrice(db, kape, { pricePiece: 1300, pricePack: null }, 5_000);
    updatePrice(db, gatas, { pricePiece: 2000, pricePack: 20000 }, 6_000);
    updatePrice(db, kape, { pricePiece: 1400, pricePack: null }, 7_000);
    softDeleteProduct(db, gatas);

    const summary = priceHistorySummary(db, 2);
    assert.equal(summary.rows, 3);
    assert.deepEqual(summary.recent, [
      { productId: kape, name: 'Kape', pricePiece: 1300, pricePack: null, changedAt: 7_000 },
      { productId: gatas, name: 'Gatas', pricePiece: 1250, pricePack: null, changedAt: 6_000 },
    ]);
    assert.deepEqual(priceHistorySummary(fresh()), { rows: 0, recent: [] });
  });

  test('an edit to the same prices writes nothing', () => {
    const db = fresh();
    const kape = enroll(db, 'Kape', ['k1', 'k2', 'k3']);
    assert.equal(updatePrice(db, kape, { pricePiece: 1250, pricePack: null }, 5_000), false);
    assert.deepEqual(listPriceHistory(db, kape), []);
    assert.equal(getProduct(db, kape)!.updatedAt, 1_000);
  });

  test('refuses a product in the trash, and a price that is not whole centavos, writing nothing', () => {
    const db = fresh();
    const kape = enroll(db, 'Kape', ['k1', 'k2', 'k3']);
    assert.throws(() => updatePrice(db, kape, { pricePiece: 12.5, pricePack: null }), /TR-41/);
    softDeleteProduct(db, kape);
    assert.throws(() => updatePrice(db, kape, { pricePiece: 1300, pricePack: null }), /No live product/);
    assert.deepEqual(listPriceHistory(db, kape), []);
  });
});

describe('trash (SR-08, SR-32) and the repacked flag (SR-10)', () => {
  test('soft delete hides a product everywhere a name is read, and restore brings it back', () => {
    const db = fresh();
    const kape = enroll(db, 'Kape', ['k1', 'k2', 'k3']);

    assert.equal(softDeleteProduct(db, kape, 2_000), true);
    assert.equal(softDeleteProduct(db, kape, 2_500), false);
    assert.equal(getProduct(db, kape), null);
    assert.deepEqual(listProducts(db), []);
    assert.deepEqual(listTrash(db), [{ id: kape, name: 'Kape', deletedAt: 2_000, photoPath: 'photos/k1.jpg' }]);

    assert.equal(restoreProduct(db, kape, 3_000), true);
    assert.equal(restoreProduct(db, kape, 3_500), false);
    assert.equal(getProduct(db, kape)?.name, 'Kape');
    assert.deepEqual(listTrash(db), []);
  });

  test('delete, undo, delete again: the index rebuilt from SQLite follows each step (E-4)', () => {
    const db = fresh();
    const kape = enroll(db, 'Kape', ['k1', 'k2', 'k3']);
    const gatas = enroll(db, 'Gatas', ['g1', 'g2', 'g3']);
    const shotsOf = () => loadVectorIndex(db, meta).index.productIds;

    softDeleteProduct(db, kape, 2_000);
    assert.deepEqual(shotsOf(), [gatas, gatas, gatas]);
    restoreProduct(db, kape, 2_005);
    assert.deepEqual(new Set(shotsOf()), new Set([kape, gatas]));
    softDeleteProduct(db, kape, 3_000);
    assert.deepEqual(shotsOf(), [gatas, gatas, gatas]);
  });

  test('productNameIncludingTrash names a trashed product for the logs; getProduct does not', () => {
    const db = fresh();
    const kape = enroll(db, 'Kape', ['k1', 'k2', 'k3']);
    softDeleteProduct(db, kape);
    assert.equal(getProduct(db, kape), null);
    assert.equal(productNameIncludingTrash(db, kape), 'Kape');
    assert.equal(productNameIncludingTrash(db, 'missing'), null);
  });

  test('purge removes only products still in the trash, and returns their photos to delete', () => {
    const db = fresh();
    const kape = enroll(db, 'Kape', ['k1', 'k2', 'k3']);
    const gatas = enroll(db, 'Gatas', ['g1', 'g2', 'g3']);
    const asukal = enroll(db, 'Asukal', ['a1', 'a2', 'a3']);
    updatePrice(db, gatas, { pricePiece: 2000, pricePack: null });
    softDeleteProduct(db, gatas);
    softDeleteProduct(db, asukal);
    restoreProduct(db, asukal);

    assert.deepEqual(purgeProducts(db, [gatas, asukal, kape]).sort(), ['photos/g1.jpg', 'photos/g2.jpg', 'photos/g3.jpg']);
    assert.deepEqual(listProducts(db).map((p) => p.name), ['Asukal', 'Kape']);
    assert.deepEqual(listTrash(db), []);
    assert.deepEqual(listPriceHistory(db, gatas), []);
    assert.deepEqual(catalogCounts(db), { products: 2, shots: 6, correctionShots: 0, negatives: 0, trashedProducts: 0 });
    assert.deepEqual(purgeProducts(db, []), []);
  });

  test('enrollment writes the repacked flag, and marks live look-alikes in the same transaction (P2-5)', () => {
    const db = fresh();
    const asukal = enroll(db, 'Asukal', ['a1', 'a2', 'a3']);
    const monggo = enroll(db, 'Monggo', ['m1', 'm2', 'm3']);
    softDeleteProduct(db, monggo);

    const asin = insertProductWithShots(
      db,
      { name: 'Asin', pricePiece: 1000, pricePack: null, unitLabel: null, category: null, isAmbiguous: true },
      ['s1', 's2', 's3'].map((id, i) => shot(id, i)),
      meta,
      2_000,
      [asukal, monggo],
    ).productId;

    assert.equal(getProduct(db, asin)?.isAmbiguous, true);
    assert.equal(getProduct(db, asukal)?.isAmbiguous, true);
    assert.deepEqual(ambiguousProductIds(db).sort(), [asin, asukal].sort());
    restoreProduct(db, monggo);
    assert.equal(getProduct(db, monggo)?.isAmbiguous, false, 'a trashed product is skipped');
    assert.equal(getProduct(db, enroll(db, 'Kape', ['k1', 'k2', 'k3']))?.isAmbiguous, false, 'no flag means not repacked');
  });

  test('a failed enrollment leaves its look-alikes unmarked (TR-45)', () => {
    const db = fresh();
    const asukal = enroll(db, 'Asukal', ['a1', 'a2', 'a3']);
    assert.throws(() =>
      insertProductWithShots(
        db,
        { name: 'Asin', pricePiece: 1000, pricePack: null, unitLabel: null, category: null, isAmbiguous: true },
        [shot('a1'), shot('s2'), shot('s3')],
        meta,
        2_000,
        [asukal],
      ),
    );
    assert.equal(getProduct(db, asukal)?.isAmbiguous, false);
    assert.deepEqual(listProducts(db).map((p) => p.name), ['Asukal']);
    assert.throws(() => insertProductWithShots(db, { name: 'Asin', pricePiece: 1000, pricePack: null, unitLabel: null, category: null }, [shot('x1'), shot('x2'), shot('x3')], meta, 2_000, ['']));
  });

  test('setAmbiguous flags a live product only', () => {
    const db = fresh();
    const asukal = enroll(db, 'Asukal', ['a1', 'a2', 'a3']);
    assert.equal(setAmbiguous(db, asukal, true), true);
    assert.equal(getProduct(db, asukal)?.isAmbiguous, true);
    softDeleteProduct(db, asukal);
    assert.equal(setAmbiguous(db, asukal, false), false);
  });
});

describe('scan card reads (SR-10, SR-13)', () => {
  test('ambiguousProductIds lists live repacked products only', () => {
    const db = fresh();
    const asukal = enroll(db, 'Asukal', ['a1', 'a2', 'a3']);
    const monggo = enroll(db, 'Monggo', ['m1', 'm2', 'm3']);
    enroll(db, 'Kape', ['k1', 'k2', 'k3']);
    setAmbiguous(db, asukal, true);
    setAmbiguous(db, monggo, true);
    softDeleteProduct(db, monggo);
    assert.deepEqual(ambiguousProductIds(db), [asukal]);
  });

  test('listQuickPickProducts lists live repacked products by name, each with its first enrollment photo', () => {
    const db = fresh();
    const monggo = enroll(db, 'Monggo', ['m1', 'm2', 'm3'], 1_000);
    const asukal = enroll(db, 'asukal', ['a1', 'a2', 'a3'], 1_000);
    const asin = enroll(db, 'Asin', ['s1', 's2', 's3'], 1_000);
    enroll(db, 'Kape', ['k1', 'k2', 'k3']);
    for (const id of [monggo, asukal, asin]) setAmbiguous(db, id, true);
    insertCorrectionShot(db, asukal, shot('c1'), meta, 500);
    softDeleteProduct(db, asin);

    const tiles = listQuickPickProducts(db);
    assert.deepEqual(
      tiles.map((t) => [t.name, t.photoPath, t.isAmbiguous]),
      [
        ['asukal', 'photos/a1.jpg', true],
        ['Monggo', 'photos/m1.jpg', true],
      ],
    );
  });

  test('firstEnrollPhotoPath is the first enrollment shot, never a correction', () => {
    const db = fresh();
    const kape = enroll(db, 'Kape', ['k1', 'k2', 'k3'], 1_000);
    insertCorrectionShot(db, kape, shot('c1'), meta, 500);
    assert.equal(firstEnrollPhotoPath(db, kape), 'photos/k1.jpg');
    assert.equal(firstEnrollPhotoPath(db, 'missing'), null);
  });
});
