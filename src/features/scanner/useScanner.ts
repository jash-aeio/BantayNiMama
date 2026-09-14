import { useCallback, useRef, useState, type RefObject } from 'react';

import type { Catalog } from '../../db/catalog';
import { getProduct, type Product } from '../../db/products';
import { nearestShots, type VectorIndex } from '../../domain/knn.ts';
import { appendLockEvent, frameVote, lockEvent, type FrameVote, type LockEvent } from '../../domain/lockLog.ts';
import { match, rankProducts, type Decision, type ProductScore } from '../../domain/match.ts';
import { decisionKey, emptyBuffer, lockedDecision, pushDecision, STABILITY_WINDOW } from '../../domain/stability.ts';

/** How many recent frames the JS-side timing samples cover. */
export const SCAN_TIMING_WINDOW = 200;

/** One processed frame's JS-thread cost (ARCHITECTURE.md §8). */
export interface ScanTiming {
  /** nearestShots over the in-memory matrix (TR-30, ADR-014). */
  readonly knnMs: number;
  /** match() + pushDecision + lockedDecision (TR-31–TR-36). */
  readonly policyMs: number;
  /** Index size when the frame was searched: KNN cost grows with it. */
  readonly shots: number;
}

export interface ScannerState {
  /**
   * What the overlay shows: the stability-locked decision, or null while no result has quorum.
   * Changes only when the lock changes, never at frame rate (SR-12).
   */
  readonly locked: Decision | null;
  /** Hot path: one call per processed frame, with the worklet's unit vector and its sharpness. */
  onVector(vector: Float32Array, sharpness?: number | null): void;
  /** Forgets every vote and timing sample, so a new scan never mixes in an older scene or index size. */
  reset(): void;
  /** Recent timings, held in a ref so recording them never renders. */
  readonly timings: RefObject<readonly ScanTiming[]>;
  /** The latest frame's top 3 products — for the dev readout only, never the overlay. */
  readonly lastTop: RefObject<readonly ProductScore[]>;
  /** A product row, cached. Products do not change in Phase 1 (no edit, no delete). */
  productOf(id: string): Product | null;
}

/**
 * The scanner's JS-thread half: KNN → τ/δ policy → 4-of-5 stability (ADR-016) → the decision to render
 * (ARCHITECTURE.md §3, stages 6–10).
 *
 * The overlay mirrors lockedDecision exactly. When quorum is lost it clears to "scanning" rather
 * than holding the last lock. Holding it would keep a confident price on screen while the camera
 * looks at something else, and NFR-02 outranks a moment of flicker.
 */
export function useScanner({
  catalog,
  indexRef,
  timingsRef,
  lockLogRef,
}: {
  catalog: Catalog;
  indexRef: RefObject<VectorIndex>;
  /** Where to keep timing samples, so another screen (the gate check) can read them. */
  timingsRef?: RefObject<readonly ScanTiming[]>;
  /** Every lock change is appended here, with its voting frames (PHASE_1_PLAN §4 step 5). reset() never clears it. */
  lockLogRef?: RefObject<readonly LockEvent[]>;
}): ScannerState {
  const [locked, setLocked] = useState<Decision | null>(null);
  const lockedKey = useRef<string | null>(null);
  const buffer = useRef(emptyBuffer);
  const ownTimings = useRef<readonly ScanTiming[]>([]);
  const timings = timingsRef ?? ownTimings;
  const lastTop = useRef<readonly ProductScore[]>([]);
  // The frames currently in the stability window, for diagnosing a lock (lockLog.ts).
  const votes = useRef<readonly FrameVote[]>([]);
  const products = useRef(new Map<string, Product | null>());

  const onVector = useCallback(
    (vector: Float32Array, sharpness: number | null = null) => {
      const index = indexRef.current;
      const t0 = performance.now();
      const hits = nearestShots(index, vector);
      const t1 = performance.now();
      const decision = match(hits, catalog.meta.thresholds);
      buffer.current = pushDecision(buffer.current, decision);
      const next = lockedDecision(buffer.current);
      const t2 = performance.now();

      timings.current = [
        ...timings.current.slice(-(SCAN_TIMING_WINDOW - 1)),
        { knnMs: t1 - t0, policyMs: t2 - t1, shots: index.size },
      ];
      // Outside the timed span: these exist only for diagnostics.
      lastTop.current = rankProducts(hits).slice(0, 3);
      votes.current = [...votes.current.slice(-(STABILITY_WINDOW - 1)), frameVote(decision, sharpness)];

      // lockedDecision returns a new object every frame, but its meaning only changes with its key.
      // Comparing keys keeps React out of the 4 fps loop.
      const key = next === null ? null : decisionKey(next);
      if (key !== lockedKey.current) {
        lockedKey.current = key;
        setLocked(next);
        if (lockLogRef !== undefined) {
          lockLogRef.current = appendLockEvent(lockLogRef.current, lockEvent(next, Date.now(), votes.current));
        }
      }
    },
    [catalog, indexRef, lockLogRef],
  );

  const reset = useCallback(() => {
    buffer.current = emptyBuffer;
    timings.current = [];
    lastTop.current = [];
    votes.current = [];
    lockedKey.current = null;
    setLocked(null);
  }, []);

  const productOf = useCallback(
    (id: string) => {
      if (!products.current.has(id)) products.current.set(id, getProduct(catalog.db, id));
      return products.current.get(id) ?? null;
    },
    [catalog],
  );

  return { locked, onVector, reset, timings, lastTop, productOf };
}
