import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { lockEvent, segmentLockLog } from './lockLog.ts';
import type { Decision } from './match.ts';
import { displayFor, inConfirmMode, resolveFrame, type CatalogFacts, type FrameDecision } from './scanDisplay.ts';
import { decisionKey, emptyBuffer, lockedDecision, pushDecision, type StabilityBuffer } from './stability.ts';

const score = (productId: string, s: number) => ({ productId, score: s });
const accept = (id: string, s = 0.8, margin: number | null = 0.2): Decision => ({ kind: 'accept', product: score(id, s), margin });
const chips = (a: string, b: string, s = 0.7, margin = 0.02): Decision => ({
  kind: 'disambiguate',
  first: score(a, s),
  second: score(b, s - margin),
  margin,
});
const unknown = (best: string | null = null): Decision => ({ kind: 'unknown', best: best === null ? null : score(best, 0.3) });

const facts = (negatives: string[] = [], ambiguous: string[] = []): CatalogFacts => ({
  negativeIds: new Set(negatives),
  ambiguousIds: new Set(ambiguous),
});

describe('resolveFrame (TR-39, SR-10, E-5)', () => {
  test('passes an ordinary decision through untouched', () => {
    for (const d of [accept('p'), accept('p', 0.6, null), chips('p', 'q'), unknown('p'), unknown()]) {
      assert.equal(resolveFrame(d, facts(['neg'], ['bag'])), d);
    }
  });

  test('a negative at top-1 reads UNKNOWN, and is not carried as the best candidate', () => {
    assert.deepEqual(resolveFrame(accept('neg'), facts(['neg'])), { kind: 'unknown', best: null });
  });

  test('a chip pair containing a negative reads UNKNOWN, on either side', () => {
    assert.deepEqual(resolveFrame(chips('neg', 'p'), facts(['neg'])), { kind: 'unknown', best: null });
    assert.deepEqual(resolveFrame(chips('p', 'neg'), facts(['neg'])), { kind: 'unknown', best: null });
  });

  test('an UNKNOWN never carries a negative as its best candidate', () => {
    assert.deepEqual(resolveFrame(unknown('neg'), facts(['neg'])), { kind: 'unknown', best: null });
  });

  test('an ACCEPT of an ambiguous product opens the grid instead of naming it', () => {
    assert.deepEqual(resolveFrame(accept('bag', 0.81), facts([], ['bag'])), {
      kind: 'quickPick',
      productIds: ['bag'],
      score: 0.81,
    });
  });

  test('a chip pair with an ambiguous product opens the grid, on either side, best first', () => {
    assert.deepEqual(resolveFrame(chips('bag', 'p', 0.7), facts([], ['bag'])), {
      kind: 'quickPick',
      productIds: ['bag', 'p'],
      score: 0.7,
    });
    assert.deepEqual(resolveFrame(chips('p', 'bag', 0.66), facts([], ['bag'])), {
      kind: 'quickPick',
      productIds: ['p', 'bag'],
      score: 0.66,
    });
  });

  test('a negative outranks ambiguity: a negative chipped with a clear bag reads UNKNOWN', () => {
    assert.deepEqual(resolveFrame(chips('bag', 'neg'), facts(['neg'], ['bag'])), { kind: 'unknown', best: null });
  });
});

describe('stability over resolved frames (E-5)', () => {
  const lockOf = (decisions: Decision[], f: CatalogFacts) =>
    lockedDecision(
      decisions
        .map((d) => resolveFrame(d, f))
        .reduce<StabilityBuffer<FrameDecision>>((buffer, frame) => pushDecision(buffer, frame), emptyBuffer),
    );
  const mixed = [accept('neg'), chips('neg', 'p'), chips('p', 'neg'), accept('neg'), chips('neg', 'q')];

  test('a mix of accept(negative) and chips(negative, product) votes locks as UNKNOWN', () => {
    assert.deepEqual(lockOf(mixed, facts(['neg'])), { kind: 'unknown', best: null });
  });

  test('the same votes, before the item was marked a negative, reach no quorum', () => {
    assert.equal(lockOf(mixed, facts()), null);
  });

  test('grid votes agree whichever ambiguous product ranked first, and the lock is the latest', () => {
    const lock = lockOf([accept('bag-a'), chips('bag-b', 'bag-a'), accept('bag-b'), chips('bag-a', 'p'), unknown()], facts([], ['bag-a', 'bag-b']));
    assert.deepEqual(lock, { kind: 'quickPick', productIds: ['bag-a', 'p'], score: 0.7 });
    assert.equal(decisionKey(lock!), 'quickPick');
  });

  test('the lock log keeps a grid lock and its products', () => {
    const grid = lockEvent({ kind: 'quickPick', productIds: ['bag-a', 'p'], score: 0.7 }, 1000);
    assert.equal(grid.kind, 'quickPick');
    assert.deepEqual(grid.productIds, ['bag-a', 'p']);
    assert.equal(grid.score, 0.7);
    assert.equal(grid.margin, null);

    const segments = segmentLockLog([lockEvent(unknown(), 0), grid, lockEvent(unknown(), 2000)]);
    assert.equal(segments.length, 1);
    assert.deepEqual(segments[0]!.items.map((i) => i.kind), ['quickPick']);
  });
});

describe('displayFor (SR-13, TR-38, D-1)', () => {
  test('nothing locked → scanning', () => {
    assert.deepEqual(displayFor(null, 20, null), { kind: 'scanning' });
  });

  test('no confirm_below row: every ACCEPT is a question, at any catalog size', () => {
    for (const n of [0, 1, 5, 25, 500]) assert.equal(displayFor(accept('p'), n, null).kind, 'confirm', `${n} products`);
  });

  test('below confirm_below an ACCEPT is a question; at or above it, a quote', () => {
    assert.equal(displayFor(accept('p'), 11, 12).kind, 'confirm');
    assert.equal(displayFor(accept('p'), 12, 12).kind, 'quote');
    assert.equal(displayFor(accept('p'), 13, 12).kind, 'quote');
  });

  test('the card keeps the product and margin it was locked with', () => {
    assert.deepEqual(displayFor(accept('p', 0.9, 0.3), 30, 12), { kind: 'quote', product: score('p', 0.9), margin: 0.3 });
    assert.deepEqual(displayFor(accept('p', 0.9, null), 3, 12), { kind: 'confirm', product: score('p', 0.9), margin: null });
  });

  test('chips, the grid and Unknown look the same in and out of confirm mode', () => {
    for (const confirmBelow of [null, 0]) {
      const pair = chips('p', 'q', 0.7, 0.02) as Extract<Decision, { kind: 'disambiguate' }>;
      assert.deepEqual(displayFor(pair, 5, confirmBelow), {
        kind: 'chips',
        first: pair.first,
        second: pair.second,
        margin: 0.02,
      });
      assert.deepEqual(displayFor({ kind: 'quickPick', productIds: ['bag'], score: 0.8 }, 5, confirmBelow), {
        kind: 'quickPick',
        productIds: ['bag'],
      });
      assert.deepEqual(displayFor(unknown('p'), 5, confirmBelow), { kind: 'unknown' });
    }
  });

  test('refuses a count or cutoff that would make "fewer than" false and quote everything', () => {
    for (const n of [NaN, -1, 1.5, Infinity]) assert.throws(() => displayFor(accept('p'), n, 12), RangeError, String(n));
    for (const c of [NaN, -1, 2.5]) assert.throws(() => displayFor(accept('p'), 5, c), RangeError, String(c));
    assert.throws(() => inConfirmMode(NaN, null), RangeError);
  });
});
