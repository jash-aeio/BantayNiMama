// Pure vector maths for the Phase 0 spike. No I/O, no native modules — so the
// same code runs unchanged in `scripts/analyze.mjs` on the laptop and on device.

export interface Shot {
  /** Ground-truth product label typed at enrollment. */
  label: string;
  vector: number[];
}

export interface Candidate {
  label: string;
  score: number;
}

/**
 * Cosine similarity. Both inputs are assumed L2-normalized at write time (TR-22),
 * which reduces cosine to a plain dot product.
 */
export function dot(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

export function l2Normalize(v: readonly number[]): number[] {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += (v[i] ?? 0) * (v[i] ?? 0);
  const norm = Math.sqrt(sum);
  if (norm === 0) return v.slice();
  return v.map((x) => x / norm);
}

/**
 * TR-31: a product's score is its BEST shot similarity, not its mean.
 * Averaging punishes products enrolled from varied angles, which is exactly
 * the enrollment behaviour SR-20 asks for.
 */
export function rankProducts(query: readonly number[], shots: readonly Shot[]): Candidate[] {
  const best = new Map<string, number>();
  for (const shot of shots) {
    const score = dot(query, shot.vector);
    const prev = best.get(shot.label);
    if (prev === undefined || score > prev) best.set(shot.label, score);
  }
  return [...best.entries()]
    .map(([label, score]) => ({ label, score }))
    .sort((a, b) => b.score - a.score);
}

export type Decision =
  | { kind: 'accept'; label: string; score: number; margin: number }
  | { kind: 'disambiguate'; first: Candidate; second: Candidate }
  | { kind: 'unknown'; best: Candidate | null };

/**
 * TR-32/33/34. Kept pure so Phase 0's offline analysis can replay it over the
 * recorded frame set at many (τ, δ) pairs without a camera.
 */
export function decide(ranked: readonly Candidate[], tau: number, delta: number): Decision {
  const first = ranked[0];
  if (first === undefined) return { kind: 'unknown', best: null };
  if (first.score < tau) return { kind: 'unknown', best: first };

  const second = ranked[1];
  const margin = first.score - (second?.score ?? 0);
  if (second !== undefined && margin < delta) {
    return { kind: 'disambiguate', first, second };
  }
  return { kind: 'accept', label: first.label, score: first.score, margin };
}
