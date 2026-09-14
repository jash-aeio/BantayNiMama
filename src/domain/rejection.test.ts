import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { NegativeSource } from './correction.ts';
import type { Decision, ProductScore } from './match.ts';
import { IDLE, rejectionReducer, type Rejection, type RejectionEvent } from './rejection.ts';
import { resolveFrame, type FrameDecision } from './scanDisplay.ts';

const accept = (id: string): Decision => ({ kind: 'accept', product: { productId: id, score: 0.8 }, margin: 0.2 });
const chips = (a: string, b: string): Decision => ({
  kind: 'disambiguate',
  first: { productId: a, score: 0.7 },
  second: { productId: b, score: 0.69 },
  margin: 0.01,
});
const reject = (
  locked: FrameDecision,
  source: NegativeSource,
  top: readonly ProductScore[] = [],
  negativeIds: ReadonlySet<string> = new Set(),
): RejectionEvent => ({ type: 'reject', locked, source, top, negativeIds });
const run = (events: RejectionEvent[], from: Rejection = IDLE) => events.reduce(rejectionReducer, from);

describe('rejectionReducer (SR-14, P2-3)', () => {
  test('No on a question pins that product and opens the sheet', () => {
    assert.deepEqual(run([reject(accept('p'), 'confirm_no')]), {
      stage: 'asking',
      pinned: { lockedKey: 'accept:p', source: 'confirm_no', productIds: ['p'], likelyIds: [] },
    });
  });

  test('Neither on chips pins both products, best first', () => {
    assert.deepEqual(run([reject(chips('q', 'p'), 'wrong_chip')]), {
      stage: 'asking',
      pinned: { lockedKey: 'disambiguate:p|q', source: 'wrong_chip', productIds: ['q', 'p'], likelyIds: [] },
    });
  });

  test('refuses a card that names nothing, or a source that does not fit the card', () => {
    const unnamed = [
      { kind: 'unknown', best: null },
      { kind: 'quickPick', productIds: ['bag'], score: 0.8 },
    ] as const;
    for (const locked of unnamed) assert.equal(run([reject(locked, 'confirm_no')]), IDLE);
    assert.equal(run([reject(accept('p'), 'wrong_chip')]), IDLE);
    assert.equal(run([reject(chips('p', 'q'), 'wrong_lock')]), IDLE);
  });

  test('saves only when the capture frame still shows the rejected lock', () => {
    const asked: RejectionEvent[] = [reject(accept('p'), 'wrong_lock'), { type: 'notInList' }];
    assert.equal(run([...asked, { type: 'captured', decision: accept('p') }]).stage, 'saving');
    assert.equal(run([...asked, { type: 'captured', decision: accept('q') }]).stage, 'mismatch');
    assert.equal(run([...asked, { type: 'captured', decision: { kind: 'unknown', best: null } }]).stage, 'mismatch');
  });

  test('a chip pair matches in either order, but not a frame that now accepts one of the pair', () => {
    const asked: RejectionEvent[] = [reject(chips('p', 'q'), 'wrong_chip'), { type: 'notInList' }];
    assert.equal(run([...asked, { type: 'captured', decision: chips('q', 'p') }]).stage, 'saving');
    assert.equal(run([...asked, { type: 'captured', decision: accept('p') }]).stage, 'mismatch');
  });

  test('a frame already silenced by a negative is a mismatch', () => {
    const silenced = resolveFrame(accept('p'), { negativeIds: new Set(['p']), ambiguousIds: new Set() });
    const state = run([reject(accept('p'), 'confirm_no'), { type: 'notInList' }, { type: 'captured', decision: silenced }]);
    assert.equal(state.stage, 'mismatch');
  });

  test('after a mismatch or a failure, Try again asks for a new frame', () => {
    const mismatch = run([reject(accept('p'), 'confirm_no'), { type: 'notInList' }, { type: 'captured', decision: accept('q') }]);
    assert.equal(run([{ type: 'retry' }], mismatch).stage, 'capturing');

    const failed = run([{ type: 'retry' }, { type: 'captured', decision: accept('p') }, { type: 'saveFailed', message: 'disk full' }], mismatch);
    assert.deepEqual(failed, {
      stage: 'failed',
      pinned: { lockedKey: 'accept:p', source: 'confirm_no', productIds: ['p'], likelyIds: [] },
      fix: { kind: 'notInList' },
      message: 'disk full',
    });
    assert.equal(run([{ type: 'retry' }], failed).stage, 'capturing');
  });

  test('saving ends in saved; Cancel is refused mid-write so the result is always shown', () => {
    const saving = run([reject(accept('p'), 'confirm_no'), { type: 'notInList' }, { type: 'captured', decision: accept('p') }]);
    assert.equal(run([{ type: 'close' }], saving), saving);
    assert.equal(run([{ type: 'saved' }], saving).stage, 'saved');
    assert.equal(run([{ type: 'saved' }, { type: 'close' }], saving), IDLE);
  });

  test('a capture that arrives after Cancel is ignored', () => {
    const cancelled = run([reject(accept('p'), 'confirm_no'), { type: 'notInList' }, { type: 'close' }]);
    assert.equal(cancelled, IDLE);
    assert.equal(run([{ type: 'captured', decision: accept('p') }], cancelled), IDLE);
  });

  test('a second rejection while one is open, or a stray result, changes nothing', () => {
    const asking = run([reject(accept('p'), 'confirm_no')]);
    assert.equal(run([reject(accept('q'), 'confirm_no')], asking), asking);
    assert.equal(run([{ type: 'saved' }], asking), asking);
    assert.equal(run([{ type: 'retry' }], asking), asking);
    assert.equal(run([{ type: 'captured', decision: accept('p') }], asking), asking);
  });
});

