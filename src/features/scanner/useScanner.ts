import { useCallback, useMemo, useRef, useState, type RefObject } from 'react';

import type { Catalog } from '../../db/catalog';
import { ambiguousProductIds, firstEnrollPhotoPath, getProduct, type Product } from '../../db/products';
import { nearestShots, type VectorIndex } from '../../domain/knn.ts';
import { appendLockEvent, frameVote, lockEvent, type FrameVote, type LockEvent } from '../../domain/lockLog.ts';
import { match, rankProducts, type ProductScore } from '../../domain/match.ts';
import { resolveFrame, type FrameDecision } from '../../domain/scanDisplay.ts';
import {
  decisionKey,
  emptyBuffer,
  lockedDecision,
  pushDecision,
  STABILITY_WINDOW,
  type StabilityBuffer,
} from '../../domain/stability.ts';

/** How many recent frames the JS-side timing samples cover. */
export const SCAN_TIMING_WINDOW = 200;

/** One processed frame's JS-thread cost (ARCHITECTURE.md §8). */
export interface ScanTiming {
  /** nearestShots over the in-memory matrix (TR-30, ADR-014). */
  readonly knnMs: number;
  /** match() + resolveFrame + pushDecision + lockedDecision (TR-31–TR-36, TR-39). */
  readonly policyMs: number;
  /** Index size when the frame was searched: KNN cost grows with it. */
  readonly shots: number;
}

export interface ScannerState {
  /**
   * The stability-locked decision after resolveFrame, or null while no result has quorum. Changes only
   * when the lock changes, never at frame rate (SR-12). No id in it is a negative (TR-39).
   */
  readonly locked: FrameDecision | null;
  /** Hot path: one call per processed frame, with the worklet's unit vector and its sharpness. */
  onVector(vector: Float32Array, sharpness?: number | null): void;
  /**
   * One frame through the same KNN → policy → resolveFrame path, without voting. The capture guard
   * judges the capture frame with it (P2-3).
   */
  classify(vector: Float32Array): FrameDecision;
  /** Forgets every vote and timing sample, so a new scan never mixes in an older scene or index size. */
  reset(): void;
  /** Recent timings, held in a ref so recording them never renders. */
  readonly timings: RefObject<readonly ScanTiming[]>;
  /** The latest frame's top 3, negatives included — for the dev readout only, never the card. */
  readonly lastTop: RefObject<readonly ProductScore[]>;
  /** A product row, cached. A negative id finds no row, so it can never be named. */
  productOf(id: string): Product | null;
  /** The product's first enrollment photo (relative, TR-43), cached. For the confirm card (SR-13). */
  photoOf(id: string): string | null;
}

/**
 * The scanner's JS-thread half: KNN → τ/δ policy → resolveFrame → 4-of-5 stability (ADR-016) → the
 * decision to render (ARCHITECTURE.md §3, stages 6–10; §6, display step).
 *
 * The overlay mirrors lockedDecision exactly. When quorum is lost it clears to "scanning" rather
 * than holding the last lock. Holding it would keep a price on screen while the camera looks at
 * something else, and NFR-02 outranks a moment of flicker.
 */
export function useScanner({
  catalog,
  catalogVersion,
  indexRef,
  timingsRef,
  lockLogRef,
}: {
  catalog: Catalog;
  /** Goes up whenever products change, so the repacked set and the product and photo caches are re-read. */
  catalogVersion: number;
  indexRef: RefObject<VectorIndex>;
  /** Where to keep timing samples, so another screen (the gate check) can read them. */
  timingsRef?: RefObject<readonly ScanTiming[]>;
  /** Every lock change is appended here, with its voting frames (PHASE_1_PLAN §4 step 5). reset() never clears it. */
  lockLogRef?: RefObject<readonly LockEvent[]>;
}): ScannerState {
  const [locked, setLocked] = useState<FrameDecision | null>(null);
  const lockedKey = useRef<string | null>(null);
  const buffer = useRef<StabilityBuffer<FrameDecision>>(emptyBuffer);
  const ownTimings = useRef<readonly ScanTiming[]>([]);
  const timings = timingsRef ?? ownTimings;
  const lastTop = useRef<readonly ProductScore[]>([]);
  // The frames currently in the stability window, for diagnosing a lock (lockLog.ts).
  const votes = useRef<readonly FrameVote[]>([]);
  // Product rows change under the scanner since P2-4: a price edit, a delete, a restore. Each write
  // bumps catalogVersion, and a new version starts both caches empty, so a card never shows an old
  // price or names a product that is now in the trash.
  const products = useMemo(() => new Map<string, Product | null>(), [catalog, catalogVersion]);
  const photos = useMemo(() => new Map<string, string | null>(), [catalog, catalogVersion]);

  // Read in the render, not in an effect, so no frame is ever resolved against a stale set. Held in a
  // ref so onVector keeps its identity: the camera worklet captures it, and a new function would
  // rebuild the frame output.
  const ambiguous = useMemo(() => new Set(ambiguousProductIds(catalog.db)), [catalog, catalogVersion]);
  const ambiguousIds = useRef<ReadonlySet<string>>(ambiguous);
  ambiguousIds.current = ambiguous;

  const onVector = useCallback(
    (vector: Float32Array, sharpness: number | null = null) => {
      const index = indexRef.current;
      const t0 = performance.now();
      const hits = nearestShots(index, vector);
      const t1 = performance.now();
      const decision = match(hits, catalog.meta.thresholds);
      // Negatives come from the index itself, so they always match the rows just searched.
      const frame = resolveFrame(decision, { negativeIds: index.negativeIds, ambiguousIds: ambiguousIds.current });
      buffer.current = pushDecision(buffer.current, frame);
      const next = lockedDecision(buffer.current);
      const t2 = performance.now();

      timings.current = [
        ...timings.current.slice(-(SCAN_TIMING_WINDOW - 1)),
        { knnMs: t1 - t0, policyMs: t2 - t1, shots: index.size },
      ];
      // Outside the timed span: these exist only for diagnostics. Votes keep the raw decision, so the
      // log still shows what a negative silenced.
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

  const classify = useCallback(
    (vector: Float32Array) => {
      const index = indexRef.current;
      return resolveFrame(match(nearestShots(index, vector), catalog.meta.thresholds), {
        negativeIds: index.negativeIds,
        ambiguousIds: ambiguousIds.current,
      });
    },
    [catalog, indexRef],
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
      if (!products.has(id)) products.set(id, getProduct(catalog.db, id));
      return products.get(id) ?? null;
    },
    [catalog, products],
  );

  const photoOf = useCallback(
    (id: string) => {
      if (!photos.has(id)) photos.set(id, firstEnrollPhotoPath(catalog.db, id));
      return photos.get(id) ?? null;
    },
    [catalog, photos],
  );

  return { locked, onVector, classify, reset, timings, lastTop, productOf, photoOf };
}
