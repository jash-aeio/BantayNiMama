import { Directory, File, Paths } from 'expo-file-system';
import { Images, type RawPixelData } from 'react-native-nitro-image';

import { isRelativePhotoPath } from '../domain/photoPath.ts';
import { PHOTOS_DIR, REFERENCE_JPEG_QUALITY, referencePhotoPath } from '../domain/referencePhoto.ts';

// The reference photo store: documentDirectory/photos/, next to bantay.db (TR-46). The database
// stores only relative paths (TR-43). The absolute path is worked out at the moment a file is
// read or written, because iOS moves the app container on every update.

export interface StoredPhoto {
  /** Relative to the document directory, e.g. "photos/<shot id>.jpg". */
  readonly relativePath: string;
  readonly bytes: number;
}

/** The current absolute filesystem path (no file:// prefix) for a stored relative path. Never store it. */
export function resolvePhotoPath(relativePath: string): string {
  if (!isRelativePhotoPath(relativePath)) {
    throw new Error(`Photo path must be relative to the document directory, got "${relativePath}" (TR-43)`);
  }
  return decodeURIComponent(new File(Paths.document, relativePath).uri.replace(/^file:\/\//, ''));
}

/**
 * Saves a square reticle crop as the shot's reference JPEG (TR-42: quality 80, already sized by
 * referenceSide) and returns its relative path and size.
 *
 * Throws if the file is missing or empty afterwards. A shot row pointing at no photo could never
 * be re-embedded after a model swap (TR-24).
 */
export async function saveReferencePhoto(shotId: string, crop: RawPixelData): Promise<StoredPhoto> {
  if (crop.width !== crop.height) {
    throw new Error(`Reference photo must be the square reticle crop, got ${crop.width}×${crop.height}`);
  }
  const dir = new Directory(Paths.document, PHOTOS_DIR);
  if (!dir.exists) dir.create({ intermediates: true });

  const relativePath = referencePhotoPath(shotId);
  const image = Images.loadFromRawPixelData(crop);
  try {
    await image.saveToFileAsync(resolvePhotoPath(relativePath), 'jpg', REFERENCE_JPEG_QUALITY);
  } finally {
    image.dispose();
  }

  const bytes = new File(Paths.document, relativePath).size;
  if (bytes === null || bytes <= 0) throw new Error(`Saved photo ${relativePath} is missing or empty`);
  return { relativePath, bytes };
}

export function listReferencePhotos(): StoredPhoto[] {
  const dir = new Directory(Paths.document, PHOTOS_DIR);
  if (!dir.exists) return [];
  return dir
    .list()
    .filter((entry): entry is File => entry instanceof File && entry.name.endsWith('.jpg'))
    .map((file) => ({ relativePath: `${PHOTOS_DIR}/${file.name}`, bytes: file.size ?? 0 }));
}

export function deleteReferencePhoto(relativePath: string): void {
  if (!isRelativePhotoPath(relativePath)) throw new Error(`Refusing to delete a non-relative path: "${relativePath}"`);
  const file = new File(Paths.document, relativePath);
  if (file.exists) file.delete();
}
