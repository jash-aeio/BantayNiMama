// Search by name — SR-07 (the reject sheet, P2-4), and SR-30's Directory in P2-7. Pure.

/** Enough to fill the sheet without scrolling past the camera. */
export const SEARCH_LIMIT = 8;

export interface Named {
  readonly id: string;
  readonly name: string;
}

/**
 * Lower case, with accents removed and spaces collapsed, so "pina" finds "Piña" and "LUCKY  me"
 * finds "Lucky Me". Accents are stripped as the combining marks left by NFD, a fixed range, so the
 * result does not depend on the phone's language.
 */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Every word of the query must appear somewhere in the name, in any order: "beef lucky" finds
 * "Lucky Me Beef". Names that start with the first word come first. Otherwise the input order is
 * kept, which is by name from listProducts. A blank query finds nothing, because the sheet shows
 * the likely products then.
 */
export function searchProducts<T extends Named>(items: readonly T[], query: string, limit: number = SEARCH_LIMIT): T[] {
  const words = normalizeForSearch(query).split(' ').filter((w) => w !== '');
  const first = words[0];
  if (first === undefined) return [];

  const starts: T[] = [];
  const contains: T[] = [];
  for (const item of items) {
    const name = normalizeForSearch(item.name);
    if (!words.every((w) => name.includes(w))) continue;
    (name.startsWith(first) ? starts : contains).push(item);
  }
  return [...starts, ...contains].slice(0, limit);
}
