// The reject sheet — SR-07, SR-13, SR-14, TR-39, ADR-017, ADR-019; PHASE_2_PLAN.md P2-3, P2-4. Pure:
// a reducer the Scan tab drives. The side effects (the capture request, the JPEG, the INSERT) happen
// in useRejection, and only when the reducer has moved to the stage that allows them.

import { captureStillMatches, likelyProducts, type NegativeSource } from './correction.ts';
import type { ProductScore } from './match.ts';
import type { FrameDecision } from './scanDisplay.ts';
import { decisionKey } from './stability.ts';

/** What the tindera rejected, pinned at tap time. No later lock can change it. */
export interface Pinned {
  readonly lockedKey: string;
  readonly source: NegativeSource;
  /** The products the card showed, best first — for "the app said: …". */
  readonly productIds: readonly string[];
  /** SR-07: the likely right products at tap time, best first (likelyProducts). */
  readonly likelyIds: readonly string[];
}

/** What the capture frame is saved as, once the guard lets it through. */
export type Fix =
  /** SR-14: a negative, so the item reads Unknown from now on. */
  | { readonly kind: 'notInList' }
  /** SR-07: a correction shot on the product the tindera picked (D-3). */
  | { readonly kind: 'correct'; readonly productId: string };

export type Rejection =
  | { readonly stage: 'idle' }
  /** The sheet is open: likely products, search, *Not in my list*. */
  | { readonly stage: 'asking'; readonly pinned: Pinned }
  /**
   * capturing: waiting for the next frame. mismatch: that frame no longer showed the rejected lock,
   * so nothing was saved. saving: the JPEG and row are being written. saved: done.
   */
  | { readonly stage: 'capturing' | 'mismatch' | 'saving' | 'saved'; readonly pinned: Pinned; readonly fix: Fix }
  | { readonly stage: 'failed'; readonly pinned: Pinned; readonly fix: Fix; readonly message: string };

export type RejectionEvent =
  /**
   * No on a question (confirm_no), Wrong? on a quote (wrong_lock), Neither on chips (wrong_chip).
   * `top` is the scanner's latest top 3 and `negativeIds` the index's, both read at tap time.
   */
  | {
      readonly type: 'reject';
      readonly locked: FrameDecision;
      readonly source: NegativeSource;
      readonly top: readonly ProductScore[];
      readonly negativeIds: ReadonlySet<string>;
    }
  | { readonly type: 'notInList' }
  | { readonly type: 'correct'; readonly productId: string }
  /** Try again after a mismatch or a failure, with the same fix. */
  | { readonly type: 'retry' }
  /** The capture frame, resolved exactly as scanning resolves frames. */
  | { readonly type: 'captured'; readonly decision: FrameDecision }
  | { readonly type: 'saved' }
  | { readonly type: 'saveFailed'; readonly message: string }
  | { readonly type: 'close' };

export const IDLE: Rejection = { stage: 'idle' };

/**
 * Every event that does not fit the current stage is ignored, and the state comes back unchanged.
 * That is what makes late events harmless:
 * - a capture that arrives after Cancel;
 * - a second tap while one capture is pending;
 * - Cancel while a write is in progress, which is refused so the tindera always learns whether it
 *   was saved.
 *
 * The fix is chosen once, on the sheet. Try again keeps it, so a retried correction can never turn
 * into a negative.
 */
export function rejectionReducer(state: Rejection, event: RejectionEvent): Rejection {
  switch (event.type) {
    case 'reject': {
      if (state.stage !== 'idle') return state;
      const pinned = pin(event);
      return pinned === null ? state : { stage: 'asking', pinned };
    }
    case 'notInList':
      return state.stage === 'asking' ? { stage: 'capturing', pinned: state.pinned, fix: { kind: 'notInList' } } : state;
    case 'correct': {
      if (state.stage !== 'asking' || event.productId === '') return state;
      const { pinned } = state;
      // A question or a quote named one product, and the tindera said it is not that one, so
      // correcting to it contradicts her tap and would teach it the frame it just got wrong. Chips
      // named two near-ties: saying which one it really is, is the correction (ADR-022).
      if (pinned.source !== 'wrong_chip' && pinned.productIds.includes(event.productId)) return state;
      return { stage: 'capturing', pinned, fix: { kind: 'correct', productId: event.productId } };
    }
    case 'retry':
      return state.stage === 'mismatch' || state.stage === 'failed' ? { stage: 'capturing', pinned: state.pinned, fix: state.fix } : state;
    case 'captured':
      if (state.stage !== 'capturing') return state;
      // The guard (ADR-017): the saved frame must still show what was rejected. If the phone has
      // moved to a real product, a negative would silence it and a correction would teach the
      // picked product someone else's photo.
      return captureStillMatches(state.pinned.lockedKey, event.decision)
        ? { stage: 'saving', pinned: state.pinned, fix: state.fix }
        : { stage: 'mismatch', pinned: state.pinned, fix: state.fix };
    case 'saved':
      return state.stage === 'saving' ? { stage: 'saved', pinned: state.pinned, fix: state.fix } : state;
    case 'saveFailed':
      return state.stage === 'saving' ? { stage: 'failed', pinned: state.pinned, fix: state.fix, message: event.message } : state;
    case 'close':
      return state.stage === 'saving' ? state : IDLE;
  }
}

/**
 * Only a lock that named something can be rejected, and each source matches one card: chips for
 * wrong_chip, a single product for the other two. Anything else pins nothing.
 */
function pin({ locked, source, top, negativeIds }: Extract<RejectionEvent, { type: 'reject' }>): Pinned | null {
  let productIds: string[];
  if (locked.kind === 'accept' && source !== 'wrong_chip') {
    productIds = [locked.product.productId];
  } else if (locked.kind === 'disambiguate' && source === 'wrong_chip') {
    productIds = [locked.first.productId, locked.second.productId];
  } else {
    return null;
  }
  return { lockedKey: decisionKey(locked), source, productIds, likelyIds: likelyProducts(top, productIds, negativeIds) };
}
