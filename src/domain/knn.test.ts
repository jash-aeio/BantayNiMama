import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { appendToIndex, buildIndex, KNN_LIMIT, nearestShots, type IndexedShot } from './knn.ts';

const shot = (shotId: string, productId: string, vector: number[]): IndexedShot => ({ shotId, productId, vector });

/** Deterministic pseudo-random vectors, so the brute-force comparison is repeatable. */
function randomShots(count: number, dim: number, seed: number): IndexedShot[] {
  let a = seed;
  const rng = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, (_, i) =>
    shot(`s${i}`, `p${Math.floor(i / 5)}`, Array.from({ length: dim }, () => rng() * 2 - 1)),
  );
}

describe('nearestShots (TR-30, ADR-014)', () => {
  test('returns the same top 10 as scoring and sorting every shot', () => {
    const dim = 16;
    const shots = randomShots(300, dim, 7);
    const index = buildIndex(dim, shots);
    const query = Float32Array.from(randomShots(1, dim, 99)[0]!.vector);

    const matrixRow = (i: number) => index.matrix.subarray(i * dim, (i + 1) * dim);
    const expected = shots
      .map((s, i) => ({ shotId: s.shotId, similarity: matrixRow(i).reduce((sum, x, d) => sum + x * query[d]!, 0) }))
      .sort((x, y) => y.similarity - x.similarity)
      .slice(0, KNN_LIMIT);

    const hits = nearestShots(index, query);
    assert.deepEqual(hits.map((h) => h.shotId), expected.map((e) => e.shotId));
    hits.forEach((h, i) => assert.ok(Math.abs(h.similarity - expected[i]!.similarity) < 1e-9));
  });

  test('carries shot and product ids with each hit, best first', () => {
    const index = buildIndex(2, [shot('a1', 'a', [1, 0]), shot('b1', 'b', [0, 1]), shot('a2', 'a', [0.5, 0.5])]);
    assert.deepEqual(nearestShots(index, [1, 0], 2), [
      { shotId: 'a1', productId: 'a', similarity: 1 },
      { shotId: 'a2', productId: 'a', similarity: 0.5 },
    ]);
  });

  test('returns every shot when there are fewer than k', () => {
    const index = buildIndex(2, [shot('a1', 'a', [1, 0]), shot('b1', 'b', [0, 1])]);
    assert.equal(nearestShots(index, [1, 0]).length, 2);
  });

  test('returns nothing from an empty index', () => {
    assert.deepEqual(nearestShots(buildIndex(2, []), [1, 0]), []);
  });

  test('keeps index order among equal scores', () => {
    const index = buildIndex(2, [shot('first', 'a', [1, 0]), shot('second', 'b', [1, 0]), shot('third', 'c', [1, 0])]);
    assert.deepEqual(nearestShots(index, [1, 0], 2).map((h) => h.shotId), ['first', 'second']);
  });

  test('never ranks a non-finite similarity (NFR-02)', () => {
    const index = buildIndex(2, [shot('nan', 'x', [NaN, 0]), shot('inf', 'y', [Infinity, 0]), shot('ok', 'z', [0.5, 0])]);
    assert.deepEqual(nearestShots(index, [1, 0]).map((h) => h.shotId), ['ok']);
  });

  test('refuses a query of the wrong dimension (TR-23)', () => {
    assert.throws(() => nearestShots(buildIndex(3, []), [1, 0]), RangeError);
  });

  test('refuses a non-positive k', () => {
    assert.throws(() => nearestShots(buildIndex(2, []), [1, 0], 0), RangeError);
  });
});

describe('buildIndex / appendToIndex', () => {
  test('refuses a shot of the wrong dimension instead of truncating it (TR-23)', () => {
    assert.throws(() => buildIndex(3, [shot('s', 'p', [1, 0])]), RangeError);
    assert.throws(() => appendToIndex(buildIndex(3, []), [shot('s', 'p', [1, 0])]), RangeError);
  });

  test('appending makes new shots searchable and leaves the old index untouched', () => {
    const before = buildIndex(2, [shot('a1', 'a', [0, 1])]);
    const after = appendToIndex(before, [shot('b1', 'b', [1, 0])]);

    assert.equal(after.size, 2);
    assert.equal(nearestShots(after, [1, 0], 1)[0]?.shotId, 'b1');
    assert.equal(before.size, 1);
    assert.equal(before.matrix.length, 2);
  });
});
