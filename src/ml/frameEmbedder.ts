import type { TensorflowModel } from 'react-native-fast-tflite';
import { HybridFrameConverter, type Frame } from 'react-native-vision-camera';

import { channelLayout, reticleRect, toModelInput } from '../domain/pixels.ts';
import { l2Normalize } from '../domain/vector.ts';
import { INPUT_SIZE, RETICLE_FRACTION } from './model';

export interface StageTimings {
  /** Frame → image, reticle crop, resize to 224², and packing into Float32. */
  readonly cropResizeMs: number;
  /** model.runSync. */
  readonly inferenceMs: number;
  /** L2 normalization, which also copies the vector out of the model's output buffer. */
  readonly normalizeMs: number;
  readonly totalMs: number;
}

export interface FrameEmbedding {
  /** 1280-d, unit length (TR-22). */
  readonly vector: Float32Array;
  readonly timings: StageTimings;
}

/**
 * Centre reticle → 224 × 224 → model → unit vector, synchronously on the camera thread (TR-25).
 * Only the vector and its timings leave the worklet (ARCHITECTURE.md §2).
 *
 * Stages are timed separately. Phase 0's 145 ms covered them all as one number (ARCHITECTURE.md
 * §8), and whether crop/resize or inference dominates decides what to fix first.
 *
 * Throws on failure rather than returning null, so the caller can surface why a frame failed.
 */
export function embedFrame(frame: Frame, model: TensorflowModel): FrameEmbedding {
  'worklet';
  const t0 = performance.now();
  const image = HybridFrameConverter.convertFrameToImage(frame);
  let cropped: ReturnType<typeof image.crop> | null = null;
  let resized: ReturnType<typeof image.resize> | null = null;
  try {
    const { x0, y0, x1, y1 } = reticleRect(image.width, image.height, RETICLE_FRACTION);
    cropped = image.crop(x0, y0, x1, y1);
    resized = cropped.resize(INPUT_SIZE, INPUT_SIZE);
    const raw = resized.toRawPixelData();
    const layout = channelLayout(raw.pixelFormat);
    if (layout === null) throw new Error(`Unsupported pixel format ${raw.pixelFormat}`);
    const input = toModelInput(new Uint8Array(raw.buffer), raw.width, raw.height, layout);
    const t1 = performance.now();

    const head = model.runSync([input.buffer])[0];
    if (head === undefined) throw new Error('Model returned no output');
    const t2 = performance.now();

    // `new Float32Array(head)` is only a view over the model's output buffer, which the next frame
    // reuses. l2Normalize writes into a fresh array, so nothing points at that buffer afterwards.
    const vector = l2Normalize(new Float32Array(head));
    const t3 = performance.now();

    return {
      vector,
      timings: { cropResizeMs: t1 - t0, inferenceMs: t2 - t1, normalizeMs: t3 - t2, totalMs: t3 - t0 },
    };
  } finally {
    resized?.dispose();
    cropped?.dispose();
    image.dispose();
  }
}
