import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { confidenceOf, SURE_MARGIN_IN_DELTAS } from './confidence.ts';
import type { Decision } from './match.ts';

const thresholds = { tau: 0.46, delta: 0.075 };
const accept = (margin: number | null): Decision => ({ kind: 'accept', product: { productId: 'a', score: 0.8 }, margin });

describe('confidenceOf (SR-03)', () => {
  test('a margin of at least 2δ is sure', () => {
    assert.equal(SURE_MARGIN_IN_DELTAS, 2);
    assert.equal(confidenceOf(accept(0.15), thresholds), 'sure');
    assert.equal(confidenceOf(accept(0.237), thresholds), 'sure');
  });

  test('a margin that cleared δ but not 2δ is likely', () => {
    assert.equal(confidenceOf(accept(0.1499), thresholds), 'likely');
    assert.equal(confidenceOf(accept(0.075), thresholds), 'likely');
  });

  test('a lone candidate is never sure: δ had nothing to measure (ADR-013)', () => {
    assert.equal(confidenceOf(accept(null), thresholds), 'likely');
  });

  test('chips are not sure', () => {
    const decision: Decision = {
      kind: 'disambiguate',
      first: { productId: 'a', score: 0.78 },
      second: { productId: 'b', score: 0.74 },
      margin: 0.04,
    };
    assert.equal(confidenceOf(decision, thresholds), 'notSure');
  });

  test('unknown has no confidence to show', () => {
    assert.equal(confidenceOf({ kind: 'unknown', best: null }, thresholds), null);
  });

  test('follows δ from app_meta rather than a fixed margin (TR-35)', () => {
    assert.equal(confidenceOf(accept(0.15), { tau: 0.46, delta: 0.1 }), 'likely');
    assert.equal(confidenceOf(accept(0.2), { tau: 0.46, delta: 0.1 }), 'sure');
  });

  test('refuses a NaN δ instead of rating everything sure', () => {
    assert.throws(() => confidenceOf(accept(0.5), { tau: 0.46, delta: NaN }), RangeError);
  });
});
