// Pure vector maths. No I/O, no native modules (CLAUDE.md) — shared by matching,
// enrollment and the golden replay.

/** Any numeric array-like, so a Float32Array from the worklet needs no copy. */
export type Vector = ArrayLike<number>;

/**
 * Cosine similarity of two L2-normalized vectors, which is a plain dot product (TR-22).
 *
 * Throws on a length mismatch instead of truncating: comparing a vector against one from a
 * different model (TR-23) must fail loudly, never produce a quiet, meaningless score.
 */
export function dot(a: Vector, b: Vector): number {
  if (a.length !== b.length) {
    throw new RangeError(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

/**
 * Scale to unit length (TR-22).
 *
 * Throws on a zero or non-finite norm. That only comes from broken inference, and a NaN
 * vector would otherwise score "no match" against everything without anyone noticing.
 */
export function l2Normalize(v: Vector): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) sumSq += v[i]! * v[i]!;
  const norm = Math.sqrt(sumSq);
  if (!Number.isFinite(norm) || norm === 0) {
    throw new RangeError(`Cannot normalize a vector with norm ${norm}`);
  }
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / norm;
  return out;
}
