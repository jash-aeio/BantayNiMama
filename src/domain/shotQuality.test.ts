import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { meanLuminance, measureShotQuality, PLACEHOLDER_QUALITY_LIMITS, qualityWarnings } from './shotQuality.ts';

/** An RGB image whose three channels all equal `value(x, y)`. */
function gray(width: number, height: number, value: (x: number, y: number) => number): Float32Array {
  const rgb = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      rgb.fill(value(x, y), i, i + 3);
    }
  }
  return rgb;
}

// 2-px squares: meanLuminance samples every second pixel, and a 1-px checker would read all black.
const checker = (x: number, y: number) => ((x >> 1) + (y >> 1)) % 2;

describe('meanLuminance (SR-22)', () => {
  test('a flat gray image reads its own level', () => {
    assert.ok(Math.abs(meanLuminance(gray(8, 8, () => 0.3), 8, 8) - 0.3) < 1e-6);
  });

  test('weights the channels like the eye: pure red is darker than pure green', () => {
    const red = new Float32Array(4 * 4 * 3);
    const green = new Float32Array(4 * 4 * 3);
    for (let p = 0; p < 16; p++) {
      red[p * 3] = 1;
      green[p * 3 + 1] = 1;
    }
    assert.ok(Math.abs(meanLuminance(red, 4, 4, 1) - 0.299) < 1e-6);
    assert.ok(Math.abs(meanLuminance(green, 4, 4, 1) - 0.587) < 1e-6);
  });

  test('refuses an empty image, a short buffer or a bad step', () => {
    assert.throws(() => meanLuminance(new Float32Array(0), 0, 4), RangeError);
    assert.throws(() => meanLuminance(new Float32Array(10), 4, 4), RangeError);
    assert.throws(() => meanLuminance(gray(4, 4, () => 0), 4, 4, 0), RangeError);
  });
});

describe('qualityWarnings (SR-22, placeholder limits)', () => {
  test('a dark photo warns too dark, and only that', () => {
    assert.deepEqual(qualityWarnings(measureShotQuality(gray(16, 16, () => 0.05), 16, 16)), ['tooDark']);
  });

  test('a clipped white photo warns blown out, and only that', () => {
    assert.deepEqual(qualityWarnings(measureShotQuality(gray(16, 16, () => 0.97), 16, 16)), ['blownOut']);
  });

  test('a well-exposed photo with no edges warns blurred', () => {
    assert.deepEqual(qualityWarnings(measureShotQuality(gray(16, 16, () => 0.5), 16, 16)), ['blurred']);
  });

  test('a well-exposed, detailed photo has no warning', () => {
    const quality = measureShotQuality(gray(32, 32, checker), 32, 32);
    assert.ok(quality.sharpness > PLACEHOLDER_QUALITY_LIMITS.blurredBelow, String(quality.sharpness));
    assert.deepEqual(qualityWarnings(quality), []);
  });

  test('limits are inclusive on the safe side: exactly at a limit does not warn', () => {
    const { darkBelow, blownAbove, blurredBelow } = PLACEHOLDER_QUALITY_LIMITS;
    assert.deepEqual(qualityWarnings({ luminance: darkBelow, sharpness: blurredBelow }), []);
    assert.deepEqual(qualityWarnings({ luminance: blownAbove, sharpness: blurredBelow }), []);
  });

  test('refuses a value that is not a number', () => {
    assert.throws(() => qualityWarnings({ luminance: NaN, sharpness: 1 }), RangeError);
    assert.throws(() => qualityWarnings({ luminance: 0.5, sharpness: Infinity }), RangeError);
  });
});
