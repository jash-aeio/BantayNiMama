import { Asset } from 'expo-asset';
import { loadTensorflowModel, type TensorflowModel } from 'react-native-fast-tflite';

import { INPUT_SIZE } from './model';

const MODEL_ASSET = require('../../assets/models/mobilenet_v3_large.tflite');

/** 'cpu' is the default TFLite CPU path; 'android-gpu' is the GPU delegate (P1-3 latency diagnostic). */
export type Accelerator = 'cpu' | 'android-gpu';

export interface LoadedModel {
  readonly model: TensorflowModel;
  readonly accelerator: Accelerator;
  /** Read from the model's output tensor, not assumed (TR-20 was once wrong about this). */
  readonly embeddingDim: number;
}

/**
 * Loads the bundled embedder.
 *
 * TR-29: a bare `require()` only resolves under Metro. In a release build it becomes an Android
 * resource name the TFLite loader cannot open, so the asset is first copied out to a real
 * `file://` path by expo-asset (ADR-011).
 *
 * The loader also accepts http(s) URLs and would fetch them. Anything that is not a local file
 * is refused here, so this can never become a network call (TR-51).
 *
 * The model's own tensors are checked against what the pipeline feeds it. A different model file
 * then fails here, at load, instead of producing confidently wrong scores (TR-21).
 */
export async function loadEmbeddingModel(accelerator: Accelerator = 'cpu'): Promise<LoadedModel> {
  const asset = await Asset.fromModule(MODEL_ASSET).downloadAsync();
  const url = asset.localUri ?? asset.uri;
  if (!url.startsWith('file://')) {
    throw new Error(`Model asset did not resolve to a local file (TR-29): ${url}`);
  }

  const model = await loadTensorflowModel({ url }, accelerator === 'cpu' ? [] : [accelerator]);

  const input = model.inputs[0];
  const expectedInput = `1,${INPUT_SIZE},${INPUT_SIZE},3`;
  if (input === undefined || input.dataType !== 'float32' || input.shape.join(',') !== expectedInput) {
    throw new Error(
      `Model input is ${input?.dataType ?? 'missing'} [${input?.shape.join(',') ?? ''}]; ` +
        `the pipeline feeds float32 [${expectedInput}] (TR-21)`,
    );
  }
  const output = model.outputs[0];
  const embeddingDim = output?.shape[output.shape.length - 1];
  if (output === undefined || output.dataType !== 'float32' || embeddingDim === undefined || embeddingDim < 1) {
    throw new Error(`Model output is ${output?.dataType ?? 'missing'} [${output?.shape.join(',') ?? ''}]; expected a float32 embedding`);
  }

  return { model, accelerator, embeddingDim };
}
