import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { appendLockEvent, frameVote, lockEvent, segmentLockLog, type LockEvent } from './lockLog.ts';
import type { Decision } from './match.ts';

const base = { score: null, margin: null, votes: [] };
const accept = (atMs: number, id: string): LockEvent => ({ ...base, atMs, kind: 'accept', productIds: [id] });
const chips = (atMs: number, a: string, b: string): LockEvent => ({ ...base, atMs, kind: 'disambiguate', productIds: [a, b] });
const unknown = (atMs: number): LockEvent => ({ ...base, atMs, kind: 'unknown', productIds: [] });
const none = (atMs: number): LockEvent => ({ ...base, atMs, kind: 'none', productIds: [] });

const acceptDecision: Decision = { kind: 'accept', product: { productId: 'a', score: 0.8 }, margin: 0.2 };
const chipDecision: Decision = {
  kind: 'disambiguate',
  first: { productId: 'b', score: 0.7 },
  second: { productId: 'a', score: 0.69 },
  margin: 0.01,
};

describe('lockEvent', () => {
  test('maps each decision kind with its own score and margin', () => {
    assert.deepEqual(lockEvent(acceptDecision, 1), {
      atMs: 1,
      kind: 'accept',
      productIds: ['a'],
      score: 0.8,
      margin: 0.2,
      votes: [],
    });
    assert.deepEqual(lockEvent(chipDecision, 2), {
      atMs: 2,
      kind: 'disambiguate',
      productIds: ['b', 'a'],
      score: 0.7,
      margin: 0.01,
      votes: [],
    });
    assert.deepEqual(lockEvent({ kind: 'unknown', best: { productId: 'c', score: 0.3 } }, 3), {
      atMs: 3,
      kind: 'unknown',
      productIds: [],
      score: 0.3,
      margin: null,
      votes: [],
    });
    assert.deepEqual(lockEvent(null, 4), { atMs: 4, kind: 'none', productIds: [], score: null, margin: null, votes: [] });
  });

  test('keeps the voting frames it was given', () => {
    const votes = [frameVote(acceptDecision, 0.01), frameVote(chipDecision, 0.002)];
    assert.deepEqual(lockEvent(acceptDecision, 5, votes).votes, votes);
  });
});

describe('frameVote', () => {
  test('records top-1, runner-up, margin and sharpness per decision kind', () => {
    assert.deepEqual(frameVote(acceptDecision, 0.012), {
      kind: 'accept',
      topId: 'a',
      topScore: 0.8,
      secondId: null,
      margin: 0.2,
      sharpness: 0.012,
    });
    assert.deepEqual(frameVote(chipDecision, null), {
      kind: 'disambiguate',
      topId: 'b',
      topScore: 0.7,
      secondId: 'a',
      margin: 0.01,
      sharpness: null,
    });
    assert.deepEqual(frameVote({ kind: 'unknown', best: null }, 0.001), {
      kind: 'unknown',
      topId: null,
      topScore: null,
      secondId: null,
      margin: null,
      sharpness: 0.001,
    });
  });
});

describe('appendLockEvent', () => {
  test('drops the oldest events beyond the limit', () => {
    const log = appendLockEvent(appendLockEvent([unknown(1)], unknown(2), 2), unknown(3), 2);
    assert.deepEqual(log.map((e) => e.atMs), [2, 3]);
  });
});

describe('segmentLockLog (PHASE_1_PLAN §4 step 5)', () => {
  test('splits at Unknown, one segment per product scanned', () => {
    const segments = segmentLockLog([
      unknown(0),
      accept(10, 'a'),
      unknown(20),
      chips(30, 'b', 'c'),
      accept(40, 'b'),
      unknown(50),
    ]);
    assert.equal(segments.length, 2);
    assert.deepEqual(segments[0], {
      startMs: 10,
      endMs: 20,
      items: [{ kind: 'accept', productIds: ['a'], count: 1, firstMs: 10 }],
    });
    assert.deepEqual(
      segments[1]?.items.map((i) => `${i.kind}:${i.productIds.join('|')}`),
      ['disambiguate:b|c', 'accept:b'],
    );
  });

  test('a wrong lock inside a segment is kept, not hidden by the correct one', () => {
    const [segment] = segmentLockLog([accept(0, 'a'), none(5), accept(10, 'wrong'), accept(15, 'a'), unknown(20)]);
    assert.deepEqual(
      segment?.items.map((i) => [i.productIds[0], i.count]),
      [
        ['a', 2],
        ['wrong', 1],
      ],
    );
  });

  test('counts a chip pair once whichever product ranked first', () => {
    const [segment] = segmentLockLog([chips(0, 'a', 'b'), none(1), chips(2, 'b', 'a'), unknown(3)]);
    assert.deepEqual(segment?.items, [{ kind: 'disambiguate', productIds: ['a', 'b'], count: 2, firstMs: 0 }]);
  });

  test('losing quorum does not split a segment', () => {
    assert.equal(segmentLockLog([accept(0, 'a'), none(1), accept(2, 'a')]).length, 1);
  });

  test('drops empty segments and closes a trailing one', () => {
    const segments = segmentLockLog([unknown(0), none(1), unknown(2), accept(3, 'a'), accept(4, 'b')]);
    assert.equal(segments.length, 1);
    assert.equal(segments[0]?.endMs, 4);
  });

  test('an empty log has no segments', () => {
    assert.deepEqual(segmentLockLog([]), []);
  });
});
