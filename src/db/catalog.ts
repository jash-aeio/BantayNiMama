import type { DB } from '@op-engineering/op-sqlite';

import type { AppMeta } from '../domain/appMeta.ts';
import type { VectorIndex } from '../domain/knn.ts';
import { unreferencedPhotos } from '../domain/referencePhoto.ts';
import { MODEL_ID } from '../ml/model';
import { readAppMeta } from './meta';
import { migrate } from './migrate';
import { openDatabase } from './open';
import { deleteReferencePhoto, listReferencePhotos } from './photos';
import { loadVectorIndex, referencedPhotoPaths } from './shots';

export interface Catalog {
  /** Open for the life of the app. */
  readonly db: DB;
  readonly meta: AppMeta;
  /** As loaded at launch. Enrollment extends a copy of it held by the app (SR-24). */
  readonly index: VectorIndex;
  readonly migratedFrom: number;
  /** Shots stamped with another model_id, left out of the index until re-embedded (TR-23, TR-24). */
  readonly otherModelShots: number;
  readonly orphanPhotosRemoved: number;
}

/**
 * Opens bantay.db once, at launch: migrate (TR-44), read app_meta (TR-35), remove orphan photos,
 * then build the search index from the shot BLOBs (ADR-014).
 *
 * Refuses a database whose model_id is not the bundled model. Every stored vector would then be
 * compared with frames from a different model and score meaninglessly (TR-23), so failing loudly
 * beats quoting prices from it.
 */
export function openCatalog(): Catalog {
  const db = openDatabase();
  try {
    const { from } = migrate(db);
    const meta = readAppMeta(db);
    if (meta.modelId !== MODEL_ID) {
      throw new Error(
        `bantay.db was enrolled with ${meta.modelId}, but this app runs ${MODEL_ID}; its shots must be re-embedded (TR-23, TR-24)`,
      );
    }
    // Before the index and before the camera exists: no enrollment draft can have photos on disk yet.
    const orphanPhotosRemoved = removeOrphanPhotos(db);
    const { index, otherModelShots } = loadVectorIndex(db, meta);
    return { db, meta, index, migratedFrom: from, otherModelShots, orphanPhotosRemoved };
  } catch (e) {
    db.close();
    throw e;
  }
}

/**
 * Deletes photos that no shot row references — left by a kill between saving an enrollment's
 * JPEGs and committing it (TR-45).
 *
 * Only safe while no enrollment draft exists, since a draft's photos have no row yet. That is why
 * this runs inside openCatalog and nowhere else. If the query throws, nothing is deleted.
 */
function removeOrphanPhotos(db: DB): number {
  const referenced = referencedPhotoPaths(db);
  const orphans = unreferencedPhotos(
    listReferencePhotos().map((photo) => photo.relativePath),
    referenced,
  );
  for (const path of orphans) deleteReferencePhoto(path);
  return orphans.length;
}
