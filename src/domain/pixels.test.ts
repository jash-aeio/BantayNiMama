import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { channelLayout, reticleRect, toModelInput } from './pixels.ts';

describe('reticleRect (ADR-006)', () => {
  test('is a centred square of the shorter edge', () => {
    // A 1280×720 landscape frame at 0.55: side 396, centred.
    assert.deepEqual(reticleRect(1280, 720, 0.55), { x0: 442, y0: 162, x1: 838, y1: 558 });
  });

  test('is the same square for a portrait frame of the same size', () => {
    const r = reticleRect(720, 1280, 0.55);
    assert.equal(r.x1 - r.x0, 396);
    assert.equal(r.y1 - r.y0, 396);
  });

  test('covers the whole shorter edge at fraction 1', () => {
    assert.deepEqual(reticleRect(10, 10, 1), { x0: 0, y0: 0, x1: 10, y1: 10 });
  });

  test('refuses a fraction outside (0, 1]', () => {
    assert.throws(() => reticleRect(10, 10, 0), RangeError);
    assert.throws(() => reticleRect(10, 10, 1.5), RangeError);
    assert.throws(() => reticleRect(10, 10, NaN), RangeError);
  });
});

describe('channelLayout', () => {
  test('maps every layout nitro-image can return', () => {
    assert.deepEqual(channelLayout('RGBA'), { r: 0, g: 1, b: 2, stride: 4 });
    assert.deepEqual(channelLayout('BGRA'), { r: 2, g: 1, b: 0, stride: 4 });
    assert.deepEqual(channelLayout('ARGB'), { r: 1, g: 2, b: 3, stride: 4 });
    assert.deepEqual(channelLayout('ABGR'), { r: 3, g: 2, b: 1, stride: 4 });
    assert.deepEqual(channelLayout('RGBX'), channelLayout('RGBA'));
    assert.deepEqual(channelLayout('XBGR'), channelLayout('ABGR'));
    assert.deepEqual(channelLayout('RGB'), { r: 0, g: 1, b: 2, stride: 3 });
    assert.deepEqual(channelLayout('BGR'), { r: 2, g: 1, b: 0, stride: 3 });
  });

  test('returns null for a layout it does not know, rather than guessing', () => {
    assert.equal(channelLayout('YUV'), null);
  });
});

describe('toModelInput (TR-21)', () => {
  // One pure-red pixel, then one pure-blue pixel, in each byte order.
  const expected = new Float32Array([1, 0, 0, 0, 0, 1]);

  test('RGBA and BGRA bytes of the same colours give the same input', () => {
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]);
    const bgra = new Uint8Array([0, 0, 255, 255, 255, 0, 0, 255]);
    assert.deepEqual(toModelInput(rgba, 2, 1, channelLayout('RGBA')!), expected);
    assert.deepEqual(toModelInput(bgra, 2, 1, channelLayout('BGRA')!), expected);
  });

  test('3-byte RGB works, and alpha never leaks into the input', () => {
    assert.deepEqual(toModelInput(new Uint8Array([255, 0, 0, 0, 0, 255]), 2, 1, channelLayout('RGB')!), expected);
    const argbHalfAlpha = new Uint8Array([128, 255, 0, 0, 128, 0, 0, 255]);
    assert.deepEqual(toModelInput(argbHalfAlpha, 2, 1, channelLayout('ARGB')!), expected);
  });

  test('scales bytes to [0, 1] by ÷ 255, not to [-1, 1]', () => {
    const input = toModelInput(new Uint8Array([0, 51, 255]), 1, 1, channelLayout('RGB')!);
    assert.equal(input[0], 0);
    assert.ok(Math.abs(input[1]! - 0.2) < 1e-6);
    assert.equal(input[2], 1);
  });

  test('refuses a buffer that is not exactly width × height pixels', () => {
    assert.throws(() => toModelInput(new Uint8Array(9), 2, 1, channelLayout('RGBA')!), RangeError);
    assert.throws(() => toModelInput(new Uint8Array(8), 3, 1, channelLayout('RGBA')!), RangeError);
  });
});