describe('rejectionReducer: corrections (SR-07, P2-4)', () => {
  const top: ProductScore[] = [
    { productId: 'soy', score: 0.71 },
    { productId: 'neg', score: 0.7 },
    { productId: 'vinegar', score: 0.66 },
  ];

  test('the sheet offers the latest top 3 without the rejected product or a negative', () => {
    const asking = run([reject(accept('soy'), 'wrong_lock', top, new Set(['neg']))]);
    assert.equal(asking.stage, 'asking');
    assert.deepEqual(asking.stage === 'asking' && asking.pinned.likelyIds, ['vinegar']);
  });

  test('picking a product captures for it, and the guard still decides', () => {
    const picked = run([reject(accept('soy'), 'wrong_lock', top), { type: 'correct', productId: 'vinegar' }]);
    assert.deepEqual(picked.stage === 'capturing' && picked.fix, { kind: 'correct', productId: 'vinegar' });
    assert.equal(run([{ type: 'captured', decision: accept('soy') }], picked).stage, 'saving');
    assert.equal(run([{ type: 'captured', decision: accept('vinegar') }], picked).stage, 'mismatch');
  });

  test('a question or a quote refuses a correction to the product it named, and any empty id', () => {
    for (const source of ['confirm_no', 'wrong_lock'] as const) {
      const asking = run([reject(accept('soy'), source, top)]);
      assert.equal(run([{ type: 'correct', productId: 'soy' }], asking), asking, source);
      assert.equal(run([{ type: 'correct', productId: '' }], asking), asking, source);
    }
  });

  test('chips accept a correction to either product of the pair, and still pass the guard (ADR-022)', () => {
    const asking = run([reject(chips('pork', 'chicken'), 'wrong_chip', top)]);
    for (const productId of ['pork', 'chicken']) {
      const picked = run([{ type: 'correct', productId }], asking);
      assert.deepEqual(picked.stage === 'capturing' && picked.fix, { kind: 'correct', productId });
      assert.equal(run([{ type: 'captured', decision: chips('chicken', 'pork') }], picked).stage, 'saving');
      assert.equal(run([{ type: 'captured', decision: accept('chicken') }], picked).stage, 'mismatch');
    }
    assert.equal(run([{ type: 'correct', productId: '' }], asking), asking);
  });

  test('Try again keeps the correction; it never turns into a negative', () => {
    const mismatch = run([
      reject(accept('soy'), 'wrong_lock', top),
      { type: 'correct', productId: 'vinegar' },
      { type: 'captured', decision: accept('neg') },
    ]);
    assert.equal(run([{ type: 'notInList' }], mismatch), mismatch);
    const retried = run([{ type: 'retry' }, { type: 'captured', decision: accept('soy') }, { type: 'saved' }], mismatch);
    assert.deepEqual(retried.stage === 'saved' && retried.fix, { kind: 'correct', productId: 'vinegar' });
  });

  test('a correction or Not in my list is chosen only from the open sheet', () => {
    assert.equal(run([{ type: 'correct', productId: 'vinegar' }]), IDLE);
    const capturing = run([reject(accept('soy'), 'wrong_lock', top), { type: 'notInList' }]);
    assert.equal(run([{ type: 'correct', productId: 'vinegar' }], capturing), capturing);
  });
});
