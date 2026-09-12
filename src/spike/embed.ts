import { HybridFrameConverter, type Frame } from 'react-native-vision-camera';
import type { PixelFormat } from 'react-native-nitro-image';
import type { TfliteModel } from 'react-native-fast-tflite';

import { INPUT_SCALE, INPUT_SIZE, RETICLE_FRACTION } from './config';

/**
 * Byte offsets of the R, G and B channels plus the per-pixel stride, for each
 * raw pixel layout nitro-image can hand back. Android bitmaps come out RGBA,
 * iOS typically BGRA — guessing here would silently feed the model swapped
 * channels, which costs accuracy without ever throwing.
 */
function channelLayout(format: PixelFormat): { r: number; g: number; b: number; stride: number } | null {
  'worklet';
  switch (format) {
    case 'RGBA':
    case 'RGBX':
      return { r: 0, g: 1, b: 2, stride: 4 };
    case 'BGRA':
    case 'BGRX':
      return { r: 2, g: 1, b: 0, stride: 4 };
    case 'ARGB':
    case 'XRGB':
      return { r: 1, g: 2, b: 3, stride: 4 };
    case 'ABGR':
    case 'XBGR':
      return { r: 3, g: 2, b: 1, stride: 4 };
    case 'RGB':
      return { r: 0, g: 1, b: 2, stride: 3 };
    case 'BGR':
      return { r: 2, g: 1, b: 0, stride: 3 };
    default:
      return null;
  }
}

export interface EmbedResult {
  vector: number[];
  /** Wall-clock ms for crop + resize + inference, measured inside the worklet. */
  elapsedMs: number;
  /** Output dimensionality as reported by the model, not as assumed. */
  dim: number;
}

/**
 * Crop the center reticle, resize to the model's input, run inference and
 * L2-normalize — all synchronously inside the camera thread worklet (TR-25).
 *
 * Everything here is Nitro, so the model and the frame converter cross into the
 * worklet runtime without boxing; that was the whole reason VisionCamera v5 and
 * fast-tflite v3 were chosen together.
 */
export function embedFrame(frame: Frame, model: TfliteModel): EmbedResult | null {
  'worklet';
  const started = performance.now();

  const image = HybridFrameConverter.convertFrameToImage(frame);
  let cropped: ReturnType<typeof image.crop> | null = null;
  let resized: ReturnType<typeof image.resize> | null = null;
  try {
    const side = Math.floor(Math.min(image.width, image.height) * RETICLE_FRACTION);
    const x0 = Math.floor((image.width - side) / 2);
    const y0 = Math.floor((image.height - side) / 2);

    cropped = image.crop(x0, y0, x0 + side, y0 + side);
    resized = cropped.resize(INPUT_SIZE, INPUT_SIZE);

    const raw = resized.toRawPixelData();
    const layout = channelLayout(raw.pixelFormat);
    if (layout == null) return null;

    const bytes = new Uint8Array(raw.buffer);
    const input = new Float32Array(INPUT_SIZE * INPUT_SIZE * 3);
    for (let px = 0; px < INPUT_SIZE * INPUT_SIZE; px++) {
      const src = px * layout.stride;
      const dst = px * 3;
      input[dst] = (bytes[src + layout.r] ?? 0) * INPUT_SCALE;
      input[dst + 1] = (bytes[src + layout.g] ?? 0) * INPUT_SCALE;
      input[dst + 2] = (bytes[src + layout.b] ?? 0) * INPUT_SCALE;
    }

    const outputs = model.runSync([input.buffer]);
    const head = outputs[0];
    if (head == null) return null;

    // Copy out of the model's buffer before it is reused by the next frame.
    const raw32 = new Float32Array(head);
    let sumSq = 0;
    for (let i = 0; i < raw32.length; i++) sumSq += (raw32[i] ?? 0) * (raw32[i] ?? 0);
    const norm = Math.sqrt(sumSq) || 1;

    const vector: number[] = [];
    for (let i = 0; i < raw32.length; i++) vector.push((raw32[i] ?? 0) / norm);

    return { vector, elapsedMs: performance.now() - started, dim: raw32.length };
  } finally {
    resized?.dispose();
    cropped?.dispose();
    image.dispose();
  }
}
