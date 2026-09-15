import { useCallback, useRef, useState, type RefObject } from 'react';
import type { TensorflowModel } from 'react-native-fast-tflite';

import type { IndexRebuildReason } from '../../app/services';
import type { Catalog } from '../../db/catalog';
import { deleteReferencePhoto } from '../../db/photos';
import { getProduct, shotCounts, type Product, type ShotCounts } from '../../db/products';
import { insertTeachShot } from '../../db/shots';
import type { InteractionKind } from '../../domain/interactionLog.ts';
import { appendToIndex, type VectorIndex } from '../../domain/knn.ts';
import type { ReferenceCapture } from '../../ml/frameEmbedder';
import { captureShot, discardShots, type DraftShot } from '../enrollment/draft';

// *Teach again* — SR-33, P2-7, ADR-024. Adds a photo to an existing product, from the Scan tab's
// camera. The write path is enrollment's (TR-45): JPEG, embed, then one transaction, then the index.
//
// **Nothing is saved until the tindera sees the photo and keeps it.** A correction has the capture
// guard, which checks the frame still shows the product she named. Here there is no lock to compare
// with, so she is the guard: a taught photo of the wrong item attaches that item's look to this
// product's price, which is NFR-02's failure.

export type TeachStage = 'ready' | 'capturing' | 'review' | 'saving';

export type TeachNotice = { readonly kind: 'saved' } | { readonly kind: 'failed'; readonly message: string } | null;

export interface TeachState {
  /** The product being taught while the panel is open, else null. */
  readonly productId: string | null;
  /** Its row, read at start; null if it was deleted meanwhile. */
  readonly product: Product | null;
  readonly counts: ShotCounts;
  readonly stage: TeachStage;
  /** The captured photo awaiting Keep or Retake: on disk, with no row yet. */
  readonly preview: DraftShot | null;
  readonly notice: TeachNotice;
  start(productId: string): void;
  capture(): void;
  /** Called with the capture the camera worklet produced for capture(). */
  receiveCapture(capture: ReferenceCapture): void;
  keep(): void;
  retake(): void;
  close(): void;
}

interface Options {
  readonly catalog: Catalog;
  readonly indexRef: RefObject<VectorIndex>;
  /** The CPU-only model instance for JPEGs, or undefined while it loads. */
  readonly stillModel: TensorflowModel | undefined;
  readonly requestFrameCapture: () => void;
  readonly rebuildIndex: (reason: IndexRebuildReason) => unknown;
  readonly onCatalogChanged: () => void;
  readonly log: (kind: InteractionKind, productIds: readonly string[]) => void;
}

const NO_COUNTS: ShotCounts = { enroll: 0, correction: 0, teach: 0 };

