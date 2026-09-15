// The Directory's repositories against real SQLite — PHASE_2_PLAN.md P2-7 (SR-30–SR-34).

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { referencePhotoPath } from '../domain/referencePhoto.ts';
import { TRASH_RETENTION_MS } from '../domain/trash.ts';
import { l2Normalize } from '../domain/vector.ts';
import { migrate } from './migrate.ts';
import { openTestDatabase } from './nodeSqlite.testing.ts';
import {
  getProduct,
  insertProductWithShots,
  listDirectory,
  listPriceHistory,
  listTrash,
  markScanned,
  purgeExpiredTrash,
  restoreProduct,
  shotCounts,
  softDeleteProduct,
  updateProduct,
} from './products.ts';
import { insertCorrectionShot, type NewShot } from './shots.ts';

const meta = { modelId: 'mobilenet_v3_large_embedder_v1', embeddingDim: 4 };
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
    { name, pricePiece: 1250, pricePack: null, unitLabel: 'sachet', category: null },
    shotIds.map((id, i) => shot(id, i)),
    meta,
    now,
  ).productId;
}

const details = { name: 'Kape', unitLabel: 'sachet', category: null, isAmbiguous: false };

describe('listDirectory (SR-30, SR-34)', () => {
  test('live products with shot count, thumbnail and last scanned time; the trash left out', () => {
    const db = fresh();
    const kape = enroll(db, 'Kape', ['k1', 'k2', 'k3'], 1_000);
    const gatas = enroll(db, 'Gatas', ['g1', 'g2', 'g3'], 2_000);
    insertCorrectionShot(db, kape, shot('c1'), meta, 500);
    softDeleteProduct(db, enroll(db, 'Asin', ['a1', 'a2', 'a3']));
    markScanned(db, [kape], 9_000);

    assert.deepEqual(
      listDirectory(db).map((p) => [p.name, p.shots, p.photoPath, p.lastScannedAt, p.createdAt]),
      [
        ['Gatas', 3, 'photos/g1.jpg', null, 2_000],
        ['Kape', 4, 'photos/k1.jpg', 9_000, 1_000],
      ],
    );
    assert.equal(listDirectory(db).find((p) => p.id === gatas)?.unitLabel, 'sachet');
  });
});

describe('updateProduct (SR-31)', () => {
  test('a rename writes the details and no price_history row', () => {
    const db = fresh();
    const kape = enroll(db, 'Kape', ['k1', 'k2', 'k3']);
    assert.deepEqual(updateProduct(db, kape, { ...details, name: 'Kape Barako', category: 'kape' }, null, 5_000), {
      detailsChanged: true,
      pricesChanged: false,
    });
    const product = getProduct(db, kape)!;
    assert.deepEqual([product.name, product.category, product.pricePiece, product.updatedAt], ['Kape Barako', 'kape', 1250, 5_000]);
    assert.deepEqual(listPriceHistory(db, kape), []);
  });

  test('a price change in the same edit keeps the replaced prices in price_history (ADR-021)', () => {
    const db = fresh();
    const kape = enroll(db, 'Kape', ['k1', 'k2', 'k3']);
    updateProduct(db, kape, { ...details, isAmbiguous: true }, { pricePiece: 1400, pricePack: 13000 }, 6_000);
    const product = getProduct(db, kape)!;
    assert.deepEqual([product.pricePiece, product.pricePack, product.isAmbiguous], [1400, 13000, true]);
    assert.deepEqual(listPriceHistory(db, kape), [{ pricePiece: 1250, pricePack: null, changedAt: 6_000 }]);
  });

  test('the same values write nothing, not even updated_at', () => {
    const db = fresh();
    const kape = enroll(db, 'Kape', ['k1', 'k2', 'k3']);
    assert.deepEqual(updateProduct(db, kape, details, { pricePiece: 1250, pricePack: null }, 7_000), {
      detailsChanged: false,
      pricesChanged: false,
    });
    assert.equal(getProduct(db, kape)!.updatedAt, 1_000);
    assert.deepEqual(listPriceHistory(db, kape), []);
  });

  test('refuses a trashed product, a blank name and a price that is not whole centavos, writing nothing', () => {
    const db = fresh();
    const kape = enroll(db, 'Kape', ['k1', 'k2', 'k3']);
    assert.throws(() => updateProduct(db, kape, { ...details, name: '  ' }, null), /name/);
    assert.throws(() => updateProduct(db, kape, details, { pricePiece: 12.5, pricePack: null }), /TR-41/);
    softDeleteProduct(db, kape);
    assert.throws(() => updateProduct(db, kape, { ...details, name: 'X' }, null), /No live product/);
    restoreProduct(db, kape);
    assert.equal(getProduct(db, kape)!.name, 'Kape');
  });
});

