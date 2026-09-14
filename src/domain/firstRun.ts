// First run: the guided "add your first five items" flow and its progress banner — SR-44. Pure: the
// product count and the saved dismissal arrive as data.

export const FIRST_RUN_TARGET = 5;

/** The `app_meta` row written when the tindera taps *Finish later*. Absent until then. */
export const FIRST_RUN_DISMISSED_META_KEY = 'first_run_dismissed';
export const FIRST_RUN_DISMISSED_VALUE = '1';

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
  if (!Number.isSafeInteger(liveProductCount) || liveProductCount < 0) {
    throw new RangeError(`Live product count must be a non-negative integer, got ${liveProductCount}`);
  }
  if (liveProductCount >= FIRST_RUN_TARGET) return { kind: 'complete' };
  if (liveProductCount === 0 && savedDismissal !== FIRST_RUN_DISMISSED_VALUE) return { kind: 'welcome' };
  return { kind: 'banner', done: liveProductCount, target: FIRST_RUN_TARGET };
}
