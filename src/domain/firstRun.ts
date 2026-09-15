// First run: the guided "add your first five items" flow and its progress banner — SR-44, SR-20.
// Pure: the product count and the saved dismissal arrive as data.

import { MAX_SHOTS } from './enrollment.ts';

export const FIRST_RUN_TARGET = 5;

/** The `app_meta` row written when the tindera taps *Finish later*. Absent until then. */
export const FIRST_RUN_DISMISSED_META_KEY = 'first_run_dismissed';
export const FIRST_RUN_DISMISSED_VALUE = '1';

/**
 * The `app_meta` row written when the intro reaches its camera step.
 *
 * Granting a blocked camera means leaving for system settings, and Android may kill the app while
 * she is there: on the Infinix it happened 4 s after Permissions opened (P2-6, device attempt 1).
 * The relaunch then resumes at the camera step instead of replaying the welcome (SR-43: "returns to
 * the flow").
 */
export const FIRST_RUN_INTRO_META_KEY = 'first_run_intro';
export const FIRST_RUN_INTRO_AT_CAMERA = 'camera';

export type IntroStep = 'welcome' | 'language' | 'camera';

export type FirstRun =
  | { readonly kind: 'welcome' }
  | { readonly kind: 'banner'; readonly done: number; readonly target: number }
  | { readonly kind: 'complete' };

/**
 * - **Five or more live products → complete:** no flow and no banner.
 * - **An empty catalog, never dismissed → the welcome flow.**
 * - **Anything else → the "n of 5" banner.** That covers *Finish later*, and a flow left part-way
 *   (the app closed after two products), which resumes from the banner rather than replaying
 *   screens she has already seen.
 *
 * Deleting back below five brings the banner back. The catalog is again too small to reject
 * un-enrolled items (ADR-013).
 *
 * A saved value other than "1" counts as not dismissed. It is ignored rather than thrown on, as a
 * bad `ui_language` row is: it is not a price, and it must never stop the app from opening.
 */
export function firstRunState(liveProductCount: number, savedDismissal: string | null): FirstRun {
  assertCount(liveProductCount);
  if (liveProductCount >= FIRST_RUN_TARGET) return { kind: 'complete' };
  if (liveProductCount === 0 && savedDismissal !== FIRST_RUN_DISMISSED_VALUE) return { kind: 'welcome' };
  return { kind: 'banner', done: liveProductCount, target: FIRST_RUN_TARGET };
}

/**
 * Where the intro opens: the camera step once this install has reached it, else the welcome. The
 * camera step moves on by itself when the camera is already granted, so a relaunch after a grant in
 * settings goes straight to the guided add. An unrecognised value is ignored, as a bad dismissal is.
 */
export function introStartStep(saved: string | null): 'welcome' | 'camera' {
  return saved === FIRST_RUN_INTRO_AT_CAMERA ? 'camera' : 'welcome';
}

/**
 * SR-20: one change of angle or light per photo, in order, as many as enrollment allows. Different
 * views give the product more than one way to be matched; five near-identical shots add storage
 * and no recall.
 */
export const SHOT_ANGLES = ['front', 'turnLeft', 'turnRight', 'backOrTop', 'otherLight'] as const;
export type ShotAngle = (typeof SHOT_ANGLES)[number];

/** The prompt for the next photo, or null once enrollment's cap is reached (TR-42). */
export function nextShotAngle(shotsTaken: number): ShotAngle | null {
  assertCount(shotsTaken);
  if (shotsTaken >= MAX_SHOTS) return null;
  return SHOT_ANGLES[shotsTaken] ?? null;
}

/**
 * What the guided flow shows after a save, from the live count including the new product.
 *
 * - **The first product → try scanning it.** The Yes / No question is best learned on something
 *   real, and a catalog of one is exactly where the app must ask (ADR-013).
 * - **Two to four → add the next one.**
 * - **Five or more → complete.**
 */
export function afterGuidedSave(liveProductCountAfter: number): 'tryScanning' | 'next' | 'complete' {
  assertCount(liveProductCountAfter);
  if (liveProductCountAfter === 0) throw new RangeError('A save leaves at least one live product');
  if (liveProductCountAfter >= FIRST_RUN_TARGET) return 'complete';
  return liveProductCountAfter === 1 ? 'tryScanning' : 'next';
}

function assertCount(n: number): void {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`Count must be a non-negative integer, got ${n}`);
}
