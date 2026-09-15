import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { appendToIndex, buildIndex, KNN_LIMIT, nearestShots, type IndexedShot } from './knn.ts';
import { rankProducts } from './match.ts';

const shot = (shotId: string, productId: string, vector: number[]): IndexedShot => ({ shotId, productId, vector });
const negative = (id: string, vector: number[]): IndexedShot => ({ shotId: id, productId: id, vector, negative: true });

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

describe('negatives in the index (TR-39)', () => {
  test('flags negative rows by id, and appending keeps the old flags', () => {
    const before = buildIndex(2, [shot('a1', 'a', [1, 0]), negative('n1', [0, 1])]);
    assert.deepEqual([...before.negativeIds], ['n1']);

    const after = appendToIndex(before, [negative('n2', [1, 1]), shot('a2', 'a', [0, 1])]);
    assert.deepEqual([...after.negativeIds].sort(), ['n1', 'n2']);
    assert.deepEqual([...before.negativeIds], ['n1']);
  });

  test('refuses an id used by both a product and a negative, in either order and across an append', () => {
    const asNegative = negative('x', [0, 1]);
    assert.throws(() => buildIndex(2, [shot('a1', 'x', [1, 0]), asNegative]), RangeError);
    assert.throws(() => buildIndex(2, [asNegative, shot('a1', 'x', [1, 0])]), RangeError);
    assert.throws(() => appendToIndex(buildIndex(2, [shot('a1', 'x', [1, 0])]), [asNegative]), RangeError);
    assert.throws(() => appendToIndex(buildIndex(2, [asNegative]), [shot('a1', 'x', [1, 0])]), RangeError);
  });

  test('refuses a second row for one negative: KNN_LIMIT assumes one', () => {
    assert.throws(() => buildIndex(2, [negative('n', [1, 0]), negative('n', [0, 1])]), RangeError);
    assert.throws(() => appendToIndex(buildIndex(2, [negative('n', [1, 0])]), [negative('n', [0, 1])]), RangeError);
  });
});

describe('KNN_LIMIT stays exact up to 9 shots per product (ADR-019, D-3)', () => {
  test('top-1 / top-2 from the 10 nearest shots equal the full ranking, with any number of negatives', () => {
    // Clustered, so a product's own shots crowd the top of the ranking, as they do on a real shelf.
    const dim = 16;
    const noise = randomShots(4000, dim, 3).map((s) => s.vector);
    let next = 0;
    const near = (centre: ArrayLike<number>, spread: number) => Array.from(centre, (x, d) => x + spread * noise[next++ % noise.length]![d]!);
    const centres = randomShots(30, dim, 11).map((s) => s.vector);

    for (const negativeCount of [0, 5, 200]) {
      const shots = [
        ...centres.flatMap((c, p) => Array.from({ length: 9 }, (_, i) => shot(`p${p}-${i}`, `p${p}`, near(c, 0.15)))),
        ...Array.from({ length: negativeCount }, (_, n) => negative(`n${n}`, near(centres[n % centres.length]!, 0.15))),
      ];
      const index = buildIndex(dim, shots);

      for (let q = 0; q < 200; q++) {
        const query = Float32Array.from(near(centres[q % centres.length]!, 0.25));
        const full = rankProducts(
          index.productIds.map((productId, row) => ({
            productId,
            similarity: index.matrix.subarray(row * dim, (row + 1) * dim).reduce((sum, x, d) => sum + x * query[d]!, 0),
          })),
        );
        const top = rankProducts(nearestShots(index, query));
        assert.deepEqual(
          top.slice(0, 2).map((p) => p.productId),
          full.slice(0, 2).map((p) => p.productId),
          `${negativeCount} negatives, query ${q}`,
        );
      }
    }
  });

  test('the bound is tight: a 10th shot on the top product pushes the runner-up out of the 10 nearest', () => {
    const at = (similarity: number) => [similarity, Math.sqrt(1 - similarity * similarity)];
    const top = (n: number) => Array.from({ length: n }, (_, i) => shot(`a${i}`, 'a', at(0.99 - i * 0.005)));
    const rest = [shot('b1', 'b', at(0.9)), ...Array.from({ length: 20 }, (_, i) => negative(`n${i}`, at(0.5)))];
    const topTwo = (shots: IndexedShot[]) => rankProducts(nearestShots(buildIndex(2, shots), [1, 0])).slice(0, 2).map((p) => p.productId);

    assert.deepEqual(topTwo([...top(9), ...rest]), ['a', 'b']);
    assert.deepEqual(topTwo([...top(10), ...rest]), ['a']);
  });
});
