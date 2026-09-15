import { useCallback, useMemo, useRef, useState, type RefObject } from 'react';
import type { TensorflowModel } from 'react-native-fast-tflite';

import type { Catalog } from '../../db/catalog';
import { getProduct } from '../../db/products';
import { likelyDuplicates, MAX_SHOTS, type NewProduct } from '../../domain/enrollment.ts';
import type { InteractionKind } from '../../domain/interactionLog.ts';
import { appendToIndex, nearestShots, type VectorIndex } from '../../domain/knn.ts';
import type { ReferenceCapture } from '../../ml/frameEmbedder';
import { captureShot, commitEnrollment, discardShots, type DraftShot } from './draft';

export type EnrollmentError =
  | { readonly key: 'modelNotReady' }
  | { readonly key: 'captureFailed'; readonly message: string };

export type SaveResult = { readonly ok: true; readonly productId: string } | { readonly ok: false; readonly message: string };

/** One captured shot's measurements, kept for the dev readout (ARCHITECTURE.md §4, NFR-08, SR-22). */
export interface ShotMeasurement {
  readonly agreement: number;
  readonly bytes: number;
  /** SR-22 inputs, recorded so Phase 3 can replace the placeholder limits with measured ones. */
  readonly luminance: number;
  readonly sharpness: number;
  readonly warned: boolean;
}

export interface EnrollmentState {
  readonly shots: readonly DraftShot[];
  readonly capturing: boolean;
  readonly error: EnrollmentError | null;
  /** SR-23: catalog products the draft's shots already clear τ against, best first. */
  readonly duplicates: readonly { readonly id: string; readonly name: string }[];
  /** Every shot captured this session, including ones later removed or discarded. */
  readonly measurements: readonly ShotMeasurement[];
  /** Goes up by one per committed product. Lets readouts refresh their counts. */
  readonly savedCount: number;
  requestCapture(): void;
  /** Called with the capture the camera worklet produced for requestCapture. */
  receiveCapture(capture: ReferenceCapture): void;
  removeShot(id: string): void;
  discard(): void;
  /** `markAmbiguous`: existing look-alikes flagged repacked in the same transaction (P2-5, repackedPlan). */
  save(product: NewProduct, markAmbiguous?: readonly string[]): SaveResult;
  /** SR-25's split: logs the first keystroke of each product, once. Call from every form field. */
  noteTyping(): void;
}

interface Options {
  readonly catalog: Catalog;
  /** The live search index. The scanner reads it on every frame, and save() extends it (SR-24). */
  readonly indexRef: RefObject<VectorIndex>;
  /** The CPU-only model instance for JPEGs, or undefined while it loads. */
  readonly stillModel: TensorflowModel | undefined;
  /** Asks the camera worklet to cut a reference crop from its next processed frame. */
  readonly requestFrameCapture: () => void;
  /** The interaction log. Photos, the first keystroke and the save go there, and SR-25 is timed from them. */
  readonly log: (kind: InteractionKind, productIds: readonly string[]) => void;
}

/**
 * The enrollment draft: 3–5 shots already on disk, waiting for one transaction.
 *
 * Draft shots live in a ref as well as in state. Captures arrive asynchronously, and checking the
 * count against React state, which may be a render behind, could let a sixth shot in (TR-42).
 */
