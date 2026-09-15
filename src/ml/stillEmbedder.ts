import type { TensorflowModel } from 'react-native-fast-tflite';
import { Images } from 'react-native-nitro-image';

import { channelLayout, toModelInput } from '../domain/pixels.ts';
import { measureShotQuality, type ShotQuality } from '../domain/shotQuality.ts';
import { l2Normalize } from '../domain/vector.ts';
import { INPUT_SIZE } from './model';

/**
 * Decodes a saved reference JPEG into the model's input and hands it to `use`, on the JS thread.
 *
 * The file must already be the square reticle crop; P1-4 saves it that way. Stretching a
 * non-square image to 224 × 224 would give a vector no live frame can match, so one is refused.
 * Pixels go through the same toModelInput as live frames.
 */
function withModelInput<T>(filePath: string, use: (input: Float32Array<ArrayBuffer>, side: number) => T): T {
  const image = Images.loadFromFile(filePath.replace(/^file:\/\//, ''));
  let resized: ReturnType<typeof image.resize> | null = null;
  try {
    if (image.width !== image.height) {
      throw new Error(`Reference image must be the square reticle crop, got ${image.width}×${image.height}`);
    }
    resized = image.resize(INPUT_SIZE, INPUT_SIZE);
    const raw = resized.toRawPixelData();
    const layout = channelLayout(raw.pixelFormat);
    if (layout === null) throw new Error(`Unsupported pixel format ${raw.pixelFormat}`);
    // toModelInput copies into a fresh array, so `input` outlives the native image disposed below.
    return use(toModelInput(new Uint8Array(raw.buffer), raw.width, raw.height, layout), raw.width);
  } finally {
    resized?.dispose();
    image.dispose();
  }
}

function embedInput(input: Float32Array<ArrayBuffer>, model: TensorflowModel): Float32Array {
  const output = model.runSync([input.buffer])[0];
  if (output === undefined) throw new Error('Model returned no output');
  return l2Normalize(new Float32Array(output));
}

/**
 * Embeds a saved reference JPEG on the JS thread. It is used by the gate check's self-match, and for
 * re-embedding after a model swap (TR-24). Enrollment is exempt from TR-25, so blocking is acceptable.
 */
export function embedImageFile(filePath: string, model: TensorflowModel): Float32Array {
  return withModelInput(filePath, (input) => embedInput(input, model));
}

/**
 * For enrollment (P2-6): the vector, plus the photo's exposure and sharpness for SR-22's warnings.
 * Both are measured on the same decoded input, so a warning describes exactly what was embedded, and
 * the JPEG is decoded once. Measuring costs roughly one laplacianVariance, about 21 ms per shot in the
 * worklet on the Infinix (P1-8); per shot, not per frame.
 */
export function embedAndMeasureImageFile(filePath: string, model: TensorflowModel): { vector: Float32Array; quality: ShotQuality } {
  return withModelInput(filePath, (input, side) => ({
    vector: embedInput(input, model),
    quality: measureShotQuality(input, side, side),
  }));
}
