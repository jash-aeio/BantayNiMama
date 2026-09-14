// Corrections and the capture guard — SR-07, SR-14, TR-42; ADR-017, ADR-019. Pure.

import { MAX_SHOTS } from './enrollment.ts';
import type { FrameDecision } from './scanDisplay.ts';
import { decisionKey } from './stability.ts';

/** `product_shots.source` from schema v2 (P2-2). */
export const SHOT_SOURCES = ['enroll', 'correction', 'teach'] as const;
export type ShotSource = (typeof SHOT_SOURCES)[number];

/** `negative_shots.source` from schema v2 (P2-2): what the tindera rejected when she marked it (SR-14). */
export const NEGATIVE_SOURCES = ['confirm_no', 'wrong_lock', 'wrong_chip'] as const;
export type NegativeSource = (typeof NEGATIVE_SOURCES)[number];

/** TR-42 as amended by ADR-019: up to 3 correction shots on top of enrollment's 5. */
export const MAX_CORRECTION_SHOTS = 3;

/** 8. KNN_LIMIT is exact up to 9 shots per product (knn.ts), so raising this past 9 must raise it too. */
export const MAX_PRODUCT_SHOTS = MAX_SHOTS + MAX_CORRECTION_SHOTS;

export interface ExistingShot {
  readonly id: string;
  readonly source: ShotSource;
  /** Epoch milliseconds, as `product_shots.created_at`. */
  readonly createdAt: number;
}

/**
 * The correction shots to remove, in the same transaction, before a new correction goes in: the
 * oldest first (D-3). Enrollment and teach shots are never on the list, because their JPEGs are the
 * product's reference photos (TR-24).
 *
 * Normally empty, or one id once the product holds 3. If a product somehow holds more, every
 * correction beyond the newest 2 is returned, so the next correction brings it back under the cap
 * instead of leaving it over.
 */
export function correctionsToReplace(shots: readonly ExistingShot[]): string[] {
  const corrections = shots.filter((s) => s.source === 'correction');
  for (const { id, createdAt } of corrections) {
    if (!Number.isFinite(createdAt)) throw new RangeError(`Shot ${id} has no usable created_at: ${createdAt}`);
  }
  const excess = corrections.length - (MAX_CORRECTION_SHOTS - 1);
  if (excess <= 0) return [];
  return [...corrections]
    .sort((a, b) => a.createdAt - b.createdAt || compareIds(a.id, b.id))
    .slice(0, excess)
    .map((s) => s.id);
}

/**
 * The capture guard (P2-3, P2-4). A negative or a correction is saved from the frame after the tap,
 * and only if that frame still resolves to the lock the tindera rejected.
 *
 * By then the phone may point at something else. Saving that frame teaches the wrong thing. As a
 * negative, it silences whatever the frame shows, which can be a real product (ADR-017).
 *
 * Agreement is exact, as in the stability gate: a chip pair matches in either order, but a frame
 * that now ACCEPTs one product of a rejected pair does not match. Only a lock that named something
 * can be rejected, so an UNKNOWN or quick-pick lock never matches.
 */
export function captureStillMatches(lockedKey: string, captureDecision: FrameDecision): boolean {
  if (!lockedKey.startsWith('accept:') && !lockedKey.startsWith('disambiguate:')) return false;
  return decisionKey(captureDecision) === lockedKey;
}

/** Code-unit order, not localeCompare — the result must not depend on the phone's language. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
