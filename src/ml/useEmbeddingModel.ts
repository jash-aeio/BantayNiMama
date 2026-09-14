import { useEffect, useState } from 'react';

import { loadEmbeddingModel, type Accelerator, type LoadedModel } from './loadModel';

export type ModelState =
  | { readonly state: 'loading'; readonly accelerator: Accelerator }
  | { readonly state: 'loaded'; readonly loaded: LoadedModel }
  | { readonly state: 'error'; readonly accelerator: Accelerator; readonly error: string };

/** Loads one embedding model instance for the life of the component that owns it. */
export function useEmbeddingModel(accelerator: Accelerator = 'cpu'): ModelState {
  const [state, setState] = useState<ModelState>({ state: 'loading', accelerator });

  useEffect(() => {
    let cancelled = false;
    setState({ state: 'loading', accelerator });
    loadEmbeddingModel(accelerator).then(
      (loaded) => {
        if (!cancelled) setState({ state: 'loaded', loaded });
      },
      (e: unknown) => {
        if (!cancelled) setState({ state: 'error', accelerator, error: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [accelerator]);

  return state;
}
