// Soft delete, undo and the trash — SR-32. Pure: times arrive as epoch milliseconds, the unit of
// `products.deleted_at`.

/** SR-32: the undo bar after a delete. */
export const UNDO_WINDOW_MS = 10_000;

/** SR-32: how long a deleted product stays restorable before the launch purge removes it. */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Whether an undo tap is still honoured. Past the window, the product is restored from the trash
 * instead. If the clock has gone backwards since the delete, undo is not honoured; restoring from
 * the trash still works.
 */
export function canUndoDelete(deletedAt: number, now: number): boolean {
  const elapsed = elapsedMs(deletedAt, now);
  return elapsed >= 0 && elapsed < UNDO_WINDOW_MS;
}

/**
 * Whether the launch purge may remove a trashed product for good.
 *
 * A clock set backwards makes the elapsed time negative, and that never purges. **Known limit:** a
 * clock set forwards purges early. There is no trusted time to check it against, because the app
 * makes no network calls (TR-50).
 */
export function isPurgeable(deletedAt: number, now: number): boolean {
  return elapsedMs(deletedAt, now) >= TRASH_RETENTION_MS;
}

export function purgeableIds(trash: readonly { readonly id: string; readonly deletedAt: number }[], now: number): string[] {
  return trash.filter((item) => isPurgeable(item.deletedAt, now)).map((item) => item.id);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * SR-32: whole days left before the launch purge removes a trashed product, for the trash list. A
 * part day counts as a day, so "1" is shown until the purge is actually due, then "0". Never more
 * than 30, even with the clock set backwards since the delete.
 */
export function trashDaysLeft(deletedAt: number, now: number): number {
  const remaining = TRASH_RETENTION_MS - elapsedMs(deletedAt, now);
  if (remaining <= 0) return 0;
  return Math.min(Math.ceil(remaining / DAY_MS), TRASH_RETENTION_MS / DAY_MS);
}

function elapsedMs(deletedAt: number, now: number): number {
  // NaN compares false both ways: NaN would never purge, but it would also never undo, silently.
  if (!Number.isSafeInteger(deletedAt) || !Number.isSafeInteger(now)) {
    throw new RangeError(`Times must be whole epoch milliseconds, got deleted_at ${deletedAt} and now ${now}`);
  }
  return now - deletedAt;
}
