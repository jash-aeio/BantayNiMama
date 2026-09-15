// Reference-photo quality warnings — SR-22. Pure.
//
// Measured on each saved JPEG's model input (224² RGB in [0, 1]) on the JS thread, where enrollment
// may block (TR-25 exempts it). Never in the worklet: laplacianVariance alone cost 20.9 ms per frame
// there (P1-8 diagnosis).
//
// Every limit below is an UNCALIBRATED PLACEHOLDER (PHASE_2_PLAN P2-6; TR-27's floor is still 0), so
// a warning suggests a retake and never blocks a save. The measured values go to the gate panel, so
// Phase 3 can set the limits from real shots instead of from these guesses.

import { laplacianVariance } from './sharpness.ts';

export interface ShotQuality {
  /** Mean luminance with Rec. 601 weights: 0 is black, 1 is white. */
  readonly luminance: number;
  /** laplacianVariance of the same input. Higher is sharper. */
  readonly sharpness: number;
}

export type QualityWarning = 'tooDark' | 'blownOut' | 'blurred';

export interface QualityLimits {
  readonly darkBelow: number;
  readonly blownAbove: number;
  readonly blurredBelow: number;
}

/**
 * Placeholders, not measurements. For scale only: live frames on the Infinix measured sharpness
 * ×1000 at p10 0.3 and median 8.6 (P1-8 diagnosis, n = 300). No luminance has been measured yet.
 */
export const PLACEHOLDER_QUALITY_LIMITS: QualityLimits = { darkBelow: 0.12, blownAbove: 0.88, blurredBelow: 0.0005 };

export function measureShotQuality(rgb: ArrayLike<number>, width: number, height: number): ShotQuality {
  return { luminance: meanLuminance(rgb, width, height), sharpness: laplacianVariance(rgb, width, height) };
}

/** Mean luminance of NHWC RGB in [0, 1], sampled every `step` pixels in each direction. */
export function meanLuminance(rgb: ArrayLike<number>, width: number, height: number, step: number = 2): number {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`Luminance needs a non-empty image, got ${width}×${height}`);
  }
  if (rgb.length < width * height * 3) {
    throw new RangeError(`Luminance expects ${width * height * 3} RGB values, got ${rgb.length}`);
  }
  if (!Number.isInteger(step) || step < 1) throw new RangeError(`Step must be a positive integer, got ${step}`);

  let sum = 0;
  let n = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 3;
      sum += 0.299 * rgb[i]! + 0.587 * rgb[i + 1]! + 0.114 * rgb[i + 2]!;
      n += 1;
    }
  }
  return sum / n;
}

/**
 * At most one warning, naming the likeliest cause.
 *
 * Exposure is checked first. A black or clipped-white photo has almost no edges, so it would always
 * read as blurred as well, and "too dark" is the thing she can fix.
 */
export function qualityWarnings(quality: ShotQuality, limits: QualityLimits = PLACEHOLDER_QUALITY_LIMITS): QualityWarning[] {
  if (!Number.isFinite(quality.luminance) || !Number.isFinite(quality.sharpness)) {
    throw new RangeError(`Quality values must be finite, got luminance ${quality.luminance}, sharpness ${quality.sharpness}`);
  }
  if (quality.luminance < limits.darkBelow) return ['tooDark'];
  if (quality.luminance > limits.blownAbove) return ['blownOut'];
  return quality.sharpness < limits.blurredBelow ? ['blurred'] : [];
}
