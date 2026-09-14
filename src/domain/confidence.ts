// The confidence indicator — SR-03. Pure.
//
// A score is a cosine similarity, not a probability, so the indicator never shows a number or a
// percentage a tindera would read as "chance of being right". It shows three bands built from the
// policy's own thresholds instead.

import { assertThresholds, type Decision, type Thresholds } from './match.ts';

export type Confidence = 'sure' | 'likely' | 'notSure';

/**
 * An ACCEPT whose margin over the next product is at least this many δ reads as "sure".
 *
 * Only the multiple is a constant; δ itself still comes from app_meta (TR-35). It is a placeholder
 * chosen by the operator (P1-6), not a calibration. Phase 3 retunes it together with τ/δ.
 */
export const SURE_MARGIN_IN_DELTAS = 2;

/**
 * - ACCEPT with margin ≥ 2δ → sure.
 * - ACCEPT with a smaller margin → likely.
 * - ACCEPT with no second product (margin null) → likely, never sure. With nothing to compare
 *   against, δ proves nothing, and a small catalog cannot reject un-enrolled items (ADR-013).
 * - DISAMBIGUATE → notSure: the two chips are the honest answer.
 * - UNKNOWN → null: no match, so nothing to rate.
 */
export function confidenceOf(decision: Decision, thresholds: Thresholds): Confidence | null {
  assertThresholds(thresholds);
  switch (decision.kind) {
    case 'accept':
      return decision.margin !== null && decision.margin >= SURE_MARGIN_IN_DELTAS * thresholds.delta ? 'sure' : 'likely';
    case 'disambiguate':
      return 'notSure';
    case 'unknown':
      return null;
  }
}
