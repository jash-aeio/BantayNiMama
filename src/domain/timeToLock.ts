// Time-to-lock — NFR-04 (p90 ≤ 1.2 s), PHASE_2_PLAN.md P2-8. Pure.
//
// The app cannot see the moment a product enters the reticle, so it measures a proxy. An episode
// starts at the empty-table UNKNOWN lock, t_seen is its first frame that was not UNKNOWN, and t_lock
// is the next result lock. The proxy under-reads: a product moving in, or scoring below τ, is already
// in view while it still votes UNKNOWN. So it is calibrated against screen recordings, and the bias
// is reported beside the proxy rather than folded into it.

import type { Interaction } from './interactionLog.ts';
import type { LockEvent } from './lockLog.ts';
import type { FrameDecision } from './scanDisplay.ts';
import { summarize, type Summary } from './stats.ts';

/** About 25 minutes of scanning at 4 fps: gate A5's 60 episodes with room to spare. */
export const FRAME_LOG_LIMIT = 6000;

/**
 * One processed frame, or a scanner reset. Entries are appended in arrival order.
 *
 * Both times are `Date.now()`. The worklet and the JS thread are separate runtimes, and their
 * `performance.now()` need not share an origin, but both read the same system clock through `Date`.
 * `clockCheck` verifies that on the device instead of assuming it.
 */
export interface FrameLogEntry {
  /**
   * After resolveFrame, so a frame silenced by a negative counts as UNKNOWN. `reset`: the scanner
   * dropped its votes (a panel opened or closed, the tab changed, the catalog was written).
   */
  readonly kind: FrameDecision['kind'] | 'reset';
  /** When the worklet began processing the frame. For a reset, when it happened. */
  readonly capturedAtMs: number;
  /** When the JS thread received it. For a reset, when it happened. */
  readonly arrivedAtMs: number;
  /** The worklet's own processing time for the frame (a duration, so no clock origin). 0 for a reset. */
  readonly workletMs: number;
}

/**
 * Appends in place. This runs once per frame, so the log is trimmed in chunks of a tenth of the limit
 * rather than copied on every append. It holds between `limit` and `limit × 1.1` entries.
 */
export function appendFrameLog(log: FrameLogEntry[], entry: FrameLogEntry, limit: number = FRAME_LOG_LIMIT): void {
  log.push(entry);
  if (log.length > limit + Math.floor(limit / 10)) log.splice(0, log.length - limit);
}

export interface LockEpisode {
  /** When the UNKNOWN lock that opened the episode happened. */
  readonly unknownMs: number;
  /** t_seen: when the first frame that was not UNKNOWN reached the worklet. */
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
   * Episodes with a scanner reset between their UNKNOWN lock and their result lock. The votes were
   * dropped part-way (for example *Add* on the Unknown card, then a save), so the lock did not come
   * from one uninterrupted look at the product. Left out.
   */
  readonly interrupted: number;
  /**
   * Episodes with no non-UNKNOWN frame between their UNKNOWN lock and their result lock, or whose
   * t_seen falls after t_lock. A result lock needs 4 such votes, so either means the frame clock and
   * the lock clock disagree. Left out, and reported so the offset is seen rather than hidden.
   */
  readonly inconsistent: number;
}

/**
 * Only the first result lock after an UNKNOWN lock closes an episode. Chips settling into an ACCEPT
 * is still one product in the reticle. Losing quorum ('none') neither opens nor closes an episode.
 * A second UNKNOWN lock before any result reopens it: the product left before it locked.
 *
 * Frames belong to an episode by when they *arrived*, since that is the order the lock log saw them
 * in. t_seen is when that frame was *captured*, so the first frame's worklet time is counted.
 */
export function lockEpisodes(frames: readonly FrameLogEntry[], locks: readonly LockEvent[]): EpisodeReport {
  const episodes: LockEpisode[] = [];
  let truncated = 0;
  let interrupted = 0;
  let inconsistent = 0;
  const oldestArrivedMs = frames[0]?.arrivedAtMs ?? Infinity;
  let openedMs: number | null = null;

  for (const event of locks) {
    if (event.kind === 'unknown') {
      openedMs = event.atMs;
      continue;
    }
    if (event.kind === 'none' || openedMs === null) continue;

    const unknownMs = openedMs;
    openedMs = null;
    if (unknownMs < oldestArrivedMs) {
      truncated++;
      continue;
    }

    let seen: FrameLogEntry | undefined;
    let wasReset = false;
    for (const f of frames) {
      if (f.arrivedAtMs <= unknownMs) continue;
      if (f.arrivedAtMs > event.atMs) break;
      if (f.kind === 'reset') {
        wasReset = true;
        break;
      }
      if (f.kind !== 'unknown') {
        seen = f;
        break;
      }
    }
    if (wasReset) {
      interrupted++;
      continue;
    }
    if (seen === undefined || seen.capturedAtMs > event.atMs) {
      inconsistent++;
      continue;
    }
    episodes.push({
      unknownMs,
      seenMs: seen.capturedAtMs,
      lockMs: event.atMs,
      lockKind: event.kind,
      productIds: event.productIds,
      proxyMs: event.atMs - seen.capturedAtMs,
    });
  }
  return { episodes, truncated, interrupted, inconsistent };
}

/**
 * `Date.now()` is whole milliseconds on each side, so one frame's arithmetic can be off by up to
 * 2 ms without any clock disagreeing.
 */
export const CLOCK_TOLERANCE_MS = 2;

export interface ClockCheck {
  /**
   * arrived − captured − worklet, per frame: the hop from the camera thread to the JS thread and the
   * wait there. It can only be negative if the two clocks disagree.
   */
  readonly transit: Summary | null;
  readonly transitMinMs: number | null;
  /** Frames whose transit is below −CLOCK_TOLERANCE_MS: the JS thread saw them before the worklet finished them. */
  readonly impossible: number;
}

/** PHASE_2_PLAN P2-8: check the worklet's clock against the JS thread's before subtracting one from the other. */
export function clockCheck(frames: readonly FrameLogEntry[]): ClockCheck {
  const transits = frames.filter((f) => f.kind !== 'reset').map((f) => f.arrivedAtMs - f.capturedAtMs - f.workletMs);
  return {
    transit: summarize(transits),
    transitMinMs: transits.length === 0 ? null : Math.min(...transits),
    impossible: transits.filter((ms) => ms < -CLOCK_TOLERANCE_MS).length,
  };
}

/**
 * Informational, not NFR-04: in confirm mode, how long from an ACCEPT lock to the *Yes* that lets the
 * helper quote. A Yes counts when the latest lock before it is an ACCEPT of the same product, which is
 * the card it was tapped on.
 */
export function confirmDelays(locks: readonly LockEvent[], interactions: readonly Interaction[]): number[] {
  const delays: number[] = [];
  let i = 0;
  let latest: LockEvent | undefined;
  let answered = false;
  for (const tap of interactions) {
    if (tap.kind !== 'confirmYes') continue;
    while (i < locks.length && locks[i]!.atMs <= tap.atMs) {
      latest = locks[i++];
      answered = false;
    }
    if (latest?.kind === 'accept' && !answered && latest.productIds[0] === tap.productIds[0]) {
      delays.push(tap.atMs - latest.atMs);
      answered = true;
    }
  }
  return delays;
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