export function useTeach({ catalog, indexRef, stillModel, requestFrameCapture, rebuildIndex, onCatalogChanged, log }: Options): TeachState {
  const [productId, setProductId] = useState<string | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [counts, setCounts] = useState<ShotCounts>(NO_COUNTS);
  const [stage, setStageState] = useState<TeachStage>('ready');
  const [preview, setPreviewState] = useState<DraftShot | null>(null);
  const [notice, setNotice] = useState<TeachNotice>(null);

  // Captures and saves finish asynchronously; each reads the latest values, not a render-old copy.
  const productRef = useRef<Product | null>(null);
  const stageRef = useRef<TeachStage>('ready');
  const previewRef = useRef<DraftShot | null>(null);
  // Goes up on start and close. A capture that returns into a different session is thrown away.
  const session = useRef(0);
  const captureSession = useRef(-1);

  const setStage = useCallback((next: TeachStage) => {
    stageRef.current = next;
    setStageState(next);
  }, []);
  const setPreview = useCallback((next: DraftShot | null) => {
    previewRef.current = next;
    setPreviewState(next);
  }, []);

  const discardPreview = useCallback(() => {
    if (previewRef.current === null) return;
    discardShots([previewRef.current]);
    setPreview(null);
  }, [setPreview]);

  const start = useCallback(
    (id: string) => {
      discardPreview();
      session.current += 1;
      const found = getProduct(catalog.db, id);
      productRef.current = found;
      setProductId(id);
      setProduct(found);
      setCounts(found === null ? NO_COUNTS : shotCounts(catalog.db, id));
      setNotice(null);
      setStage('ready');
      log('teachStart', [id]);
    },
    [catalog, discardPreview, log, setStage],
  );

  const capture = useCallback(() => {
    const current = productRef.current;
    if (current === null || stageRef.current !== 'ready') return;
    if (stillModel === undefined) {
      setNotice({ kind: 'failed', message: 'the still-image model is still loading' });
      return;
    }
    setNotice(null);
    captureSession.current = session.current;
    setStage('capturing');
    requestFrameCapture();
  }, [stillModel, requestFrameCapture, setStage]);

  const receiveCapture = useCallback(
    (frame: ReferenceCapture) => {
      if (stageRef.current !== 'capturing' || captureSession.current !== session.current) return;
      const model = stillModel;
      if (model === undefined) {
        setStage('ready');
        setNotice({ kind: 'failed', message: 'the still-image model is still loading' });
        return;
      }
      const expected = session.current;
      captureShot(frame, model).then(
        (shot) => {
          // Closed or restarted while the JPEG was being written: it will never get a row.
          if (session.current !== expected || stageRef.current !== 'capturing') {
            discardShots([shot]);
            return;
          }
          setPreview(shot);
          setStage('review');
        },
        (e: unknown) => {
          if (session.current !== expected) return;
          setStage('ready');
          setNotice({ kind: 'failed', message: messageOf(e) });
        },
      );
    },
    [stillModel, setPreview, setStage],
  );

  const keep = useCallback(() => {
    const shot = previewRef.current;
    const current = productRef.current;
    if (shot === null || current === null || stageRef.current !== 'review') return;
    setStage('saving');

    let written: ReturnType<typeof insertTeachShot>;
    try {
      // Throws, writing nothing, if the product was deleted meanwhile (TR-45).
      written = insertTeachShot(catalog.db, current.id, shot, catalog.meta);
    } catch (e) {
      discardShots([shot]);
      setPreview(null);
      setStage('ready');
      setNotice({ kind: 'failed', message: messageOf(e) });
      log('teachFailed', [current.id]);
      return;
    }
    setPreview(null);

    // After COMMIT. A replaced extra's JPEG goes now; if this is interrupted, the launch sweep removes
    // it, since no row points at it any more (invariant 7).
    for (const { photoPath } of written.replaced) {
      try {
        deleteReferencePhoto(photoPath);
      } catch {
        // Left for the orphan sweep.
      }
    }
    onCatalogChanged();
    setCounts(shotCounts(catalog.db, current.id));
    try {
      // A replaced extra's vector is still in the index, so that case reads it again (E-4).
      if (written.replaced.length > 0) rebuildIndex('teach');
      else indexRef.current = appendToIndex(indexRef.current, [written.indexed]);
    } catch (e) {
      // The row is saved, and the next launch builds the index with it. Say so.
      setStage('ready');
      setNotice({ kind: 'failed', message: messageOf(e) });
      log('teachFailed', [current.id]);
      return;
    }
    setStage('ready');
    setNotice({ kind: 'saved' });
    log('teachSaved', [current.id]);
  }, [catalog, indexRef, log, onCatalogChanged, rebuildIndex, setPreview, setStage]);

  const retake = useCallback(() => {
    if (stageRef.current !== 'review') return;
    discardPreview();
    setStage('ready');
    if (productRef.current !== null) log('teachRetake', [productRef.current.id]);
  }, [discardPreview, log, setStage]);

  const close = useCallback(() => {
    discardPreview();
    session.current += 1;
    if (productId !== null) log('teachClosed', [productId]);
    productRef.current = null;
    setProductId(null);
    setProduct(null);
    setCounts(NO_COUNTS);
    setNotice(null);
    setStage('ready');
  }, [discardPreview, log, productId, setStage]);

  return { productId, product, counts, stage, preview, notice, start, capture, receiveCapture, keep, retake, close };
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
