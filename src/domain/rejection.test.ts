import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Decision } from './match.ts';
import { IDLE, rejectionReducer, type Rejection, type RejectionEvent } from './rejection.ts';
import { resolveFrame } from './scanDisplay.ts';

const accept = (id: string): Decision => ({ kind: 'accept', product: { productId: id, score: 0.8 }, margin: 0.2 });
const chips = (a: string, b: string): Decision => ({
  kind: 'disambiguate',
  first: { productId: a, score: 0.7 },
  second: { productId: b, score: 0.69 },
  margin: 0.01,
});
const run = (events: RejectionEvent[], from: Rejection = IDLE) => events.reduce(rejectionReducer, from);

describe('rejectionReducer (SR-14, P2-3)', () => {
  test('No on a question pins that product and opens the sheet', () => {
    assert.deepEqual(run([{ type: 'reject', locked: accept('p'), source: 'confirm_no' }]), {
      stage: 'asking',
      pinned: { lockedKey: 'accept:p', source: 'confirm_no', productIds: ['p'] },
    });
  });

  test('Neither on chips pins both products, best first', () => {
    assert.deepEqual(run([{ type: 'reject', locked: chips('q', 'p'), source: 'wrong_chip' }]), {
      stage: 'asking',
      pinned: { lockedKey: 'disambiguate:p|q', source: 'wrong_chip', productIds: ['q', 'p'] },
    });
  });

  test('refuses a card that names nothing, or a source that does not fit the card', () => {
    const unnamed = [
      { kind: 'unknown', best: null },
      { kind: 'quickPick', productIds: ['bag'], score: 0.8 },
    ] as const;
    for (const locked of unnamed) assert.equal(run([{ type: 'reject', locked, source: 'confirm_no' }]), IDLE);
    assert.equal(run([{ type: 'reject', locked: accept('p'), source: 'wrong_chip' }]), IDLE);
    assert.equal(run([{ type: 'reject', locked: chips('p', 'q'), source: 'wrong_lock' }]), IDLE);
  });

  test('saves only when the capture frame still shows the rejected lock', () => {
    const asked: RejectionEvent[] = [{ type: 'reject', locked: accept('p'), source: 'wrong_lock' }, { type: 'notInList' }];
    assert.equal(run([...asked, { type: 'captured', decision: accept('p') }]).stage, 'saving');
    assert.equal(run([...asked, { type: 'captured', decision: accept('q') }]).stage, 'mismatch');
    assert.equal(run([...asked, { type: 'captured', decision: { kind: 'unknown', best: null } }]).stage, 'mismatch');
  });

  test('a chip pair matches in either order, but not a frame that now accepts one of the pair', () => {
    const asked: RejectionEvent[] = [{ type: 'reject', locked: chips('p', 'q'), source: 'wrong_chip' }, { type: 'notInList' }];
    assert.equal(run([...asked, { type: 'captured', decision: chips('q', 'p') }]).stage, 'saving');
    assert.equal(run([...asked, { type: 'captured', decision: accept('p') }]).stage, 'mismatch');
  });

  test('a frame already silenced by a negative is a mismatch', () => {
    const silenced = resolveFrame(accept('p'), { negativeIds: new Set(['p']), ambiguousIds: new Set() });
    const state = run([{ type: 'reject', locked: accept('p'), source: 'confirm_no' }, { type: 'notInList' }, { type: 'captured', decision: silenced }]);
    assert.equal(state.stage, 'mismatch');
  });

  test('after a mismatch or a failure, Try again asks for a new frame', () => {
    const mismatch = run([
      { type: 'reject', locked: accept('p'), source: 'confirm_no' },
      { type: 'notInList' },
      { type: 'captured', decision: accept('q') },
    ]);
    assert.equal(run([{ type: 'notInList' }], mismatch).stage, 'capturing');

    const failed = run([{ type: 'notInList' }, { type: 'captured', decision: accept('p') }, { type: 'saveFailed', message: 'disk full' }], mismatch);
    assert.deepEqual(failed, {
      stage: 'failed',
      pinned: { lockedKey: 'accept:p', source: 'confirm_no', productIds: ['p'] },
      message: 'disk full',
    });
    assert.equal(run([{ type: 'notInList' }], failed).stage, 'capturing');
  });

  test('saving ends in saved; Cancel is refused mid-write so the result is always shown', () => {
    const saving = run([{ type: 'reject', locked: accept('p'), source: 'confirm_no' }, { type: 'notInList' }, { type: 'captured', decision: accept('p') }]);
    assert.equal(run([{ type: 'close' }], saving), saving);
    assert.equal(run([{ type: 'saved' }], saving).stage, 'saved');
    assert.equal(run([{ type: 'saved' }, { type: 'close' }], saving), IDLE);
  });

  test('a capture that arrives after Cancel is ignored', () => {
    const cancelled = run([{ type: 'reject', locked: accept('p'), source: 'confirm_no' }, { type: 'notInList' }, { type: 'close' }]);
    assert.equal(cancelled, IDLE);
    assert.equal(run([{ type: 'captured', decision: accept('p') }], cancelled), IDLE);
  });

  test('a second rejection while one is open, or a stray result, changes nothing', () => {
    const asking = run([{ type: 'reject', locked: accept('p'), source: 'confirm_no' }]);
    assert.equal(run([{ type: 'reject', locked: accept('q'), source: 'confirm_no' }], asking), asking);
    assert.equal(run([{ type: 'saved' }], asking), asking);
    assert.equal(run([{ type: 'captured', decision: accept('p') }], asking), asking);
  });
});
