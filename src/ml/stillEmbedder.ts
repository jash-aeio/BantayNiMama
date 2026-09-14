import type { TensorflowModel } from 'react-native-fast-tflite';
import { Images } from 'react-native-nitro-image';

import { channelLayout, toModelInput } from '../domain/pixels.ts';
import { l2Normalize } from '../domain/vector.ts';
import { INPUT_SIZE } from './model';

/**
 * Embeds a saved reference JPEG on the JS thread. It is used for enrollment, and for re-embedding
 * after a model swap (TR-24). Enrollment is exempt from TR-25, so blocking here is acceptable.
 *
 * The file must already be the square reticle crop; P1-4 saves it that way. Stretching a
 * non-square image to 224 × 224 would give a vector no live frame can match, so one is refused.
 * Pixels go through the same toModelInput as live frames.
 *
 * Not yet exercised on device. That happens in P1-4, when reference JPEGs exist.
 */
export function embedImageFile(filePath: string, model: TensorflowModel): Float32Array {
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

    const input = toModelInput(new Uint8Array(raw.buffer), raw.width, raw.height, layout);
    const output = model.runSync([input.buffer])[0];
    if (output === undefined) throw new Error('Model returned no output');
    return l2Normalize(new Float32Array(output));
  } finally {
    resized?.dispose();
    image.dispose();
  }
}
