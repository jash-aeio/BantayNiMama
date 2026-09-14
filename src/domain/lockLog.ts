// The scan run's lock log — PHASE_1_PLAN.md §4 step 5. Pure.
//
// Every change of the stability-locked decision is recorded, so a gate run's "zero wrong locks" is
// checked against the whole run, not against screenshots taken seconds apart. The operator points
// at an empty table between products, which locks UNKNOWN; that is where the run is split.
//
// Each change also keeps its own score and margin, and the frames that voted for it. That is how a
// wrong lock is diagnosed: blurred votes (TR-27), sharp votes past τ/δ (TR-35), or one odd frame
// carried by the stability quorum (TR-36, 4 of 5 since ADR-016).

import type { Decision } from './match.ts';

/** Enough for a 20-product run many times over; the oldest events are dropped beyond it. */
export const LOCK_LOG_LIMIT = 5000;

/** One processed frame's decision, as it entered the stability window. */
export interface FrameVote {
  readonly kind: 'accept' | 'disambiguate' | 'unknown';
  /** accept: the product. disambiguate: the first. unknown: the best candidate, if any. */
  readonly topId: string | null;
  readonly topScore: number | null;
  /** disambiguate: the second product. A Decision does not keep the runner-up of an accept. */
  readonly secondId: string | null;
  /** top1 − top2, when there was a second product. */
  readonly margin: number | null;
  /** laplacianVariance of the frame, or null when not measured. */
  readonly sharpness: number | null;
}

export function frameVote(decision: Decision, sharpness: number | null): FrameVote {
  switch (decision.kind) {
    case 'accept':
      return {
        kind: 'accept',
        topId: decision.product.productId,
        topScore: decision.product.score,
        secondId: null,
        margin: decision.margin,
        sharpness,
      };
    case 'disambiguate':
      return {
        kind: 'disambiguate',
        topId: decision.first.productId,
        topScore: decision.first.score,
        secondId: decision.second.productId,
        margin: decision.margin,
        sharpness,
      };
    case 'unknown':
      return {
        kind: 'unknown',
        topId: decision.best?.productId ?? null,
        topScore: decision.best?.score ?? null,
        secondId: null,
        margin: null,
        sharpness,
      };
  }
}

export interface LockEvent {
  readonly atMs: number;
  /** 'none' means no decision has quorum, and the overlay shows "point the box at a product". */
  readonly kind: 'accept' | 'disambiguate' | 'unknown' | 'none';
  /** accept: [product]. disambiguate: [first, second], best first. Otherwise empty. */
  readonly productIds: readonly string[];
  /** The locked decision's top score (accept, disambiguate) or best score (unknown). */
  readonly score: number | null;
  readonly margin: number | null;
  /** The stability window's frames when the lock changed, oldest first. */
  readonly votes: readonly FrameVote[];
}

export function lockEvent(decision: Decision | null, atMs: number, votes: readonly FrameVote[] = []): LockEvent {
  if (decision === null) return { atMs, kind: 'none', productIds: [], score: null, margin: null, votes };
  switch (decision.kind) {
    case 'accept':
      return {
        atMs,
        kind: 'accept',
        productIds: [decision.product.productId],
        score: decision.product.score,
        margin: decision.margin,
        votes,
      };
    case 'disambiguate':
      return {
        atMs,
        kind: 'disambiguate',
        productIds: [decision.first.productId, decision.second.productId],
        score: decision.first.score,
        margin: decision.margin,
        votes,
      };
    case 'unknown':
      return { atMs, kind: 'unknown', productIds: [], score: decision.best?.score ?? null, margin: null, votes };
  }
}

export function appendLockEvent(log: readonly LockEvent[], event: LockEvent, limit: number = LOCK_LOG_LIMIT): LockEvent[] {
  return [...log.slice(-(limit - 1)), event];
}

export interface SegmentItem {
  readonly kind: 'accept' | 'disambiguate';
  /** As first seen. For chips, the first id was top-1 at that moment. */
  readonly productIds: readonly string[];
  /** How many times this lock was entered within the segment. */
  readonly count: number;
  readonly firstMs: number;
}

export interface LockSegment {
  readonly startMs: number;
  /** When the UNKNOWN lock that closed it began, or the segment's last event. */
  readonly endMs: number;
  /** Distinct locks, in first-seen order. */
  readonly items: readonly SegmentItem[];
}

/**
 * Splits a run at UNKNOWN locks.
 *
 * - **Chips:** a chip pair counts once whichever product ranked first, because near-tied products
 *   swap order frame to frame.
 * - **'none' events:** they never split and never count, because losing quorum mid-product is
 *   normal.
 * - **Empty segments** (Unknown followed by Unknown) are dropped.
 */
export function segmentLockLog(events: readonly LockEvent[]): LockSegment[] {
  const segments: LockSegment[] = [];
  let items: { key: string; kind: 'accept' | 'disambiguate'; productIds: readonly string[]; count: number; firstMs: number }[] = [];
  let startMs: number | null = null;
  let lastMs = 0;

  const close = (endMs: number) => {
    if (startMs !== null && items.length > 0) {
      segments.push({
        startMs,
        endMs,
        items: items.map(({ kind, productIds, count, firstMs }) => ({ kind, productIds, count, firstMs })),
      });
    }
    items = [];
    startMs = null;
  };

  for (const event of events) {
    if (event.kind === 'unknown') {
      close(event.atMs);
      continue;
    }
    if (event.kind === 'none') continue;

    const key = `${event.kind}:${[...event.productIds].sort().join('|')}`;
    const existing = items.find((item) => item.key === key);
    if (existing !== undefined) {
      existing.count += 1;
    } else {
      items.push({ key, kind: event.kind, productIds: event.productIds, count: 1, firstMs: event.atMs });
    }
    if (startMs === null) startMs = event.atMs;
    lastMs = event.atMs;
  }
  close(lastMs);
  return segments;
}
