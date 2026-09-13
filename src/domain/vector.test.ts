import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { blobToVector, dot, l2Normalize, vectorToBlob } from './vector.ts';

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

describe('vectorToBlob / blobToVector (ADR-014)', () => {
  test('round-trips a vector bit for bit', () => {
    const v = l2Normalize([0.1, -2.5, 3.25, 1e-7]);
    assert.deepEqual(blobToVector(vectorToBlob(v), 4), v);
  });

  test('stores little-endian Float32, so the file reads the same on any phone', () => {
    assert.deepEqual([...new Uint8Array(vectorToBlob(new Float32Array([1])))], [0, 0, 128, 63]);
  });

  test('writes a fresh buffer, not the source vector memory', () => {
    const v = new Float32Array([1, 2]);
    const blob = vectorToBlob(v);
    v[0] = 99;
    assert.equal(blobToVector(blob, 2)[0], 1);
  });

  test('reads a BLOB handed over as a view at an odd byte offset', () => {
    const padded = new Uint8Array(9);
    padded.set(new Uint8Array(vectorToBlob(new Float32Array([0.5, -1]))), 1);
    assert.deepEqual(blobToVector(padded.subarray(1), 2), new Float32Array([0.5, -1]));
  });

  test('refuses a BLOB of the wrong size — a different model wrote it (TR-23)', () => {
    assert.throws(() => blobToVector(new ArrayBuffer(12), 4), RangeError);
    assert.throws(() => blobToVector(new ArrayBuffer(16), 1280), RangeError);
  });
});
