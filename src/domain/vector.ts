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
  'worklet'; // also runs on the camera thread (src/ml/frameEmbedder.ts)
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

const HOST_IS_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/**
 * Serialize a vector for `product_shots.embedding` (ADR-014): Float32, always little-endian, in a
 * fresh buffer. The byte order is fixed so an exported bantay.db (SR-45) reads the same on any
 * phone. ARM and x86 are little-endian, so the fast path is the one that runs; the DataView path
 * exists for correctness and cannot be exercised on those hosts.
 */
export function vectorToBlob(v: Float32Array): ArrayBuffer {
  if (HOST_IS_LITTLE_ENDIAN) return v.slice().buffer as ArrayBuffer;
  const view = new DataView(new ArrayBuffer(v.length * Float32Array.BYTES_PER_ELEMENT));
  for (let i = 0; i < v.length; i++) view.setFloat32(i * Float32Array.BYTES_PER_ELEMENT, v[i]!, true);
  return view.buffer;
}

/**
 * Parse a stored embedding. Throws unless it holds exactly `dim` Float32 values: a vector of
 * the wrong size was written by a different model (TR-23) and must never be searched.
 *
 * Always copies, because a BLOB can arrive as a view at an odd byte offset, where a Float32Array
 * cannot be laid directly over the bytes.
 */
export function blobToVector(blob: ArrayBuffer | ArrayBufferView, dim: number): Float32Array {
  const bytes =
    blob instanceof ArrayBuffer ? new Uint8Array(blob) : new Uint8Array(blob.buffer, blob.byteOffset, blob.byteLength);
  if (bytes.byteLength !== dim * Float32Array.BYTES_PER_ELEMENT) {
    throw new RangeError(
      `Embedding has ${bytes.byteLength} bytes; ${dim} dimensions need ${dim * Float32Array.BYTES_PER_ELEMENT}`,
    );
  }
  const out = new Float32Array(dim);
  if (HOST_IS_LITTLE_ENDIAN) {
    new Uint8Array(out.buffer).set(bytes);
    return out;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < dim; i++) out[i] = view.getFloat32(i * Float32Array.BYTES_PER_ELEMENT, true);
  return out;
}
