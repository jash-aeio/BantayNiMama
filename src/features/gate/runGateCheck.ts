import type { TensorflowModel } from 'react-native-fast-tflite';

import type { Catalog } from '../../db/catalog';
import { readAppMeta } from '../../db/meta';
import { photoExists, resolvePhotoPath } from '../../db/photos';
import { catalogCounts } from '../../db/products';
import { LATEST_SCHEMA_VERSION } from '../../db/schema';
import { listShotRows } from '../../db/shots';
import type { AppMeta } from '../../domain/appMeta.ts';
import {
  persistenceProblems,
  selfMatchReport,
  type PersistenceProblem,
  type SelfMatchInput,
  type SelfMatchReport,
} from '../../domain/gateCheck.ts';
import { nearestShots, type VectorIndex } from '../../domain/knn.ts';
import { MODEL_ID } from '../../ml/model';
import { embedImageFile } from '../../ml/stillEmbedder';

// Gathers what the Phase 1 gate's deterministic checks need (PHASE_1_PLAN.md §4, steps 3 and 4) and
// hands it to the pure rules in src/domain/gateCheck.ts.

export interface GateCheckResult {
  readonly counts: { readonly products: number; readonly shots: number };
  /** Re-read from bantay.db for this check, not the copy cached at launch. */
  readonly meta: AppMeta;
  readonly indexSize: number;
  readonly otherModelShots: number;
  readonly photoRows: number;
  readonly missingPhotos: readonly string[];
  readonly problems: readonly PersistenceProblem[];
  readonly selfMatch: SelfMatchReport;
  readonly durationMs: number;
}

interface Options {
  readonly catalog: Catalog;
  /** The live index: after a relaunch, exactly what was rebuilt from SQLite. */
  readonly index: VectorIndex;
  /** The CPU still-image instance. The camera worklet must not be using it. */
  readonly stillModel: TensorflowModel;
  /** The loaded model's own output size (TR-20). */
  readonly embeddingDim: number;
  readonly onProgress: (done: number, total: number) => void;
}

/**
 * Re-embeds every searchable shot's JPEG and asks the index for its nearest neighbours.
 *
 * Embedding runs on the JS thread, so it yields to the UI between photos and progress stays visible
 * instead of the app freezing. Measured on the Infinix (P1-7): 20 photos in 2.4 s, about 120 ms
 * each, so the gate's ~100 shots should take roughly 12 s.
 */
export async function runGateCheck({ catalog, index, stillModel, embeddingDim, onProgress }: Options): Promise<GateCheckResult> {
  const t0 = performance.now();
  const { db } = catalog;
  const counts = catalogCounts(db);
  const meta = readAppMeta(db);
  const rows = listShotRows(db);

  const missingPhotos = rows.filter((row) => !photoExists(row.photoPath)).map((row) => row.photoPath);
  const missing = new Set(missingPhotos);
  const otherModelShots = rows.filter((row) => row.modelId !== meta.modelId).length;

  const problems = persistenceProblems({
    counts,
    indexSize: index.size,
    otherModelShots,
    meta,
    expected: { schemaVersion: LATEST_SCHEMA_VERSION, modelId: MODEL_ID, embeddingDim },
    missingPhotos,
  });

  const searchable = new Set(index.shotIds);
  const toCheck = rows.filter((row) => searchable.has(row.id) && !missing.has(row.photoPath));
  const inputs: SelfMatchInput[] = [];
  for (let i = 0; i < toCheck.length; i++) {
    onProgress(i, toCheck.length);
    await yieldToUi();
    const row = toCheck[i]!;
    const vector = embedImageFile(resolvePhotoPath(row.photoPath), stillModel);
    inputs.push({ shotId: row.id, hits: nearestShots(index, vector) });
  }
  onProgress(toCheck.length, toCheck.length);

  return {
    counts,
    meta,
    indexSize: index.size,
    otherModelShots,
    photoRows: rows.length,
    missingPhotos,
    problems,
    selfMatch: selfMatchReport(inputs),
    durationMs: performance.now() - t0,
  };
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
