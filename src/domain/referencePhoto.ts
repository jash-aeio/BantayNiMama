// Reference photos — TR-42, TR-43. Pure.

import { isRelativePhotoPath } from './photoPath.ts';

/** TR-42: longest edge of a stored reference photo. */
export const REFERENCE_MAX_SIDE = 512;
/** TR-42: JPEG quality of a stored reference photo. */
export const REFERENCE_JPEG_QUALITY = 80;
/** The one photos directory next to bantay.db (TR-46). */
export const PHOTOS_DIR = 'photos';

/**
 * Where a shot's photo lives, relative to the document directory (TR-43): one file per shot id.
 * The id must be safe as a file name, so it can never smuggle a path separator into the store.
 */
export function referencePhotoPath(shotId: string): string {
  const path = `${PHOTOS_DIR}/${shotId}.jpg`;
  if (!/^[A-Za-z0-9-]+$/.test(shotId) || !isRelativePhotoPath(path)) {
    throw new Error(`Not a usable shot id for a photo file name: "${shotId}"`);
  }
  return path;
}

/**
 * Photos in the store that no shot row points at, so they are safe to delete.
 *
 * Enrollment writes JPEGs before its transaction (TR-45), so a kill in between leaves photos with
 * no row. Anything outside photos/, or not a relative path, is never returned: this function only
 * ever names files the store itself created.
 *
 * `referenced` must come from a query that succeeded. An empty set because the query failed would
 * make every photo look like an orphan, and deleting a referenced JPEG loses the only way to
 * re-embed that shot (TR-24).
 */
export function unreferencedPhotos(onDisk: readonly string[], referenced: ReadonlySet<string>): string[] {
  return onDisk.filter(
    (path) => isRelativePhotoPath(path) && path.startsWith(`${PHOTOS_DIR}/`) && !referenced.has(path),
  );
}

/**
 * The side length to store a square reticle crop at: TR-42's 512 px cap, but never larger than
 * the crop itself. Upscaling a smaller crop adds bytes against NFR-08 and no detail.
 */
export function referenceSide(cropSide: number): number {
  'worklet';
  if (!Number.isInteger(cropSide) || cropSide < 1) {
    throw new RangeError(`Crop side must be a positive whole number of pixels, got ${cropSide}`);
  }
  return Math.min(cropSide, REFERENCE_MAX_SIDE);
}
