import { useCallback, useRef, useState, type RefObject } from 'react';
import type { TensorflowModel } from 'react-native-fast-tflite';

import type { IndexRebuildReason } from '../../app/services';
import type { Catalog } from '../../db/catalog';
import { insertNegativeShot } from '../../db/negatives';
import { deleteReferencePhoto } from '../../db/photos';
import { insertCorrectionShot } from '../../db/shots';
import type { NegativeSource } from '../../domain/correction.ts';
import type { InteractionKind } from '../../domain/interactionLog.ts';
import { appendToIndex, type VectorIndex } from '../../domain/knn.ts';
import type { ProductScore } from '../../domain/match.ts';
import { IDLE, rejectionReducer, type Fix, type Pinned, type Rejection, type RejectionEvent } from '../../domain/rejection.ts';
import type { FrameDecision } from '../../domain/scanDisplay.ts';
import type { ReferenceCapture } from '../../ml/frameEmbedder';
import { captureShot, discardShots } from '../enrollment/draft';

// The reject sheet — SR-07, SR-14; P2-3, P2-4. The stages and the capture guard live in
// domain/rejection.ts; this hook only performs what the reducer's new stage allows. The write path is
// enrollment's (TR-45): JPEG first, then the row, then the index.

const REJECT_LOG_KINDS = {
  confirm_no: 'confirmNo',
  wrong_lock: 'wrong',
  wrong_chip: 'wrongChip',
} as const satisfies Record<NegativeSource, InteractionKind>;

const FIX_LOG_KINDS = {
  notInList: { start: 'notInListStart', saved: 'notInListSaved', mismatch: 'notInListMismatch', failed: 'notInListFailed' },
  correct: { start: 'correctStart', saved: 'correctSaved', mismatch: 'correctMismatch', failed: 'correctFailed' },
} as const satisfies Record<Fix['kind'], Record<'start' | 'saved' | 'mismatch' | 'failed', InteractionKind>>;

/** A correction logs the picked product first, then what the card had said, so the log reads "right ← wrong". */
function loggedIds(pinned: Pinned, fix: Fix): readonly string[] {
  return fix.kind === 'correct' ? [fix.productId, ...pinned.productIds] : pinned.productIds;
}

export interface RejectionState {
  readonly state: Rejection;
  /** No, Wrong? or Neither. Pins what the card showed; the Scan tab stops voting while this is open. */
  reject(locked: FrameDecision, source: NegativeSource): void;
  /** SR-14: asks the camera worklet for its next frame, and saves it as a negative if it still shows the rejected lock. */
  notInList(): void;
  /** SR-07: the same, saved as a correction shot on `productId`. */
  correct(productId: string): void;
  /** After a mismatch or a failure: capture again for the same choice. */
  retry(): void;
  /** Called with the capture the worklet produced. */
  receiveCapture(capture: ReferenceCapture): void;
  close(): void;
}

interface Options {
  readonly catalog: Catalog;
  /** The live search index. A saved shot joins it only after its INSERT. */
  readonly indexRef: RefObject<VectorIndex>;
  /** The scanner's latest top 3, read at tap time for the likely products (useScanner.lastTop). */
  readonly lastTop: RefObject<readonly ProductScore[]>;
  /** The CPU-only model instance for JPEGs, or undefined while it loads. */
  readonly stillModel: TensorflowModel | undefined;
  readonly requestFrameCapture: () => void;
  /** The scanner's own frame path, without voting (useScanner.classify). */
  readonly classify: (vector: Float32Array) => FrameDecision;
  readonly rebuildIndex: (reason: IndexRebuildReason) => unknown;
  readonly onCatalogChanged: () => void;
  readonly log: (kind: InteractionKind, productIds: readonly string[]) => void;
}

export function useRejection({
  catalog,
  indexRef,
  lastTop,
  stillModel,
  requestFrameCapture,
  classify,
  rebuildIndex,
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
      // Voting pauses once this opens, so lastTop stays the frame the tindera tapped on.
      const next = dispatch({ type: 'reject', locked, source, top: lastTop.current, negativeIds: indexRef.current.negativeIds });
      if (next.stage === 'asking') log(REJECT_LOG_KINDS[source], next.pinned.productIds);
    },
    [dispatch, indexRef, lastTop, log],
  );

  /** Every path into `capturing` ends here: log the start, then ask the worklet for a frame. */
  const startCapture = useCallback(
    (event: RejectionEvent) => {
      const next = dispatch(event);
      if (next.stage !== 'capturing') return;
      log(FIX_LOG_KINDS[next.fix.kind].start, loggedIds(next.pinned, next.fix));
      requestFrameCapture();
    },
    [dispatch, log, requestFrameCapture],
  );

  const notInList = useCallback(() => startCapture({ type: 'notInList' }), [startCapture]);
  const correct = useCallback((productId: string) => startCapture({ type: 'correct', productId }), [startCapture]);
  const retry = useCallback(() => startCapture({ type: 'retry' }), [startCapture]);

  const receiveCapture = useCallback(
    (capture: ReferenceCapture) => {
      const next = dispatch({ type: 'captured', decision: classify(capture.embedding.vector) });
      if (next.stage === 'mismatch') {
        log(FIX_LOG_KINDS[next.fix.kind].mismatch, loggedIds(next.pinned, next.fix));
        return;
      }
      if (next.stage !== 'saving') return;
      const { pinned, fix } = next;
      const kinds = FIX_LOG_KINDS[fix.kind];

      const fail = (e: unknown) => {
        log(kinds.failed, loggedIds(pinned, fix));
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

        let written: ReturnType<typeof insertCorrectionShot> | { indexed: ReturnType<typeof insertNegativeShot>; replaced: [] };
        try {
          written =
            fix.kind === 'correct'
              ? // Throws, writing nothing, if the picked product was deleted meanwhile (TR-45).
                insertCorrectionShot(catalog.db, fix.productId, shot, catalog.meta)
              : { indexed: insertNegativeShot(catalog.db, shot, pinned.source, catalog.meta), replaced: [] };
        } catch (e) {
          discardShots([shot]);
          fail(e);
          return;
        }

        // After COMMIT. A replaced correction's JPEG goes now; if this is interrupted, the launch sweep
        // removes it, since no row points at it any more (invariant 7).
        for (const { photoPath } of written.replaced) {
          try {
            deleteReferencePhoto(photoPath);
          } catch {
            // Left for the orphan sweep.
          }
        }
        onCatalogChanged();
        try {
          // Only after the INSERT, as at enrollment (ARCHITECTURE.md §5, invariant 6). A replaced
          // correction's vector is still in the index, so that case reads the index again (E-4)
          // rather than appending next to it.
          if (written.replaced.length > 0) rebuildIndex('correction');
          else indexRef.current = appendToIndex(indexRef.current, [written.indexed]);
        } catch (e) {
          // The row is saved, and the next launch rebuilds the index with it. Say so rather than
          // pretend it is already in use.
          fail(e);
          return;
        }
        log(kinds.saved, loggedIds(pinned, fix));
        dispatch({ type: 'saved' });
      })();
    },
    [catalog, classify, dispatch, indexRef, log, onCatalogChanged, rebuildIndex, stillModel],
  );

  const close = useCallback(() => {
    const before = stateRef.current;
    const next = dispatch({ type: 'close' });
    if (before.stage !== 'idle' && before.stage !== 'saved' && next.stage === 'idle') log('rejectClosed', before.pinned.productIds);
  }, [dispatch, log]);

  return { state, reject, notInList, correct, retry, receiveCapture, close };
}
