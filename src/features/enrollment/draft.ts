import type { DB } from '@op-engineering/op-sqlite';
import type { TensorflowModel } from 'react-native-fast-tflite';

import { newId } from '../../db/ids';
import { deleteReferencePhoto, resolvePhotoPath, saveReferencePhoto } from '../../db/photos';
import { insertProductWithShots } from '../../db/products';
import type { AppMeta } from '../../domain/appMeta.ts';
import type { NewProduct } from '../../domain/enrollment.ts';
import type { IndexedShot } from '../../domain/knn.ts';
import { qualityWarnings, type QualityWarning, type ShotQuality } from '../../domain/shotQuality.ts';
import { dot } from '../../domain/vector.ts';
import type { ReferenceCapture } from '../../ml/frameEmbedder';
import { embedAndMeasureImageFile } from '../../ml/stillEmbedder';

// The enrollment write path — TR-45. Files first, rows last:
//   capture → JPEG on disk → (repeat 3–5×) → one transaction → search index.
// An orphan photo only wastes storage, and the launch sweep removes it. An orphan vector would
// produce confident matches against a product that does not exist. So the rows are written last,
// and all at once.

export interface DraftShot {
  readonly id: string;
  /** photos/<id>.jpg, relative to the document directory (TR-43). */
  readonly photoPath: string;
  /** Embedded from the saved JPEG — this is the vector that gets stored. */
  readonly vector: Float32Array;
  readonly bytes: number;
  /** dot(live-frame vector, JPEG vector) for the same crop — measurement only (ARCHITECTURE.md §4). */
  readonly frameAgreement: number;
  /** SR-22: exposure and sharpness of the saved JPEG, and the warnings they raise (placeholder limits). */
  readonly quality: ShotQuality;
  readonly warnings: readonly QualityWarning[];
}

/**
 * Saves one capture as a reference JPEG, embeds it and measures its quality.
 *
 * The stored vector comes from the JPEG, not the live frame. That way enrollment produces exactly
 * what re-embedding after a model swap would produce (TR-24), and the P1-8 gate tests the input
 * production actually uses (ARCHITECTURE.md §4). Enrollment is exempt from TR-25, so embedding
 * here on the JS thread is allowed. `stillModel` must be the second, CPU-only instance: the camera
 * worklet is running the other one.
 */
export async function captureShot(capture: ReferenceCapture, stillModel: TensorflowModel): Promise<DraftShot> {
  const id = newId();
  const { relativePath, bytes } = await saveReferencePhoto(id, capture.crop);
  try {
    const { vector, quality } = embedAndMeasureImageFile(resolvePhotoPath(relativePath), stillModel);
    return {
      id,
      photoPath: relativePath,
      vector,
      bytes,
      frameAgreement: dot(capture.embedding.vector, vector),
      quality,
      warnings: qualityWarnings(quality),
    };
  } catch (e) {
    deleteReferencePhoto(relativePath);
    throw e;
  }
}

/** Deletes draft photos that will never get a row. Best effort: the launch sweep catches any left over. */
export function discardShots(shots: readonly DraftShot[]): void {
  for (const shot of shots) {
    try {
      deleteReferencePhoto(shot.photoPath);
    } catch {
      // Left for removeOrphanPhotos at the next launch.
    }
  }
}

/**
 * Writes product + shots + vectors in one transaction (TR-45). If that throws, the draft's photos
 * are deleted too, so a failed enrollment leaves nothing behind. Returns the shots to add to the
 * search index. The caller adds them only after this returns, which is after COMMIT.
 * `markAmbiguous` flags existing look-alikes as repacked inside that same transaction (P2-5).
 */
export function commitEnrollment(
  db: DB,
  meta: Pick<AppMeta, 'modelId' | 'embeddingDim'>,
  product: NewProduct,
  shots: readonly DraftShot[],
  markAmbiguous: readonly string[] = [],
): { productId: string; indexed: IndexedShot[] } {
  try {
    const written = insertProductWithShots(
      db,
      product,
      shots.map(({ id, photoPath, vector }) => ({ id, photoPath, vector })),
      meta,
      Date.now(),
      markAmbiguous,
    );
    return { productId: written.productId, indexed: written.shots };
  } catch (e) {
    discardShots(shots);
    throw e;
  }
}
