// Time-to-lock — NFR-04 (p90 ≤ 1.2 s), PHASE_2_PLAN.md P2-8. Pure.
//
// The app cannot see the moment a product enters the reticle, so it measures a proxy. An episode
// starts at the empty-table UNKNOWN lock, t_seen is its first frame that was not UNKNOWN, and t_lock
// is the next result lock. The proxy under-reads: a product moving in, or scoring below τ, is already
// in view while it still votes UNKNOWN. So it is calibrated against screen recordings, and the bias
// is reported beside the proxy rather than folded into it.

import type { LockEvent } from './lockLog.ts';
import type { FrameDecision } from './scanDisplay.ts';
import { summarize, type Summary } from './stats.ts';

/**
 * One processed frame. `atMs` is when the camera captured it, on the same clock as the lock log.
 * Frames arrive oldest first.
 */
export interface FrameLogEntry {
  readonly atMs: number;
  /** After resolveFrame, so a frame silenced by a negative counts as UNKNOWN. */
  readonly kind: FrameDecision['kind'];
}

export interface LockEpisode {
  /** When the UNKNOWN lock that opened the episode happened. */
  readonly unknownMs: number;
  /** t_seen. */
  readonly seenMs: number;
  /** t_lock. */
  readonly lockMs: number;
  readonly lockKind: 'accept' | 'disambiguate' | 'quickPick';
  readonly productIds: readonly string[];
  /** t_lock − t_seen: the NFR-04 proxy. */
  readonly proxyMs: number;
}

export interface EpisodeReport {
  readonly episodes: readonly LockEpisode[];
  /** Episodes that opened before the frame log's oldest entry, so t_seen is unknown. Left out, never guessed. */
  readonly truncated: number;
  /**
   * Episodes with no non-UNKNOWN frame between their UNKNOWN lock and their result lock. A result
   * lock needs 4 such votes, so this means the frame clock and the lock clock disagree. Left out, and
   * reported so the offset is seen rather than hidden.
   */
  readonly inconsistent: number;
}

/**
 * Only the first result lock after an UNKNOWN lock closes an episode. Chips settling into an ACCEPT
 * is still one product in the reticle. Losing quorum ('none') neither opens nor closes an episode.
 * A second UNKNOWN lock before any result reopens it: the product left before it locked.
 */
export function lockEpisodes(frames: readonly FrameLogEntry[], locks: readonly LockEvent[]): EpisodeReport {
  const episodes: LockEpisode[] = [];
  let truncated = 0;
  let inconsistent = 0;
  const oldestFrameMs = frames[0]?.atMs ?? Infinity;
  let openedMs: number | null = null;

  for (const event of locks) {
    if (event.kind === 'unknown') {
      openedMs = event.atMs;
      continue;
    }
    if (event.kind === 'none' || openedMs === null) continue;

    const unknownMs = openedMs;
    openedMs = null;
    if (unknownMs < oldestFrameMs) {
      truncated++;
      continue;
    }
    const seen = frames.find((f) => f.atMs > unknownMs && f.atMs <= event.atMs && f.kind !== 'unknown');
    if (seen === undefined) {
      inconsistent++;
      continue;
    }
    episodes.push({
      unknownMs,
      seenMs: seen.atMs,
      lockMs: event.atMs,
      lockKind: event.kind,
      productIds: event.productIds,
      proxyMs: event.atMs - seen.atMs,
    });
  }
  return { episodes, truncated, inconsistent };
}

/** One calibration episode, read frame by frame from a screen recording. */
export interface CalibrationSample {
  /** t_enter: the product visibly inside the reticle. */
  readonly enterMs: number;
  /** t_seen for the same episode. */
  readonly seenMs: number;
}

export interface TimeToLockReport {
  readonly proxy: Summary | null;
  /** t_seen − t_enter over the calibration samples: how far the proxy under-reads. */
  readonly bias: Summary | null;
  /**
   * The proxy p90 plus the median bias. An adjustment, not a measured p90: label it that way
   * wherever it is recorded.
   */
  readonly correctedP90Ms: number | null;
}

export function timeToLockReport(
  episodes: readonly LockEpisode[],
  calibration: readonly CalibrationSample[] = [],
): TimeToLockReport {
  const proxy = summarize(episodes.map((e) => e.proxyMs));
  const bias = summarize(calibration.map((s) => s.seenMs - s.enterMs));
  return {
    proxy,
    bias,
    correctedP90Ms: proxy === null || bias === null ? null : proxy.p90 + bias.median,
  };
}