describe('markScanned (SR-34)', () => {
  test('stamps live products only, once per id', () => {
    const db = fresh();
    const kape = enroll(db, 'Kape', ['k1', 'k2', 'k3']);
    const gatas = enroll(db, 'Gatas', ['g1', 'g2', 'g3']);
    softDeleteProduct(db, gatas);
    assert.equal(markScanned(db, [kape, kape, gatas, ''], 8_000), 1);
    assert.equal(markScanned(db, []), 0);
    assert.equal(listDirectory(db)[0]?.lastScannedAt, 8_000);
    assert.equal(getProduct(db, kape)!.updatedAt, 1_000, 'a scan is not an edit');
  });
});

describe('shotCounts (SR-33)', () => {
  test('counts by source', () => {
    const db = fresh();
    const kape = enroll(db, 'Kape', ['k1', 'k2', 'k3', 'k4', 'k5']);
    insertCorrectionShot(db, kape, shot('c1'), meta);
    assert.deepEqual(shotCounts(db, kape), { enroll: 5, correction: 1, teach: 0 });
    assert.deepEqual(shotCounts(db, 'missing'), { enroll: 0, correction: 0, teach: 0 });
  });
});

describe('purgeExpiredTrash (SR-32)', () => {
  test('purges only products trashed at least 30 days ago, and deletes their photos after the rows', () => {
    const db = fresh();
    const now = 100 * 24 * 60 * 60 * 1000;
    const old = enroll(db, 'Old', ['o1', 'o2', 'o3']);
    const young = enroll(db, 'Young', ['y1', 'y2', 'y3']);
    enroll(db, 'Live', ['l1', 'l2', 'l3']);
    softDeleteProduct(db, old, now - TRASH_RETENTION_MS);
    softDeleteProduct(db, young, now - TRASH_RETENTION_MS + 1);

    const deleted: string[] = [];
    assert.equal(
      purgeExpiredTrash(db, now, (path) => deleted.push(path)),
      1,
    );
    assert.deepEqual(deleted.sort(), ['photos/o1.jpg', 'photos/o2.jpg', 'photos/o3.jpg']);
    assert.deepEqual(listTrash(db).map((t) => t.name), ['Young']);
    assert.deepEqual(listDirectory(db).map((p) => p.name), ['Live']);
  });

  test('a photo that fails to delete does not stop the purge; the orphan sweep takes it', () => {
    const db = fresh();
    const now = 100 * 24 * 60 * 60 * 1000;
    softDeleteProduct(db, enroll(db, 'Old', ['o1', 'o2', 'o3']), 0);
    assert.equal(
      purgeExpiredTrash(db, now, () => {
        throw new Error('disk');
      }),
      1,
    );
    assert.deepEqual(listTrash(db), []);
  });

  test('nothing in the trash purges nothing', () => {
    const db = fresh();
    enroll(db, 'Live', ['l1', 'l2', 'l3']);
    assert.equal(purgeExpiredTrash(db, Date.now(), () => assert.fail('no photo should be deleted')), 0);
  });
});
