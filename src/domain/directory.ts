// The Directory — SR-30, SR-34, SR-35. Pure: rows arrive already read from SQLite.

import { normalizeForSearch } from './productSearch.ts';
import type { FrameDecision } from './scanDisplay.ts';

export const DIRECTORY_SORTS = ['name', 'recentlyAdded', 'recentlyScanned'] as const;
export type DirectorySort = (typeof DIRECTORY_SORTS)[number];

export interface DirectoryEntry {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly lastScannedAt: number | null;
}

/**
 * SR-30: every word of the query appears in the name, in any order, with case and accents ignored,
 * as in the reject sheet's search. A blank query keeps everything. Unlike that search there is no
 * limit, and the order is the chosen sort's, not match quality.
 */
export function filterByName<T extends { readonly name: string }>(items: readonly T[], query: string): T[] {
  const words = normalizeForSearch(query).split(' ').filter((w) => w !== '');
  if (words.length === 0) return [...items];
  return items.filter((item) => {
    const name = normalizeForSearch(item.name);
    return words.every((w) => name.includes(w));
  });
}

/**
 * SR-34. Every order ends on the name, then the id, so rows never swap places between renders.
 * - `name`: A to Z, case and accents ignored.
 * - `recentlyAdded`: newest first.
 * - `recentlyScanned`: most recent first; products never scanned last, by name.
 */
export function sortDirectory<T extends DirectoryEntry>(items: readonly T[], sort: DirectorySort): T[] {
  const byName = (a: T, b: T) => compare(normalizeForSearch(a.name), normalizeForSearch(b.name)) || compare(a.id, b.id);
  const sorted = [...items];
  switch (sort) {
    case 'name':
      return sorted.sort(byName);
    case 'recentlyAdded':
      return sorted.sort((a, b) => b.createdAt - a.createdAt || byName(a, b));
    case 'recentlyScanned':
      return sorted.sort((a, b) => {
        if (a.lastScannedAt === null || b.lastScannedAt === null) {
          return a.lastScannedAt === b.lastScannedAt ? byName(a, b) : a.lastScannedAt === null ? 1 : -1;
        }
        return b.lastScannedAt - a.lastScannedAt || byName(a, b);
      });
  }
}

export function directoryView<T extends DirectoryEntry>(items: readonly T[], query: string, sort: DirectorySort): T[] {
  return sortDirectory(filterByName(items, query), sort);
}

/**
 * SR-34: the products a new lock counts as scanned. Only an ACCEPT names one. Chips, the grid and
 * Unknown name nothing, and the tindera's own chip or tile tap is stamped where she taps. The caller
 * writes this once per lock change, never per frame.
 */
export function scannedProductIds(locked: FrameDecision | null): string[] {
  return locked !== null && locked.kind === 'accept' ? [locked.product.productId] : [];
}

/** SR-35: how many reference photos are on disk, and their total size. */
export function storageSummary(photos: readonly { readonly bytes: number }[]): { readonly count: number; readonly bytes: number } {
  let bytes = 0;
  for (const photo of photos) {
    if (!Number.isSafeInteger(photo.bytes) || photo.bytes < 0) throw new RangeError(`Photo size must be whole bytes, got ${photo.bytes}`);
    bytes += photo.bytes;
  }
  return { count: photos.length, bytes };
}

/** "845 KB", "12.3 MB". Binary units, one decimal for MB. Digits only, so it reads the same in en and fil. */
export function formatBytes(bytes: number): string {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError(`Bytes must be a whole non-negative number, got ${bytes}`);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Code-unit order, not localeCompare, so the order does not depend on the phone's language. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
