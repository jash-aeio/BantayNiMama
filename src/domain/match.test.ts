import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { assertThresholds, decide, match, rankProducts, type ProductScore } from './match.ts';

// Scores and thresholds are exact binary fractions, so boundary tests are not at the mercy
// of floating-point subtraction (0.6 - 0.5 is not 0.1).
const T = { tau: 0.5, delta: 0.25 };
const p = (productId: string, score: number): ProductScore => ({ productId, score });

describe('rankProducts (TR-31)', () => {
  test("scores a product by its best shot, not its mean", () => {
    const ranked = rankProducts([
      { productId: 'a', similarity: 0.875 },
      { productId: 'a', similarity: 0.125 },
      { productId: 'b', similarity: 0.625 },
      { productId: 'b', similarity: 0.625 },
    ]);
    // By mean, b (0.625) would outrank a (0.5).
    assert.deepEqual(ranked, [p('a', 0.875), p('b', 0.625)]);
  });

  test('top-2 is the best different product, never a second shot of top-1', () => {
    const ranked = rankProducts([
      { productId: 'a', similarity: 0.875 },
      { productId: 'a', similarity: 0.75 },
      { productId: 'b', similarity: 0.5 },
    ]);
    assert.deepEqual(ranked.slice(0, 2), [p('a', 0.875), p('b', 0.5)]);
  });

  test('breaks score ties by productId, so the order is deterministic', () => {
    const ranked = rankProducts([
      { productId: 'b', similarity: 0.75 },
      { productId: 'a', similarity: 0.75 },
    ]);
    assert.deepEqual(ranked, [p('a', 0.75), p('b', 0.75)]);
  });

  test('drops non-finite similarities', () => {
    const ranked = rankProducts([
      { productId: 'a', similarity: NaN },
      { productId: 'b', similarity: 0.625 },
      { productId: 'c', similarity: Infinity },
    ]);
    assert.deepEqual(ranked, [p('b', 0.625)]);
  });

  test('ranks nothing from no rows', () => {
    assert.deepEqual(rankProducts([]), []);
  });
});

describe('decide (TR-32, TR-33, TR-34)', () => {
  test('no candidates → unknown, with no best', () => {
    assert.deepEqual(decide([], T), { kind: 'unknown', best: null });
  });

  test('top-1 below τ → unknown, keeping the best candidate', () => {
    assert.deepEqual(decide([p('a', 0.25), p('b', 0.125)], T), { kind: 'unknown', best: p('a', 0.25) });
  });

  test('top-1 exactly at τ with a margin exactly at δ → accept (both bounds inclusive)', () => {
    assert.deepEqual(decide([p('a', 0.5), p('b', 0.25)], T), {
      kind: 'accept',
      product: p('a', 0.5),
      margin: 0.25,
    });
  });

  test('margin short of δ → disambiguate between the two', () => {
    assert.deepEqual(decide([p('a', 0.75), p('b', 0.625)], T), {
      kind: 'disambiguate',
      first: p('a', 0.75),
      second: p('b', 0.625),
      margin: 0.125,
    });
  });

  test('a lone candidate above τ → accept, with no margin to report', () => {
    assert.deepEqual(decide([p('a', 0.75)], T), { kind: 'accept', product: p('a', 0.75), margin: null });
  });

  test('an exact tie never auto-accepts, even at δ = 0', () => {
    assert.equal(decide([p('a', 0.75), p('b', 0.75)], { tau: 0.5, delta: 0 }).kind, 'disambiguate');
  });

  test('refuses a NaN τ or δ rather than accepting everything (NFR-02)', () => {
    assert.throws(() => decide([p('a', 0.875)], { tau: NaN, delta: 0.25 }), RangeError);
    assert.throws(() => decide([p('a', 0.875)], { tau: 0.5, delta: NaN }), RangeError);
  });
});

describe('assertThresholds (TR-35)', () => {
  test('accepts the Phase 0 calibration', () => {
    assert.doesNotThrow(() => assertThresholds({ tau: 0.46, delta: 0.075 }));
  });

  test('rejects values outside the similarity range', () => {
    assert.throws(() => assertThresholds({ tau: 1.5, delta: 0.1 }), RangeError);
    assert.throws(() => assertThresholds({ tau: -2, delta: 0.1 }), RangeError);
    assert.throws(() => assertThresholds({ tau: 0.5, delta: -0.01 }), RangeError);
    assert.throws(() => assertThresholds({ tau: 0.5, delta: Infinity }), RangeError);
  });
});

describe('match', () => {
  test('ranks shots into products, then decides', () => {
    const decision = match(
      [
        { productId: 'a', similarity: 0.875 },
        { productId: 'a', similarity: 0.25 },
        { productId: 'b', similarity: 0.5 },
      ],
      T,
    );
    assert.deepEqual(decision, { kind: 'accept', product: p('a', 0.875), margin: 0.375 });
  });
});