export function useEnrollment({ catalog, indexRef, stillModel, requestFrameCapture, log }: Options): EnrollmentState {
  const [shots, setShotsState] = useState<readonly DraftShot[]>([]);
  const shotsRef = useRef<readonly DraftShot[]>([]);
  const [capturing, setCapturing] = useState(false);
  const capturingRef = useRef(false);
  const [error, setError] = useState<EnrollmentError | null>(null);
  const [measurements, setMeasurements] = useState<readonly ShotMeasurement[]>([]);
  const [savedCount, setSavedCount] = useState(0);
  /** Whether this product's first keystroke is already logged. Reset by a save. */
  const typedRef = useRef(false);

  const setShots = useCallback((next: readonly DraftShot[]) => {
    shotsRef.current = next;
    setShotsState(next);
  }, []);

  const setCapturingBoth = useCallback((value: boolean) => {
    capturingRef.current = value;
    setCapturing(value);
  }, []);

  const requestCapture = useCallback(() => {
    if (stillModel === undefined) {
      setError({ key: 'modelNotReady' });
      return;
    }
    if (capturingRef.current || shotsRef.current.length >= MAX_SHOTS) return;
    setError(null);
    setCapturingBoth(true);
    requestFrameCapture();
  }, [stillModel, requestFrameCapture, setCapturingBoth]);

  const receiveCapture = useCallback(
    (capture: ReferenceCapture) => {
      if (stillModel === undefined) {
        setError({ key: 'modelNotReady' });
        setCapturingBoth(false);
        return;
      }
      captureShot(capture, stillModel).then(
        (shot) => {
          if (shotsRef.current.length >= MAX_SHOTS) {
            discardShots([shot]);
          } else {
            setShots([...shotsRef.current, shot]);
            // Logged when the photo is on disk and embedded, which is when she can take the next one.
            log('enrollPhoto', []);
            setMeasurements((previous) => [
              ...previous,
              {
                agreement: shot.frameAgreement,
                bytes: shot.bytes,
                luminance: shot.quality.luminance,
                sharpness: shot.quality.sharpness,
                warned: shot.warnings.length > 0,
              },
            ]);
          }
          setCapturingBoth(false);
        },
        (e: unknown) => {
          setError({ key: 'captureFailed', message: messageOf(e) });
          setCapturingBoth(false);
        },
      );
    },
    [stillModel, setShots, setCapturingBoth, log],
  );

  const removeShot = useCallback(
    (id: string) => {
      const shot = shotsRef.current.find((s) => s.id === id);
      if (shot === undefined) return;
      discardShots([shot]);
      setShots(shotsRef.current.filter((s) => s.id !== id));
    },
    [setShots],
  );

  const discard = useCallback(() => {
    discardShots(shotsRef.current);
    setShots([]);
    setError(null);
  }, [setShots]);

  const save = useCallback(
    (product: NewProduct, markAmbiguous: readonly string[] = []): SaveResult => {
      let committed: ReturnType<typeof commitEnrollment>;
      try {
        committed = commitEnrollment(catalog.db, catalog.meta, product, shotsRef.current, markAmbiguous);
      } catch (e) {
        // commitEnrollment already deleted the photos, so the draft is gone as well.
        setShots([]);
        return { ok: false, message: messageOf(e) };
      }
      // Only now, after COMMIT, can the shots become searchable (ARCHITECTURE.md §5, invariant 6).
      // The scanner reads indexRef on its next frame, with no reload (SR-24).
      indexRef.current = appendToIndex(indexRef.current, committed.indexed);
      log('enrollSaved', [committed.productId]);
      typedRef.current = false;
      setShots([]);
      setSavedCount((n) => n + 1);
      return { ok: true, productId: committed.productId };
    },
    [catalog, indexRef, setShots, log],
  );

  const noteTyping = useCallback(() => {
    if (typedRef.current) return;
    typedRef.current = true;
    log('enrollTyping', []);
  }, [log]);

  // SR-23. Recomputed whenever a shot is added or removed; the catalog is searched once per shot.
  // The index holds no trashed product and flags negatives, so a negative is skipped rather than
  // named by its id: it has no product row, and offering to mark it repacked would mean nothing.
  const duplicates = useMemo(() => {
    if (shots.length === 0) return [];
    const index = indexRef.current;
    const hitsPerShot = shots.map((shot) => nearestShots(index, shot.vector));
    return likelyDuplicates(hitsPerShot, catalog.meta.thresholds).flatMap((p) => {
      const product = index.negativeIds.has(p.productId) ? null : getProduct(catalog.db, p.productId);
      return product === null ? [] : [{ id: product.id, name: product.name }];
    });
  }, [shots, catalog, indexRef]);

  return {
    shots,
    capturing,
    error,
    duplicates,
    measurements,
    savedCount,
    requestCapture,
    receiveCapture,
    removeShot,
    discard,
    save,
    noteTyping,
  };
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
