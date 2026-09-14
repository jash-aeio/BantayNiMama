// The matching policy — TR-30 to TR-35, pure per TR-37. No camera, no database, no React:
// the DB layer hands over KNN rows, and this decides what the tindera is shown.

/** One KNN row (TR-30): a stored shot's similarity to the query frame. */
export interface ShotMatch {
  readonly productId: string;
  /** Cosine similarity in [-1, 1]. The DB layer converts sqlite-vec distances before calling. */
  readonly similarity: number;
}

export interface ProductScore {
  readonly productId: string;
  readonly score: number;
}

/** τ and δ as read from `app_meta` (TR-35, ADR-008) — never constants. */
export interface Thresholds {
  readonly tau: number;
  readonly delta: number;
}

export type Decision =
  | {
      readonly kind: 'accept';
      readonly product: ProductScore;
      /** null when no other product is in the running, so there is nothing for δ to measure. */
      readonly margin: number | null;
    }
  | {
      readonly kind: 'disambiguate';
      readonly first: ProductScore;
      readonly second: ProductScore;
      readonly margin: number;
    }
  | { readonly kind: 'unknown'; readonly best: ProductScore | null };

/**
 * TR-31: a product's score is its BEST shot, not its mean. Averaging would punish products
 * enrolled from varied angles, which is exactly what SR-20 asks the tindera to do.
 *
 * Sorted best first; ties break by productId so the same rows always rank the same way.
 * Non-finite similarities are dropped: NaN has no place in a sort order and could float a
 * wrong product to the top.
 */
export function rankProducts(matches: readonly ShotMatch[]): ProductScore[] {
  const best = new Map<string, number>();
  for (const { productId, similarity } of matches) {
    if (!Number.isFinite(similarity)) continue;
    const prev = best.get(productId);
    if (prev === undefined || similarity > prev) best.set(productId, similarity);
  }
  return [...best]
    .map(([productId, score]) => ({ productId, score }))
    .sort((a, b) => b.score - a.score || compareIds(a.productId, b.productId));
}

/**
 * TR-32 ACCEPT when top1 ≥ τ and top1 − top2 ≥ δ · TR-33 DISAMBIGUATE when top1 ≥ τ but the
 * margin falls short · TR-34 UNKNOWN otherwise.
 *
 * `ranked` must come from rankProducts, which guarantees top2 is the best *different*
 * product rather than top1's second-best shot.
 */
export function decide(ranked: readonly ProductScore[], thresholds: Thresholds): Decision {
  assertThresholds(thresholds);
  const { tau, delta } = thresholds;

  const first = ranked[0];
  if (first === undefined) return { kind: 'unknown', best: null };
  if (first.score < tau) return { kind: 'unknown', best: first };

  const second = ranked[1];
  if (second === undefined) return { kind: 'accept', product: first, margin: null };

  const margin = first.score - second.score;
  // An exact tie is a coin flip, so it never auto-accepts — not even at δ = 0 (NFR-02).
  if (margin < delta || margin === 0) return { kind: 'disambiguate', first, second, margin };
  return { kind: 'accept', product: first, margin };
}

/** rankProducts, then decide — the per-frame entry point. */
export function match(matches: readonly ShotMatch[], thresholds: Thresholds): Decision {
  return decide(rankProducts(matches), thresholds);
}

/**
 * A NaN τ or δ makes every `<` comparison false, which would turn decide() into "accept
 * everything". Thresholds arrive as TEXT from `app_meta`, so a bad row is a real
 * possibility — refuse it loudly instead of quoting prices confidently (NFR-02).
 */
export function assertThresholds({ tau, delta }: Thresholds): void {
  if (!Number.isFinite(tau) || tau < -1 || tau > 1) {
    throw new RangeError(`τ must be a finite number in [-1, 1], got ${tau}`);
  }
  if (!Number.isFinite(delta) || delta < 0 || delta > 2) {
    throw new RangeError(`δ must be a finite number in [0, 2], got ${delta}`);
  }
}

/** Code-unit order, not localeCompare — ranking must not depend on the phone's language. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
