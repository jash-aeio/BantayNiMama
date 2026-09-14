// Temporal stability gate — TR-36, SR-12. Pure: the scanner pushes one Decision per
// processed frame and renders only what lockedDecision returns.

import type { Decision } from './match.ts';

/**
 * TR-36, as amended by ADR-016: lock when **4** of the last 5 frame decisions agree, about 1 s at
 * 4 fps (TR-26). It was 3 of 5 until gate run 2 (P1-8) locked a wrong product. The diagnosis then
 * found lone accept-grade votes for a look-alike can, at most one per window. Needing 4 votes makes
 * such a streak far harder to lock, at the cost of ~250 ms per lock (NFR-02 over speed).
 */
export const STABILITY_WINDOW = 5;
export const STABILITY_QUORUM = 4;

export interface StabilityBuffer {
  /** Most recent last. Never longer than the window. */
  readonly recent: readonly Decision[];
}

export const emptyBuffer: StabilityBuffer = { recent: [] };

/** Returns a new buffer; the old one is untouched, so it is safe to hold in React state or a ref. */
export function pushDecision(
  buffer: StabilityBuffer,
  decision: Decision,
  window: number = STABILITY_WINDOW,
): StabilityBuffer {
  if (!Number.isInteger(window) || window < 1) {
    throw new RangeError(`Stability window must be a positive integer, got ${window}`);
  }
  return { recent: [...buffer.recent, decision].slice(-window) };
}

/**
 * What "agree" means. ACCEPTs agree on the product. DISAMBIGUATEs agree on the pair in
 * either order — two near-tied products swap places frame to frame, and that swap is
 * exactly the flicker this gate exists to stop. UNKNOWNs agree with each other.
 */
export function decisionKey(decision: Decision): string {
  switch (decision.kind) {
    case 'accept':
      return `accept:${decision.product.productId}`;
    case 'disambiguate': {
      const [a, b] = [decision.first.productId, decision.second.productId].sort();
      return `disambiguate:${a}|${b}`;
    }
    case 'unknown':
      return 'unknown';
  }
}

/**
 * The decision to render, or null while nothing has reached quorum.
 *
 * Returns the MOST RECENT decision with the winning key, so the confidence shown (SR-03)
 * reflects the current frame rather than the first one that voted.
 */
export function lockedDecision(
  buffer: StabilityBuffer,
  quorum: number = STABILITY_QUORUM,
  window: number = STABILITY_WINDOW,
): Decision | null {
  // quorum > window / 2 means at most one key can hold it, so a lock is never a tie.
  if (!Number.isInteger(quorum) || !Number.isInteger(window) || quorum * 2 <= window || quorum > window) {
    throw new RangeError(`Quorum ${quorum} of ${window} could lock two results at once`);
  }

  const inWindow = buffer.recent.slice(-window);
  const counts = new Map<string, number>();
  let winner: string | null = null;
  for (const decision of inWindow) {
    const key = decisionKey(decision);
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    if (n >= quorum) winner = key;
  }
  if (winner === null) return null;

  for (let i = inWindow.length - 1; i >= 0; i--) {
    const decision = inWindow[i]!;
    if (decisionKey(decision) === winner) return decision;
  }
  return null;
}
