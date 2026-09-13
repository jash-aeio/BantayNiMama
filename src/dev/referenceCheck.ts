import { File, Paths } from 'expo-file-system';
import type { TensorflowModel } from 'react-native-fast-tflite';

import { newId } from '../db/ids';
import { deleteReferencePhoto, listReferencePhotos, resolvePhotoPath, saveReferencePhoto } from '../db/photos';
import { summarize } from '../domain/stats.ts';
import { dot } from '../domain/vector.ts';
import type { ReferenceCapture } from '../ml/frameEmbedder';
import { embedImageFile } from '../ml/stillEmbedder';

// P1-4 device check (docs/PHASE_1_PLAN.md). TEMPORARY: replaced by real enrollment in P1-5.
//
// Measures the two unknowns the plan names:
//   - Frame-vs-JPEG agreement. Phase 0 calibrated τ/δ on live-frame vectors, but production
//     enrolls from a saved JPEG (an extra resize plus JPEG encoding). The dot product of the two
//     vectors for the same crop says how far apart those inputs are.
//   - Bytes per shot, against NFR-08's 200 KB per 5-shot product.
// A sidecar file keeps each JPEG's vector, so a relaunch can prove the photos survived and that
// re-embedding them gives the same vector (TR-24).

const SIDECAR = new File(Paths.document, 'p1-4-reference-check.json');

interface Entry {
  relativePath: string;
  bytes: number;
  agreement: number;
  jpegVector: number[];
}

export interface CaptureResult {
  readonly relativePath: string;
  readonly bytes: number;
  /** dot(live-frame vector, vector of the saved JPEG of the same crop). 1 means identical. */
  readonly agreement: number;
  readonly side: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
}

/** `stillModel` must be its own model instance: the camera worklet is using the other one. */
export async function measureCapture(capture: ReferenceCapture, stillModel: TensorflowModel): Promise<CaptureResult> {
  const { relativePath, bytes } = await saveReferencePhoto(newId(), capture.crop);
  const jpegVector = embedImageFile(resolvePhotoPath(relativePath), stillModel);
  const agreement = dot(capture.embedding.vector, jpegVector);
  writeEntries([...readEntries(), { relativePath, bytes, agreement, jpegVector: Array.from(jpegVector) }]);
  return {
    relativePath,
    bytes,
    agreement,
    side: capture.crop.width,
    frameWidth: capture.frameWidth,
    frameHeight: capture.frameHeight,
  };
}

export function describeCaptures(results: readonly CaptureResult[]): string {
  const agreement = summarize(results.map((r) => r.agreement));
  const bytes = summarize(results.map((r) => r.bytes));
  const last = results[results.length - 1];
  if (agreement === null || bytes === null || last === undefined) return 'P1-4: no captures yet this session';
  const min = Math.min(...results.map((r) => r.agreement));
  return (
    `P1-4 n=${agreement.n}: frame-vs-JPEG dot min ${min.toFixed(4)} · median ${agreement.median.toFixed(4)} · ` +
    `JPEG median ${(bytes.median / 1024).toFixed(1)} KB, max ${(bytes.max / 1024).toFixed(1)} KB · ` +
    `${last.side} px crop of a ${last.frameWidth}×${last.frameHeight} frame`
  );
}

/** Run at launch: are the photos still on disk, and does re-embedding them reproduce the saved vectors? */
export function verifyStoredPhotos(stillModel: TensorflowModel): string {
  const photos = listReferencePhotos();
  if (photos.length === 0) return 'P1-4 store: no reference photos on disk';
  const onDisk = new Set(photos.map((p) => p.relativePath));
  const redone = readEntries()
    .filter((e) => onDisk.has(e.relativePath))
    .map((e) => dot(Float32Array.from(e.jpegVector), embedImageFile(resolvePhotoPath(e.relativePath), stillModel)));
  const totalKb = photos.reduce((sum, p) => sum + p.bytes, 0) / 1024;
  const min = redone.length > 0 ? Math.min(...redone).toFixed(6) : '—';
  return `P1-4 store: ${photos.length} photos on disk, ${totalKb.toFixed(1)} KB · re-embedded ${redone.length}, min dot vs saved vector ${min}`;
}

/** Deletes every photo this check created, and the sidecar. Returns how many photos were removed. */
export function clearReferenceCheck(): number {
  const photos = listReferencePhotos();
  for (const photo of photos) deleteReferencePhoto(photo.relativePath);
  if (SIDECAR.exists) SIDECAR.delete();
  return photos.length;
}

function readEntries(): Entry[] {
  if (!SIDECAR.exists) return [];
  try {
    return (JSON.parse(SIDECAR.textSync()) as { entries: Entry[] }).entries;
  } catch {
    return [];
  }
}

function writeEntries(entries: Entry[]): void {
  if (!SIDECAR.exists) SIDECAR.create({ intermediates: true });
  SIDECAR.write(JSON.stringify({ entries }));
}
