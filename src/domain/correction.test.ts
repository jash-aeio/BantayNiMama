import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  captureStillMatches,
  correctionsToReplace,
  MAX_CORRECTION_SHOTS,
  MAX_PRODUCT_SHOTS,
  type ExistingShot,
} from './correction.ts';
import { KNN_LIMIT } from './knn.ts';
import type { Decision } from './match.ts';
import { resolveFrame } from './scanDisplay.ts';
import { decisionKey } from './stability.ts';

const enroll = (id: string, createdAt: number): ExistingShot => ({ id, source: 'enroll', createdAt });
const correction = (id: string, createdAt: number): ExistingShot => ({ id, source: 'correction', createdAt });
const fiveEnrolled = [1, 2, 3, 4, 5].map((i) => enroll(`e${i}`, i));

describe('correctionsToReplace (SR-07, TR-42, D-3)', () => {
  test('the caps: 5 enrollment + 3 correction shots, inside what KNN_LIMIT keeps exact', () => {
    assert.equal(MAX_CORRECTION_SHOTS, 3);
    assert.equal(MAX_PRODUCT_SHOTS, 8);
    assert.ok(MAX_PRODUCT_SHOTS + 1 <= KNN_LIMIT, 'a product needs ≤ KNN_LIMIT − 1 shots (knn.ts)');
  });

  test('nothing is replaced while a product holds fewer than 3 corrections', () => {
    assert.deepEqual(correctionsToReplace(fiveEnrolled), []);
    assert.deepEqual(correctionsToReplace([...fiveEnrolled, correction('c1', 10)]), []);
    assert.deepEqual(correctionsToReplace([...fiveEnrolled, correction('c1', 10), correction('c2', 20)]), []);
  });

  test('at 3 corrections the oldest correction goes, never an older enrollment shot', () => {
    const shots = [correction('c2', 20), ...fiveEnrolled, correction('c3', 30), correction('c1', 10)];
    assert.deepEqual(correctionsToReplace(shots), ['c1']);
  });

  test('a product somehow over the cap is brought back under it by the next correction', () => {
    const shots = [...fiveEnrolled, ...[50, 10, 40, 20, 30].map((t) => correction(`c${t}`, t))];
    assert.deepEqual(correctionsToReplace(shots), ['c10', 'c20', 'c30']);
  });

  test('teach shots are never replaced', () => {
    const shots: ExistingShot[] = [
      { id: 't1', source: 'teach', createdAt: 1 },
      correction('c1', 10),
      correction('c2', 20),
      correction('c3', 30),
    ];
    assert.deepEqual(correctionsToReplace(shots), ['c1']);
  });

  test('equal times break by id, so the choice never depends on row order', () => {
    const a = [correction('b', 5), correction('a', 5), correction('c', 5)];
    assert.deepEqual(correctionsToReplace(a), ['a']);
    assert.deepEqual(correctionsToReplace([...a].reverse()), ['a']);
  });

  test('refuses a correction with no usable time instead of replacing the wrong one', () => {
    assert.throws(() => correctionsToReplace([correction('c1', NaN), correction('c2', 2), correction('c3', 3)]), RangeError);
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
