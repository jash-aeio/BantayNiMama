// Taught photos against real SQLite — SR-33, ADR-024: they share the 3 extra slots with corrections.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { referencePhotoPath } from '../domain/referencePhoto.ts';
import { l2Normalize } from '../domain/vector.ts';
import { migrate } from './migrate.ts';
import { openTestDatabase } from './nodeSqlite.testing.ts';
import { catalogCounts, insertProductWithShots, shotCounts, softDeleteProduct } from './products.ts';
import { insertCorrectionShot, insertExtraShot, insertTeachShot, listShotRows, loadVectorIndex, type NewShot } from './shots.ts';

const meta = { modelId: 'mobilenet_v3_large_embedder_v1', embeddingDim: 4 };
const vectorFor = (seed: number) => l2Normalize([1 + seed, (seed * 7) % 5, (seed * 3) % 4, 1]);
const shot = (id: string, seed = id.length): NewShot => ({ id, photoPath: referencePhotoPath(id), vector: vectorFor(seed) });

function freshWithKape(shotIds = ['k1', 'k2', 'k3', 'k4', 'k5']) {
  const db = openTestDatabase();
  migrate(db);
  const kape = insertProductWithShots(
    db,
    { name: 'Kape', pricePiece: 1000, pricePack: null, unitLabel: null, category: null },
    shotIds.map((id, i) => shot(id, i)),
    meta,
    1_000,
  ).productId;
  return { db, kape };
}

describe('insertTeachShot (SR-33, ADR-024)', () => {
  test('a product enrolled with all 5 photos can still be taught', () => {
    const { db, kape } = freshWithKape();
    const written = insertTeachShot(db, kape, shot('t1'), meta, 2_000);
    assert.deepEqual(written.replaced, []);
    assert.deepEqual(shotCounts(db, kape), { enroll: 5, correction: 0, teach: 1 });
    assert.ok(loadVectorIndex(db, meta).index.shotIds.includes('t1'));
  });

  test('taught photos and corrections share 3 slots; the oldest of either goes, enrollment never', () => {
    const { db, kape } = freshWithKape();
    insertTeachShot(db, kape, shot('t1'), meta, 2_000);
    insertCorrectionShot(db, kape, shot('c1'), meta, 3_000);
    insertTeachShot(db, kape, shot('t2'), meta, 4_000);

    const fourth = insertCorrectionShot(db, kape, shot('c2'), meta, 5_000);
    assert.deepEqual(fourth.replaced, [{ shotId: 't1', photoPath: 'photos/t1.jpg' }]);
    const fifth = insertTeachShot(db, kape, shot('t3'), meta, 6_000);
    assert.deepEqual(fifth.replaced, [{ shotId: 'c1', photoPath: 'photos/c1.jpg' }]);

    assert.deepEqual(
      listShotRows(db).map((r) => [r.id, r.source]),
      [
        ['k1', 'enroll'],
        ['k2', 'enroll'],
        ['k3', 'enroll'],
        ['k4', 'enroll'],
        ['k5', 'enroll'],
        ['t2', 'teach'],
        ['c2', 'correction'],
        ['t3', 'teach'],
      ],
    );
    assert.equal(catalogCounts(db).shots, 8);
  });

  test('refuses a product in the trash, and a source that is not an extra, writing nothing', () => {
    const { db, kape } = freshWithKape(['k1', 'k2', 'k3']);
    assert.throws(() => insertExtraShot(db, kape, shot('x1'), 'enroll' as never, meta), /Not an extra shot source/);
    softDeleteProduct(db, kape);
    assert.throws(() => insertTeachShot(db, kape, shot('t1'), meta), /No live product .* teach shot .*SR-33/);
    assert.deepEqual(shotCounts(db, kape), { enroll: 3, correction: 0, teach: 0 });
  });
});
