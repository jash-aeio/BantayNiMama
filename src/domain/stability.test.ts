import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Decision } from './match.ts';
import {
  decisionKey,
  emptyBuffer,
  lockedDecision,
  pushDecision,
  STABILITY_QUORUM,
  STABILITY_WINDOW,
  type StabilityBuffer,
} from './stability.ts';

const accept = (productId: string, score = 0.75): Decision => ({
  kind: 'accept',
  product: { productId, score },
  margin: 0.25,
});
const disambiguate = (a: string, b: string): Decision => ({
  kind: 'disambiguate',
  first: { productId: a, score: 0.625 },
  second: { productId: b, score: 0.5625 },
  margin: 0.0625,
});
const unknown: Decision = { kind: 'unknown', best: null };

const pushAll = (decisions: Decision[], start: StabilityBuffer = emptyBuffer) =>
  decisions.reduce((buffer, d) => pushDecision(buffer, d), start);

describe('lockedDecision (TR-36 as amended by ADR-016, SR-12)', () => {
  test('uses a quorum of 4 in a window of 5', () => {
    assert.equal(STABILITY_QUORUM, 4);
    assert.equal(STABILITY_WINDOW, 5);
  });

  test('locks nothing before any decision reaches 4 of 5', () => {
    assert.equal(lockedDecision(emptyBuffer), null);
    assert.equal(lockedDecision(pushAll([accept('a'), accept('a'), accept('a')])), null);
  });

  test('3 agreeing votes of 5 no longer lock — the pattern behind gate run 2\'s wrong lock', () => {
    assert.equal(lockedDecision(pushAll([accept('a'), accept('b'), accept('a'), unknown, accept('a')])), null);
  });

  test('locks when 4 of the last 5 agree, even with noise between them', () => {
    const locked = lockedDecision(pushAll([accept('a'), accept('b'), accept('a'), accept('a'), accept('a')]));
    assert.deepEqual(locked, accept('a'));
  });

  test('returns the most recent agreeing decision, so the confidence shown is current', () => {
    const locked = lockedDecision(
      pushAll([accept('a', 0.625), accept('a', 0.6875), accept('a', 0.75), accept('a', 0.875)]),
    );
    assert.deepEqual(locked, accept('a', 0.875));
  });

  test('stays unlocked while no result reaches quorum', () => {
    assert.equal(lockedDecision(pushAll([accept('a'), accept('b'), accept('c'), accept('a'), accept('b')])), null);
  });

  test('a disambiguation pair agrees in either order', () => {
    const locked = lockedDecision(
      pushAll([disambiguate('a', 'b'), disambiguate('b', 'a'), disambiguate('a', 'b'), disambiguate('b', 'a')]),
    );
    assert.equal(locked?.kind, 'disambiguate');
  });

  test('repeated Unknown locks as Unknown (SR-04)', () => {
    assert.deepEqual(lockedDecision(pushAll([unknown, unknown, unknown, unknown])), unknown);
  });

  test('old decisions slide out of the window and release the lock', () => {
    const buffer = pushAll([accept('a'), accept('a'), accept('a'), accept('a'), accept('c'), accept('d')]);
    assert.equal(lockedDecision(buffer), null);
  });

  test('rejects a quorum that two results could reach at once', () => {
    assert.throws(() => lockedDecision(emptyBuffer, 2, 5), RangeError);
    assert.throws(() => lockedDecision(emptyBuffer, 6, 5), RangeError);
  });
});

describe('pushDecision', () => {
  test('keeps only the last 5 decisions', () => {
    const buffer = pushAll(Array.from({ length: 12 }, (_, i) => accept(`p${i}`)));
    assert.equal(buffer.recent.length, 5);
    assert.deepEqual(buffer.recent[4], accept('p11'));
  });

  test('never mutates the buffer it was given', () => {
    const before = pushAll([accept('a')]);
    pushDecision(before, accept('b'));
    assert.equal(before.recent.length, 1);
  });
});

describe('decisionKey', () => {
  test('treats a disambiguation pair as unordered', () => {
    assert.equal(decisionKey(disambiguate('a', 'b')), decisionKey(disambiguate('b', 'a')));
  });

  test('keeps different products apart', () => {
    assert.notEqual(decisionKey(accept('a')), decisionKey(accept('b')));
  });
});
