// Quick-pick grid — SR-10, L-01, ADR-018. Pure.
//
// The grid a repacked item opens, and the pinned button on the Scan tab. Tiles are in a fixed order,
// by name, with nothing highlighted and no price until a tap (operator's call, 2026-09-14, P2-5).
// Clear bags look identical (L-01), so the bag the camera ranked first is a guess. Putting it at the
// front, or a price on every tile, would hand the helper the answer the scanner may not give.

export interface TileProduct {
  readonly id: string;
  readonly name: string;
}

/**
 * The grid's tiles: every live repacked product, plus any product the locked frame involved that is
 * not repacked. That happens when a clear bag chips with an ordinary product. The frame was close to
 * that product too, and leaving it out would send the tindera to search.
 *
 * Each id appears once, ordered by name ignoring case, then by id, so the same catalog always gives
 * the same grid whatever the camera saw. `involved` must hold live products only.
 */
export function quickPickTiles<T extends TileProduct>(repacked: readonly T[], involved: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const product of [...repacked, ...involved]) {
    if (!byId.has(product.id)) byId.set(product.id, product);
  }
  return [...byId.values()].sort(compareTiles);
}

function compareTiles(a: TileProduct, b: TileProduct): number {
  const an = a.name.toLowerCase();
  const bn = b.name.toLowerCase();
  if (an !== bn) return an < bn ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
