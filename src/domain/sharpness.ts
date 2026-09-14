// Frame sharpness — a diagnostic toward TR-27's sharpness gate. Pure, worklet-callable.
//
// Measure only, for now. Nothing is dropped on this number until a floor is calibrated from sharp
// and blurred frames on the device, because an uncalibrated floor would silently discard good
// frames or keep bad ones.

/**
 * Variance of the Laplacian of luminance over a model input: NHWC RGB, interleaved, values in
 * [0, 1]. Higher means sharper; motion blur and defocus smooth edges and lower it.
 *
 * Sampled every `step` pixels in each direction to bound the worklet cost; the 4 neighbours stay
 * 1 px away, so the measure is the same at any step. Luminance is inlined rather than called: the
 * worklet runtime has no JIT, and a function call per neighbour is the expensive part.
 */
export function laplacianVariance(rgb: ArrayLike<number>, width: number, height: number, step: number = 2): number {
  'worklet';
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 3 || height < 3) {
    throw new RangeError(`Sharpness needs at least a 3×3 image, got ${width}×${height}`);
  }
  if (rgb.length < width * height * 3) {
    throw new RangeError(`Sharpness expects ${width * height * 3} RGB values, got ${rgb.length}`);
  }
  if (!Number.isInteger(step) || step < 1) throw new RangeError(`Step must be a positive integer, got ${step}`);

  let n = 0;
  let sum = 0;
  let sumSq = 0;
  for (let y = 1; y < height - 1; y += step) {
    for (let x = 1; x < width - 1; x += step) {
      const c = (y * width + x) * 3;
      const l = c - 3;
      const r = c + 3;
      const u = c - width * 3;
      const d = c + width * 3;
      const lap =
        4 * (0.299 * rgb[c]! + 0.587 * rgb[c + 1]! + 0.114 * rgb[c + 2]!) -
        (0.299 * rgb[l]! + 0.587 * rgb[l + 1]! + 0.114 * rgb[l + 2]!) -
        (0.299 * rgb[r]! + 0.587 * rgb[r + 1]! + 0.114 * rgb[r + 2]!) -
        (0.299 * rgb[u]! + 0.587 * rgb[u + 1]! + 0.114 * rgb[u + 2]!) -
        (0.299 * rgb[d]! + 0.587 * rgb[d + 1]! + 0.114 * rgb[d + 2]!);
      sum += lap;
      sumSq += lap * lap;
      n += 1;
    }
  }
  const mean = sum / n;
  return Math.max(0, sumSq / n - mean * mean);
}
