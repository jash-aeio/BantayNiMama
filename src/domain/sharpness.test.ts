import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { laplacianVariance } from './sharpness.ts';

/** An RGB image whose three channels all equal `value(x, y)`. */
function gray(width: number, height: number, value: (x: number, y: number) => number): Float32Array {
  const rgb = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = value(x, y);
      const i = (y * width + x) * 3;
      rgb[i] = v;
      rgb[i + 1] = v;
      rgb[i + 2] = v;
    }
  }
  return rgb;
}

const checker = (x: number, y: number) => ((x >> 1) + (y >> 1)) % 2;

/** A 5×5 box blur of a gray image, clamped at the edges. */
function boxBlur(src: Float32Array, width: number, height: number): Float32Array {
  return gray(width, height, (x, y) => {
    let total = 0;
    let count = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const xx = Math.min(width - 1, Math.max(0, x + dx));
        const yy = Math.min(height - 1, Math.max(0, y + dy));
        total += src[(yy * width + xx) * 3]!;
        count++;
      }
    }
    return total / count;
  });
}

describe('laplacianVariance (TR-27 diagnostic)', () => {
  test('a flat image has zero sharpness', () => {
    assert.equal(laplacianVariance(gray(16, 16, () => 0.5), 16, 16), 0);
  });

  test('blurring a textured image lowers it', () => {
    const sharp = gray(32, 32, checker);
    const blurred = boxBlur(sharp, 32, 32);
    const sharpScore = laplacianVariance(sharp, 32, 32);
    const blurredScore = laplacianVariance(blurred, 32, 32);
    assert.ok(sharpScore > 0);
    assert.ok(blurredScore < sharpScore / 4, `blurred ${blurredScore} vs sharp ${sharpScore}`);
  });

  test('uses luminance, so a pure-blue edge counts less than a gray one', () => {
    const edge = (x: number) => (x < 8 ? 0 : 1);
    const grayEdge = gray(16, 16, edge);
    const blueEdge = new Float32Array(16 * 16 * 3);
    for (let p = 0; p < 16 * 16; p++) blueEdge[p * 3 + 2] = edge(p % 16);
    assert.ok(laplacianVariance(blueEdge, 16, 16, 1) < laplacianVariance(grayEdge, 16, 16, 1));
  });

  test('refuses an image too small or a buffer too short', () => {
    assert.throws(() => laplacianVariance(new Float32Array(12), 2, 2), RangeError);
    assert.throws(() => laplacianVariance(new Float32Array(10), 4, 4), RangeError);
    assert.throws(() => laplacianVariance(gray(8, 8, () => 0), 8, 8, 0), RangeError);
  });
});
