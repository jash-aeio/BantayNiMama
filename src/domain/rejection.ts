// The "Not in my list" flow — SR-13, SR-14, TR-39, ADR-017; PHASE_2_PLAN.md P2-3. Pure: a reducer
// the Scan tab drives. The side effects (the capture request, the JPEG, the INSERT) happen in
// useRejection, and only when the reducer has moved to the stage that allows them.

import { captureStillMatches, type NegativeSource } from './correction.ts';
import type { FrameDecision } from './scanDisplay.ts';
import { decisionKey } from './stability.ts';

/** What the tindera rejected, pinned at tap time. No later lock can change it. */
export interface Pinned {
  readonly lockedKey: string;
  readonly source: NegativeSource;
  /** The products the card showed, best first — for "the app said: …". */
  readonly productIds: readonly string[];
}

export type Rejection =
  | { readonly stage: 'idle' }
  /**
   * asking: the sheet is open. capturing: waiting for the next frame. mismatch: that frame no longer
   * showed the rejected lock, so nothing was saved. saving: the JPEG and row are being written.
   * saved: done.
   */
  | { readonly stage: 'asking' | 'capturing' | 'mismatch' | 'saving' | 'saved'; readonly pinned: Pinned }
  | { readonly stage: 'failed'; readonly pinned: Pinned; readonly message: string };

export type RejectionEvent =
  /** No on a question (confirm_no), Wrong? on a quote (wrong_lock), Neither on chips (wrong_chip). */
  | { readonly type: 'reject'; readonly locked: FrameDecision; readonly source: NegativeSource }
  | { readonly type: 'notInList' }
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
 */
export function rejectionReducer(state: Rejection, event: RejectionEvent): Rejection {
  switch (event.type) {
    case 'reject': {
      if (state.stage !== 'idle') return state;
      const pinned = pin(event.locked, event.source);
      return pinned === null ? state : { stage: 'asking', pinned };
    }
    case 'notInList':
      return state.stage === 'asking' || state.stage === 'mismatch' || state.stage === 'failed'
        ? { stage: 'capturing', pinned: state.pinned }
        : state;
    case 'captured':
      if (state.stage !== 'capturing') return state;
      // The guard (ADR-017): a negative silences whatever the saved frame shows. If the phone has
      // moved to a real product, saving would silence that product.
      return captureStillMatches(state.pinned.lockedKey, event.decision)
        ? { stage: 'saving', pinned: state.pinned }
        : { stage: 'mismatch', pinned: state.pinned };
    case 'saved':
      return state.stage === 'saving' ? { stage: 'saved', pinned: state.pinned } : state;
    case 'saveFailed':
      return state.stage === 'saving' ? { stage: 'failed', pinned: state.pinned, message: event.message } : state;
    case 'close':
      return state.stage === 'saving' ? state : IDLE;
  }
}

/**
 * Only a lock that named something can be rejected, and each source matches one card: chips for
 * wrong_chip, a single product for the other two. Anything else pins nothing.
 */
function pin(locked: FrameDecision, source: NegativeSource): Pinned | null {
  if (locked.kind === 'accept' && source !== 'wrong_chip') {
    return { lockedKey: decisionKey(locked), source, productIds: [locked.product.productId] };
  }
  if (locked.kind === 'disambiguate' && source === 'wrong_chip') {
    return { lockedKey: decisionKey(locked), source, productIds: [locked.first.productId, locked.second.productId] };
  }
  return null;
}
