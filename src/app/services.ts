import { createContext, useContext, type RefObject } from 'react';

import type { Catalog } from '../db/catalog';
import type { VectorIndex } from '../domain/knn.ts';
import type { Interaction } from '../domain/interactionLog.ts';
import type { Language } from '../domain/language.ts';
import type { LockEvent } from '../domain/lockLog.ts';
import type { ShotMeasurement } from '../features/enrollment/useEnrollment';
import type { ScanTiming } from '../features/scanner/useScanner';
import type { StageTimings } from '../ml/frameEmbedder';
import type { ModelState } from '../ml/useEmbeddingModel';

// What every screen shares, created once in Root. One catalog connection, one search index and
// two model instances for the life of the app: opening any of them per screen would duplicate
// ~10 MB models and split the index that SR-24 depends on.

export interface Diagnostics {
  /** Recent worklet stage timings (ARCHITECTURE.md §8). */
  readonly workletTimings: RefObject<readonly StageTimings[]>;
  /** Recent JS-thread KNN and policy timings. */
  readonly scanTimings: RefObject<readonly ScanTiming[]>;
  /** Frame-vs-JPEG agreement and bytes for every shot captured this session (ARCHITECTURE.md §4). */
  readonly enrollmentMeasurements: RefObject<readonly ShotMeasurement[]>;
  /** Every scanner lock change since launch or the last clear (PHASE_1_PLAN §4 step 5). */
  readonly lockLog: RefObject<readonly LockEvent[]>;
  /** Every Yes, No, Not-in-my-list and torch tap since launch (PHASE_2_PLAN §4). Never persisted. */
  readonly interactionLog: RefObject<readonly Interaction[]>;
}

export interface AppServices {
  readonly catalog: Catalog;
  /** The live search index (ADR-014). The scanner reads it every frame; enrollment extends it after COMMIT (SR-24). */
  readonly indexRef: RefObject<VectorIndex>;
  /** Runs in the camera worklet only. */
  readonly frameModel: ModelState;
  /** The second, CPU-only instance for JPEGs on the JS thread: enrollment and the gate's self-match. */
  readonly stillModel: ModelState;
  readonly language: Language;
  /** Switches the UI language now and saves it in app_meta (SR-42). */
  setLanguage(language: Language): void;
  /** Goes up after each enrollment, so lists re-read SQLite. */
  readonly catalogVersion: number;
  bumpCatalogVersion(): void;
  readonly diagnostics: Diagnostics;
}

export const AppServicesContext = createContext<AppServices | null>(null);

export function useAppServices(): AppServices {
  const services = useContext(AppServicesContext);
  if (services === null) throw new Error('useAppServices must be used under AppServicesContext (src/app/Root.tsx)');
  return services;
}
