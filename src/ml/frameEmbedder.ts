import type { TensorflowModel } from 'react-native-fast-tflite';
import type { RawPixelData } from 'react-native-nitro-image';
import { HybridFrameConverter, type Frame } from 'react-native-vision-camera';

import { channelLayout, reticleRect, toModelInput } from '../domain/pixels.ts';
import { referenceSide } from '../domain/referencePhoto.ts';
import { l2Normalize } from '../domain/vector.ts';
import { INPUT_SIZE, RETICLE_FRACTION } from './model';

// ORDER MATTERS IN THIS FILE. The worklets Babel plugin turns each 'worklet' function into an
// object that captures the functions it references *at the moment that object is created*. A
// helper declared below its caller is captured as `undefined`, and every frame then fails with
// "undefined is not a function". Plain JS hoisting hides this from typecheck and from node tests.
// So helpers go above the worklets that call them. (Found on device in P1-4.)

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

export interface ReferenceCapture {
  /** The live-frame vector, computed exactly as scanning computes it. */
  readonly embedding: FrameEmbedding;
  /** The same reticle crop at the stored size (TR-42), as raw pixels owned by JS. */
  readonly crop: RawPixelData;
  readonly frameWidth: number;
  readonly frameHeight: number;
}

type NitroImage = ReturnType<typeof HybridFrameConverter.convertFrameToImage>;

/** The shared scanning path from a reticle crop onward. `t0` is when frame conversion began. */
function embedCrop(cropped: NitroImage, model: TensorflowModel, t0: number): FrameEmbedding {
  'worklet';
  let resized: NitroImage | null = null;
  try {
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
  }
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
  let cropped: NitroImage | null = null;
  try {
    const { x0, y0, x1, y1 } = reticleRect(image.width, image.height, RETICLE_FRACTION);
    cropped = image.crop(x0, y0, x1, y1);
    return embedCrop(cropped, model, t0);
  } finally {
    cropped?.dispose();
    image.dispose();
  }
}

/**
 * For enrollment (P1-4): one frame's reticle crop, used twice. Once through the scanning path for
 * the live vector, and once at the stored size for the reference JPEG.
 *
 * Cutting both from the same crop is what makes frame-vs-JPEG agreement a fair measurement: the
 * only differences left are the extra resize and the JPEG encoding.
 */
export function captureReference(frame: Frame, model: TensorflowModel): ReferenceCapture {
  'worklet';
  const t0 = performance.now();
  const image = HybridFrameConverter.convertFrameToImage(frame);
  let cropped: NitroImage | null = null;
  let stored: NitroImage | null = null;
  try {
    const rect = reticleRect(image.width, image.height, RETICLE_FRACTION);
    cropped = image.crop(rect.x0, rect.y0, rect.x1, rect.y1);
    const embedding = embedCrop(cropped, model, t0);

    const side = referenceSide(rect.x1 - rect.x0);
    stored = cropped.resize(side, side);
    const raw = stored.toRawPixelData();
    return {
      embedding,
      // slice(0): the raw buffer may point into the native image's memory, which is freed below.
      // JS must receive its own copy.
      crop: { buffer: raw.buffer.slice(0), width: raw.width, height: raw.height, pixelFormat: raw.pixelFormat },
      frameWidth: image.width,
      frameHeight: image.height,
    };
  } finally {
    stored?.dispose();
    cropped?.dispose();
    image.dispose();
  }
}
