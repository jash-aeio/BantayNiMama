// The Phase 1 gate's deterministic checks — PHASE_1_PLAN.md §4, steps 3 and 4. Pure: the app
// gathers counts, file existence and KNN hits, and this decides what passes.

import type { ShotHit } from './knn.ts';
import { summarize, type Summary } from './stats.ts';

export interface CatalogIdentity {
  readonly schemaVersion: number;
  readonly modelId: string;
  readonly embeddingDim: number;
}

export interface PersistenceInput {
  /** Live products and every shot row (catalogCounts). */
  readonly counts: { readonly products: number; readonly shots: number };
  /** Shots in the in-memory search index. */
  readonly indexSize: number;
  /** Shots stamped with another model_id, which the index leaves out (TR-23). */
  readonly otherModelShots: number;
  /** What app_meta says. */
  readonly meta: CatalogIdentity;
  /** What this build expects. */
  readonly expected: CatalogIdentity;
  /** photo_path values whose file is missing under the document directory (TR-43). */
  readonly missingPhotos: readonly string[];
}

export type PersistenceProblem =
  | { readonly kind: 'emptyCatalog' }
  | { readonly kind: 'schemaVersion' | 'embeddingDim'; readonly found: number; readonly expected: number }
  | { readonly kind: 'modelId'; readonly found: string; readonly expected: string }
  | { readonly kind: 'indexMismatch'; readonly indexSize: number; readonly otherModelShots: number; readonly shots: number }
  | { readonly kind: 'missingPhotos'; readonly paths: readonly string[] };

/**
 * §4 step 3. An empty list means the catalog survived the force-quit intact.
 *
 * - **Index check:** every shot row must be either in the index or counted as another model's.
 *   Phase 1 has no soft delete, so a shot that is neither was lost between SQLite and search.
 *   Once SR-32 exists, soft-deleted shots join that sum.
 * - **Product count:** not checked here, because only the operator knows how many products were
 *   enrolled. The readout shows the count for them to compare.
 */
export function persistenceProblems(input: PersistenceInput): PersistenceProblem[] {
  const problems: PersistenceProblem[] = [];
  if (input.counts.products === 0 || input.counts.shots === 0) problems.push({ kind: 'emptyCatalog' });
  if (input.meta.schemaVersion !== input.expected.schemaVersion) {
    problems.push({ kind: 'schemaVersion', found: input.meta.schemaVersion, expected: input.expected.schemaVersion });
  }
  if (input.meta.modelId !== input.expected.modelId) {
    problems.push({ kind: 'modelId', found: input.meta.modelId, expected: input.expected.modelId });
  }
  if (input.meta.embeddingDim !== input.expected.embeddingDim) {
    problems.push({ kind: 'embeddingDim', found: input.meta.embeddingDim, expected: input.expected.embeddingDim });
  }
  if (input.indexSize + input.otherModelShots !== input.counts.shots) {
    problems.push({
      kind: 'indexMismatch',
      indexSize: input.indexSize,
      otherModelShots: input.otherModelShots,
      shots: input.counts.shots,
    });
  }
  if (input.missingPhotos.length > 0) problems.push({ kind: 'missingPhotos', paths: input.missingPhotos });
  return problems;
}

/** One stored shot: its photo re-embedded, then searched against the index. */
export interface SelfMatchInput {
  readonly shotId: string;
  /** KNN hits for the re-embedded JPEG, best first. */
  readonly hits: readonly ShotHit[];
}

export interface SelfMatchFailure {
  readonly shotId: string;
  readonly nearestShotId: string | null;
  readonly nearestScore: number | null;
}

export interface SelfMatchReport {
  readonly shots: number;
  readonly passed: boolean;
  /** Shots whose nearest neighbour was not their own stored vector. */
  readonly failures: readonly SelfMatchFailure[];
  /** Similarity between each photo and its own stored vector; 1 means an exact re-embed (TR-24). */
  readonly ownScore: Summary | null;
  readonly ownScoreMin: number | null;
  /** Best similarity to any other shot, i.e. how close the nearest other vector came. */
  readonly nearestOther: Summary | null;
}

/**
 * §4 step 4. Each re-embedded photo's nearest neighbour must be its own stored vector.
 *
 * This proves the stored vectors, the stored photos and the re-embed path agree, with no camera
 * variance involved. A shot whose own vector is missing from its hits fails, and so does an empty
 * catalog: a check over zero shots proves nothing.
 */
export function selfMatchReport(inputs: readonly SelfMatchInput[]): SelfMatchReport {
  const failures: SelfMatchFailure[] = [];
  const ownScores: number[] = [];
  const otherScores: number[] = [];

  for (const { shotId, hits } of inputs) {
    const nearest = hits[0];
    if (nearest?.shotId !== shotId) {
      failures.push({ shotId, nearestShotId: nearest?.shotId ?? null, nearestScore: nearest?.similarity ?? null });
    }
    const own = hits.find((h) => h.shotId === shotId);
    if (own !== undefined) ownScores.push(own.similarity);
    const other = hits.find((h) => h.shotId !== shotId);
    if (other !== undefined) otherScores.push(other.similarity);
  }

  return {
    shots: inputs.length,
    passed: inputs.length > 0 && failures.length === 0,
    failures,
    ownScore: summarize(ownScores),
    ownScoreMin: ownScores.length > 0 ? Math.min(...ownScores) : null,
    nearestOther: summarize(otherScores),
  };
}
