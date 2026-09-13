import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { dot, l2Normalize } from './vector.ts';

const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `expected ${expected}, got ${actual}`);

describe('dot (TR-22)', () => {
  test('is cosine similarity for unit vectors', () => {
    assert.equal(dot([1, 0], [0, 1]), 0);
    assert.equal(dot([1, 0], [-1, 0]), -1);
    close(dot([0.6, 0.8], [0.6, 0.8]), 1);
  });

  test('accepts a Float32Array straight from the worklet', () => {
    close(dot(new Float32Array([0.6, 0.8]), [0.6, 0.8]), 1);
  });

  test('throws on a length mismatch instead of truncating (TR-23)', () => {
    assert.throws(() => dot([1, 0, 0], [1, 0]), RangeError);
  });
});

describe('l2Normalize (TR-22)', () => {
  test('scales to unit length and keeps direction', () => {
    const v = l2Normalize([3, 4]);
    close(v[0]!, 0.6);
    close(v[1]!, 0.8);
    close(dot(v, v), 1);
  });

  test('refuses a zero or non-finite vector', () => {
    assert.throws(() => l2Normalize([0, 0, 0]), RangeError);
    assert.throws(() => l2Normalize([NaN, 1]), RangeError);
    assert.throws(() => l2Normalize([Infinity, 1]), RangeError);
  });
});
