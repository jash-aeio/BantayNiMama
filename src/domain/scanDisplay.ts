// What the scanner shows — SR-10, SR-13, TR-38, TR-39; ADR-017, ADR-018. Pure.
//
// Two steps, split on purpose (PHASE_2_PLAN.md E-5):
// 1. resolveFrame, per frame, between match() and stability. Negatives and ambiguous products are
//    resolved here, so the stability window votes on what the tindera could actually be shown.
// 2. displayFor, once a result has locked. An ACCEPT becomes a quote or a question. That depends
//    only on catalog size, so it never needs a vote.
// match.ts does not change, which keeps the Phase 0 golden replay a valid regression test (ADR-012).

import type { Decision, ProductScore } from './match.ts';

/** match()'s decision after resolveFrame. No id in it is a negative. */
export type FrameDecision =
  | Decision
  | {
      readonly kind: 'quickPick';
      /**
       * The decision's products, best first; at least one is ambiguous. For the lock log and for
       * highlighting a tile. The grid itself lists every ambiguous product.
       */
      readonly productIds: readonly string[];
      readonly score: number;
    };

export interface CatalogFacts {
  /** From the index (knn.ts), so they always match the rows being searched. */
  readonly negativeIds: ReadonlySet<string>;
  /** Live products flagged `is_ambiguous` (SR-10). */
  readonly ambiguousIds: ReadonlySet<string>;
}

const UNKNOWN: FrameDecision = { kind: 'unknown', best: null };

/**
 * Per frame, in this order:
 *
 * 1. **A negative at top-1, or in a chip pair → UNKNOWN** (TR-39). The UNKNOWN does not carry the
 *    negative as its best candidate, so no negative id ever reaches the card.
 * 2. **An ambiguous product at top-1, or in a chip pair → quickPick** (SR-10, ADR-018).
 *
 * Negatives are checked first. A frame close to both a negative and a clear bag is one the tindera
 * has already said is not in her list, and UNKNOWN is the answer that names nothing.
 *
 * A negative that is only runner-up to an ACCEPT changes nothing. It already counted toward δ in
 * match(), and a Decision keeps no runner-up for an ACCEPT.
 */
export function resolveFrame(decision: Decision, facts: CatalogFacts): FrameDecision {
  const { negativeIds, ambiguousIds } = facts;
  switch (decision.kind) {
    case 'accept': {
      const { productId, score } = decision.product;
      if (negativeIds.has(productId)) return UNKNOWN;
      if (ambiguousIds.has(productId)) return { kind: 'quickPick', productIds: [productId], score };
      return decision;
    }
    case 'disambiguate': {
      const { first, second } = decision;
      if (negativeIds.has(first.productId) || negativeIds.has(second.productId)) return UNKNOWN;
      if (ambiguousIds.has(first.productId) || ambiguousIds.has(second.productId)) {
        return { kind: 'quickPick', productIds: [first.productId, second.productId], score: first.score };
      }
      return decision;
    }
    case 'unknown':
      return decision.best !== null && negativeIds.has(decision.best.productId) ? UNKNOWN : decision;
  }
}

/** The card states of the Scan tab (PHASE_2_PLAN.md P2-3). */
export type ScanCard =
  | { readonly kind: 'scanning' }
  | { readonly kind: 'unknown' }
  /** A confident price. Only at or above confirm_below. */
  | { readonly kind: 'quote'; readonly product: ProductScore; readonly margin: number | null }
  /** "Is this {name}? ₱{price}" with Yes / No (SR-13). */
  | { readonly kind: 'confirm'; readonly product: ProductScore; readonly margin: number | null }
  | { readonly kind: 'chips'; readonly first: ProductScore; readonly second: ProductScore; readonly margin: number }
  | { readonly kind: 'quickPick'; readonly productIds: readonly string[] };

/**
 * SR-13, TR-38: whether an ACCEPT must be asked rather than quoted.
 *
 * With no `confirm_below` row, every ACCEPT is a question, whatever the catalog size (ADR-017, D-1).
 * No value is known to be safe until Phase 3 measures one.
 *
 * Bad input throws instead of guessing. A NaN count makes `count < cutoff` false, which would quote
 * every price confidently on the catalogs least able to reject un-enrolled items (ADR-013).
 */
export function inConfirmMode(liveProductCount: number, confirmBelow: number | null): boolean {
  if (!Number.isSafeInteger(liveProductCount) || liveProductCount < 0) {
    throw new RangeError(`Live product count must be a non-negative integer, got ${liveProductCount}`);
  }
  if (confirmBelow !== null && (!Number.isSafeInteger(confirmBelow) || confirmBelow < 0)) {
    throw new RangeError(`confirm_below must be a non-negative integer, got ${confirmBelow}`);
  }
  return confirmBelow === null || liveProductCount < confirmBelow;
}

/**
 * After the lock: the card to render. `liveProductCount` counts products that are not deleted,
 * ambiguous ones included. Negatives are not products.
 */
export function displayFor(locked: FrameDecision | null, liveProductCount: number, confirmBelow: number | null): ScanCard {
  const confirm = inConfirmMode(liveProductCount, confirmBelow);
  if (locked === null) return { kind: 'scanning' };
  switch (locked.kind) {
    case 'accept':
      return { kind: confirm ? 'confirm' : 'quote', product: locked.product, margin: locked.margin };
    case 'disambiguate':
      return { kind: 'chips', first: locked.first, second: locked.second, margin: locked.margin };
    case 'quickPick':
      return { kind: 'quickPick', productIds: locked.productIds };
    case 'unknown':
      return { kind: 'unknown' };
  }
}
