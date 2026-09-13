// Brute-force nearest-neighbour search over shot vectors — TR-30, ADR-014. Pure.
//
// Deliberately one inline loop over a single contiguous Float32Array. On the Infinix X6823,
// calling dot() per shot (a subarray each time) measured 3.5× slower than this loop —
// 831 ms against 234 ms at 2,500 shots — because Hermes has no JIT to optimise the calls away.

import type { ShotMatch } from './match.ts';

/** TR-30: how many shots the policy sees. Safe while a product has ≤ 6 shots (golden replay). */
export const KNN_LIMIT = 10;

export interface IndexedShot {
  readonly shotId: string;
  readonly productId: string;
  readonly vector: ArrayLike<number>;
}

/**
 * A derived search index, rebuilt from SQLite — never the source of truth
 * (ARCHITECTURE.md §5, invariant 6). Row i of the matrix belongs to shotIds[i].
 */
export interface VectorIndex {
  readonly dim: number;
  readonly size: number;
  /** size × dim Float32 values, one row per shot. */
  readonly matrix: Float32Array;
  readonly shotIds: readonly string[];
  readonly productIds: readonly string[];
}

export interface ShotHit extends ShotMatch {
  readonly shotId: string;
}

export function buildIndex(dim: number, shots: readonly IndexedShot[]): VectorIndex {
  if (!Number.isInteger(dim) || dim < 1) {
    throw new RangeError(`Index dimension must be a positive integer, got ${dim}`);
  }
  const matrix = new Float32Array(shots.length * dim);
  shots.forEach((shot, row) => {
    assertDim(shot, dim);
    matrix.set(shot.vector, row * dim);
  });
  return {
    dim,
    size: shots.length,
    matrix,
    shotIds: shots.map((s) => s.shotId),
    productIds: shots.map((s) => s.productId),
  };
}

/**
 * A new index with `shots` added — for after an enrollment commits (TR-45). Copies the matrix,
 * which is ~12.8 MB at 500 products (computed, not measured); acceptable because enrollment is
 * rare and per-frame search never copies.
 */
export function appendToIndex(index: VectorIndex, shots: readonly IndexedShot[]): VectorIndex {
  const matrix = new Float32Array((index.size + shots.length) * index.dim);
  matrix.set(index.matrix);
  shots.forEach((shot, i) => {
    assertDim(shot, index.dim);
    matrix.set(shot.vector, (index.size + i) * index.dim);
  });
  return {
    dim: index.dim,
    size: index.size + shots.length,
    matrix,
    shotIds: [...index.shotIds, ...shots.map((s) => s.shotId)],
    productIds: [...index.productIds, ...shots.map((s) => s.productId)],
  };
}

/**
 * The k most similar shots, best first.
 *
 * The top k live in a small sorted buffer rather than sorting every score, so the work beyond
 * the dot products grows with size × k, not size × log(size). Equal scores keep index order.
 * Non-finite similarities never enter the result (NFR-02: a NaN must not rank).
 */
export function nearestShots(index: VectorIndex, query: ArrayLike<number>, k: number = KNN_LIMIT): ShotHit[] {
  if (query.length !== index.dim) {
    throw new RangeError(`Query has ${query.length} dimensions, index expects ${index.dim}`);
  }
  if (!Number.isInteger(k) || k < 1) throw new RangeError(`k must be a positive integer, got ${k}`);

  const { dim, size, matrix } = index;
  const topScores: number[] = [];
  const topRows: number[] = [];

  for (let row = 0; row < size; row++) {
    const base = row * dim;
    let similarity = 0;
    for (let d = 0; d < dim; d++) similarity += matrix[base + d]! * query[d]!;

    if (!Number.isFinite(similarity)) continue;
    if (topScores.length === k && !(similarity > topScores[k - 1]!)) continue;

    let at = topScores.length;
    while (at > 0 && topScores[at - 1]! < similarity) at--;
    topScores.splice(at, 0, similarity);
    topRows.splice(at, 0, row);
    if (topScores.length > k) {
      topScores.pop();
      topRows.pop();
    }
  }

  return topRows.map((row, i) => ({
    shotId: index.shotIds[row]!,
    productId: index.productIds[row]!,
    similarity: topScores[i]!,
  }));
}

function assertDim(shot: IndexedShot, dim: number): void {
  if (shot.vector.length !== dim) {
    // A vector of the wrong size came from a different model (TR-23) and must never be searched.
    throw new RangeError(`Shot ${shot.shotId} has ${shot.vector.length} dimensions, index expects ${dim}`);
  }
}
