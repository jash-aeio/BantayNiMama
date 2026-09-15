import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  captureStillMatches,
  extraShotsToReplace,
  likelyProducts,
  MAX_EXTRA_SHOTS,
  MAX_PRODUCT_SHOTS,
  type ExistingShot,
} from './correction.ts';
import { KNN_LIMIT } from './knn.ts';
import type { Decision } from './match.ts';
import { resolveFrame } from './scanDisplay.ts';
import { decisionKey } from './stability.ts';

const enroll = (id: string, createdAt: number): ExistingShot => ({ id, source: 'enroll', createdAt });
const correction = (id: string, createdAt: number): ExistingShot => ({ id, source: 'correction', createdAt });
const teach = (id: string, createdAt: number): ExistingShot => ({ id, source: 'teach', createdAt });
const fiveEnrolled = [1, 2, 3, 4, 5].map((i) => enroll(`e${i}`, i));

describe('extraShotsToReplace (SR-07, SR-33, TR-42, D-3, ADR-024)', () => {
  test('the caps: 5 enrollment + 3 extra shots, inside what KNN_LIMIT keeps exact', () => {
    assert.equal(MAX_EXTRA_SHOTS, 3);
    assert.equal(MAX_PRODUCT_SHOTS, 8);
    assert.ok(MAX_PRODUCT_SHOTS + 1 <= KNN_LIMIT, 'a product needs ≤ KNN_LIMIT − 1 shots (knn.ts)');
  });

  test('nothing is replaced while a product holds fewer than 3 extras', () => {
    assert.deepEqual(extraShotsToReplace(fiveEnrolled), []);
    assert.deepEqual(extraShotsToReplace([...fiveEnrolled, correction('c1', 10)]), []);
    assert.deepEqual(extraShotsToReplace([...fiveEnrolled, correction('c1', 10), teach('t1', 20)]), []);
  });

  test('at 3 extras the oldest extra goes, never an older enrollment shot', () => {
    const shots = [correction('c2', 20), ...fiveEnrolled, correction('c3', 30), correction('c1', 10)];
    assert.deepEqual(extraShotsToReplace(shots), ['c1']);
  });

  test('corrections and taught photos share the slots: the oldest of either kind goes first', () => {
    assert.deepEqual(extraShotsToReplace([teach('t1', 1), correction('c1', 10), correction('c2', 20)]), ['t1']);
    assert.deepEqual(extraShotsToReplace([correction('c1', 1), teach('t1', 10), teach('t2', 20)]), ['c1']);
  });

  test('a product somehow over the cap is brought back under it by the next extra', () => {
    const shots = [...fiveEnrolled, ...[50, 10, 40].map((t) => correction(`c${t}`, t)), ...[20, 30].map((t) => teach(`t${t}`, t))];
    assert.deepEqual(extraShotsToReplace(shots), ['c10', 't20', 't30']);
  });

  test('equal times break by id, so the choice never depends on row order', () => {
    const a = [correction('b', 5), teach('a', 5), correction('c', 5)];
    assert.deepEqual(extraShotsToReplace(a), ['a']);
    assert.deepEqual(extraShotsToReplace([...a].reverse()), ['a']);
  });

  test('refuses an extra with no usable time instead of replacing the wrong one', () => {
    assert.throws(() => extraShotsToReplace([correction('c1', NaN), correction('c2', 2), teach('t3', 3)]), RangeError);
  });
});

describe('captureStillMatches (P2-3 guard, ADR-017)', () => {
  const accept = (id: string): Decision => ({ kind: 'accept', product: { productId: id, score: 0.8 }, margin: 0.2 });
  const chips = (a: string, b: string): Decision => ({
    kind: 'disambiguate',
    first: { productId: a, score: 0.7 },
    second: { productId: b, score: 0.69 },
    margin: 0.01,
  });
  const noFacts = { negativeIds: new Set<string>(), ambiguousIds: new Set<string>() };

  test('saves when the next frame still shows the rejected lock', () => {
    assert.equal(captureStillMatches(decisionKey(accept('p')), accept('p')), true);
  });

  test('refuses when the phone has moved to another product', () => {
    assert.equal(captureStillMatches(decisionKey(accept('p')), accept('q')), false);
    assert.equal(captureStillMatches(decisionKey(accept('p')), { kind: 'unknown', best: null }), false);
  });

  test('a rejected chip pair matches in either order, but not an ACCEPT of one of the pair', () => {
    const key = decisionKey(chips('p', 'q'));
    assert.equal(captureStillMatches(key, chips('q', 'p')), true);
    assert.equal(captureStillMatches(key, accept('p')), false);
  });

  test('refuses a frame now silenced by a negative', () => {
    const silenced = resolveFrame(accept('p'), { ...noFacts, negativeIds: new Set(['p']) });
    assert.equal(captureStillMatches(decisionKey(accept('p')), silenced), false);
  });

  test('an Unknown or grid lock names nothing, so there is nothing to reject', () => {
    assert.equal(captureStillMatches('unknown', { kind: 'unknown', best: null }), false);
    assert.equal(captureStillMatches('quickPick', { kind: 'quickPick', productIds: ['bag'], score: 0.8 }), false);
  });
});

describe('likelyProducts (SR-07, P2-4)', () => {
  const s = (productId: string, score: number) => ({ productId, score });

  test('keeps rank order and leaves out the rejected products and negatives', () => {
    const top = [s('p', 0.8), s('n', 0.75), s('q', 0.7), s('r', 0.6)];
    assert.deepEqual(likelyProducts(top, ['p'], new Set(['n'])), ['q', 'r']);
  });

  test('a rejected chip pair leaves only a third product, or nothing', () => {
    assert.deepEqual(likelyProducts([s('p', 0.7), s('q', 0.69), s('r', 0.5)], ['p', 'q'], new Set()), ['r']);
    assert.deepEqual(likelyProducts([s('p', 0.7), s('q', 0.69)], ['p', 'q'], new Set()), []);
  });

  test('never repeats a product, skips a non-finite score, and stops at the limit', () => {
    const top = [s('a', NaN), s('b', 0.9), s('b', 0.9), s('c', 0.8), s('d', 0.7), s('e', 0.6)];
    assert.deepEqual(likelyProducts(top, [], new Set()), ['b', 'c', 'd']);
    assert.deepEqual(likelyProducts(top, [], new Set(), 1), ['b']);
  });
});
