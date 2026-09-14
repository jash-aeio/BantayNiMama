import { useCallback, useRef, useState, type RefObject } from 'react';
import type { TensorflowModel } from 'react-native-fast-tflite';

import type { Catalog } from '../../db/catalog';
import { insertNegativeShot } from '../../db/negatives';
import type { NegativeSource } from '../../domain/correction.ts';
import type { InteractionKind } from '../../domain/interactionLog.ts';
import { appendToIndex, type IndexedShot, type VectorIndex } from '../../domain/knn.ts';
import { IDLE, rejectionReducer, type Rejection, type RejectionEvent } from '../../domain/rejection.ts';
import type { FrameDecision } from '../../domain/scanDisplay.ts';
import type { ReferenceCapture } from '../../ml/frameEmbedder';
import { captureShot, discardShots } from '../enrollment/draft';

// "Not in my list" — SR-14, P2-3. The stages and the capture guard live in domain/rejection.ts; this
// hook only performs what the reducer's new stage allows. The write path is enrollment's
// (TR-45): JPEG first, then the row, then the index.

const REJECT_LOG_KINDS = {
  confirm_no: 'confirmNo',
  wrong_lock: 'wrong',
  wrong_chip: 'neither',
} as const satisfies Record<NegativeSource, InteractionKind>;

export interface RejectionState {
  readonly state: Rejection;
  /** No, Wrong? or Neither. Pins what the card showed; the Scan tab stops voting while this is open. */
  reject(locked: FrameDecision, source: NegativeSource): void;
  /** Asks the camera worklet for its next frame, and saves it only if it still shows the rejected lock. */
  notInList(): void;
  /** Called with the capture the worklet produced for notInList. */
  receiveCapture(capture: ReferenceCapture): void;
  close(): void;
}

interface Options {
  readonly catalog: Catalog;
  /** The live search index. A saved negative is appended only after its INSERT. */
  readonly indexRef: RefObject<VectorIndex>;
  /** The CPU-only model instance for JPEGs, or undefined while it loads. */
  readonly stillModel: TensorflowModel | undefined;
  readonly requestFrameCapture: () => void;
  /** The scanner's own frame path, without voting (useScanner.classify). */
  readonly classify: (vector: Float32Array) => FrameDecision;
  readonly onCatalogChanged: () => void;
  readonly log: (kind: InteractionKind, productIds: readonly string[]) => void;
}

export function useRejection({
  catalog,
  indexRef,
  stillModel,
  requestFrameCapture,
  classify,
  onCatalogChanged,
  log,
}: Options): RejectionState {
  const [state, setState] = useState<Rejection>(IDLE);
  // Captures arrive asynchronously; the reducer must see the latest stage, not a render-old one.
  const stateRef = useRef<Rejection>(IDLE);

  const dispatch = useCallback((event: RejectionEvent) => {
    const next = rejectionReducer(stateRef.current, event);
    stateRef.current = next;
    setState(next);
    return next;
  }, []);

  const reject = useCallback(
    (locked: FrameDecision, source: NegativeSource) => {
      const next = dispatch({ type: 'reject', locked, source });
      if (next.stage === 'asking') log(REJECT_LOG_KINDS[source], next.pinned.productIds);
    },
    [dispatch, log],
  );

  const notInList = useCallback(() => {
    const next = dispatch({ type: 'notInList' });
    if (next.stage !== 'capturing') return;
    log('notInListStart', next.pinned.productIds);
    requestFrameCapture();
  }, [dispatch, log, requestFrameCapture]);

  const receiveCapture = useCallback(
    (capture: ReferenceCapture) => {
      const next = dispatch({ type: 'captured', decision: classify(capture.embedding.vector) });
      if (next.stage === 'mismatch') {
        log('notInListMismatch', next.pinned.productIds);
        return;
      }
      if (next.stage !== 'saving') return;
      const { pinned } = next;

      const fail = (e: unknown) => {
        log('notInListFailed', pinned.productIds);
        dispatch({ type: 'saveFailed', message: e instanceof Error ? e.message : String(e) });
      };
      const model = stillModel;
      if (model === undefined) {
        fail(new Error('the still-image model is still loading'));
        return;
      }

      void (async () => {
        let shot: Awaited<ReturnType<typeof captureShot>>;
        try {
          // Saves the JPEG and embeds it: the stored vector is the JPEG's, so a model swap can
          // re-embed it (TR-24).
          shot = await captureShot(capture, model);
        } catch (e) {
          fail(e);
          return;
        }
        let indexed: IndexedShot;
        try {
          indexed = insertNegativeShot(catalog.db, shot, pinned.source, catalog.meta);
        } catch (e) {
          discardShots([shot]);
          fail(e);
          return;
        }
        try {
          // Only after the INSERT, as at enrollment (ARCHITECTURE.md §5, invariant 6).
          indexRef.current = appendToIndex(indexRef.current, [indexed]);
        } catch (e) {
          // The row is saved, and the next launch rebuilds the index with it. Say so rather than
          // pretend it is already silencing the item.
          fail(e);
          return;
        }
        onCatalogChanged();
        log('notInListSaved', pinned.productIds);
        dispatch({ type: 'saved' });
      })();
    },
    [catalog, classify, dispatch, indexRef, log, onCatalogChanged, stillModel],
  );

  const close = useCallback(() => {
    const before = stateRef.current;
    const next = dispatch({ type: 'close' });
    if (before.stage !== 'idle' && before.stage !== 'saved' && next.stage === 'idle') log('rejectClosed', before.pinned.productIds);
  }, [dispatch, log]);

  return { state, reject, notInList, receiveCapture, close };
}
