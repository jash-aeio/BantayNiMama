import { createContext, useContext, type RefObject } from 'react';

import type { Catalog } from '../db/catalog';
import type { FirstRun } from '../domain/firstRun.ts';
import type { VectorIndex } from '../domain/knn.ts';
import type { Interaction, InteractionKind } from '../domain/interactionLog.ts';
import type { Language } from '../domain/language.ts';
import type { LockEvent } from '../domain/lockLog.ts';
import type { FrameLogEntry } from '../domain/timeToLock.ts';
import type { ShotMeasurement } from '../features/enrollment/useEnrollment';
import type { ScanTiming } from '../features/scanner/useScanner';
import type { StageTimings } from '../ml/frameEmbedder';
import type { ModelState } from '../ml/useEmbeddingModel';

// What every screen shares, created once in Root. One catalog connection, one search index and
// two model instances for the life of the app: opening any of them per screen would duplicate
// ~10 MB models and split the index that SR-24 depends on.

/** The two bottom tabs (TR-14, ADR-015). */
export type TabParams = { Scan: undefined; Products: undefined };

/** Why the index was rebuilt from SQLite rather than appended to (E-4). */
export type IndexRebuildReason = 'delete' | 'undo' | 'restore' | 'correction' | 'teach' | 'negative';

/** One rebuild, timed: PHASE_2_PLAN.md §9 records its cost after delete and restore. */
export interface IndexRebuild {
  readonly atMs: number;
  /** loadVectorIndex: the SELECTs, BLOB decoding and the matrix copy. */
  readonly ms: number;
  /** Rows in the new index, negatives included. */
  readonly size: number;
  readonly reason: IndexRebuildReason;
}

export interface Diagnostics {
  /** Recent worklet stage timings (ARCHITECTURE.md §8). */
  readonly workletTimings: RefObject<readonly StageTimings[]>;
  /** Recent JS-thread KNN and policy timings. */
  readonly scanTimings: RefObject<readonly ScanTiming[]>;
  /** Frame-vs-JPEG agreement, bytes and quality for every shot captured this session (ARCHITECTURE.md §4). */
  readonly enrollmentMeasurements: RefObject<readonly ShotMeasurement[]>;
  /** Every scanner lock change since launch or the last clear (PHASE_1_PLAN §4 step 5). */
  readonly lockLog: RefObject<readonly LockEvent[]>;
  /** Every processed frame's kind and times, and every scanner reset, for time-to-lock (NFR-04, P2-8). Appended in place. */
  readonly frameLog: RefObject<FrameLogEntry[]>;
  /** Every tap the Phase 2 gate is judged on, since launch (PHASE_2_PLAN §4). Never persisted. */
  readonly interactionLog: RefObject<readonly Interaction[]>;
  /** Index rebuilds since launch (E-4). */
  readonly indexRebuilds: RefObject<readonly IndexRebuild[]>;
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
  /** Goes up after every catalog write: enrollment, edit, delete, restore, negative, correction, taught photo. */
  readonly catalogVersion: number;
  bumpCatalogVersion(): void;
  /**
   * Replaces the live index with one read from SQLite, after a write that removed rows from the
   * search: delete, undo, restore, a replaced extra shot, a deleted negative (E-4). Throws if the read
   * fails, leaving the old index in place.
   */
  rebuildIndex(reason: IndexRebuildReason): IndexRebuild;
  /** Appends one tap to the interaction log, stamped now. */
  logInteraction(kind: InteractionKind, productIds: readonly string[]): void;
  /** SR-44: the guided flow's state, from the live product count and the saved dismissal. */
  readonly firstRun: FirstRun;
  /** *Finish later*: saves the dismissal in app_meta and logs it. */
  finishFirstRunLater(): void;
  /** True once, right after the first-run intro hands over: the Scan tab then opens the guided add. */
  consumeGuidedStart(): boolean;
  /**
   * SR-33: *Teach again* from the Directory. The camera lives on the Scan tab, so the request is handed
   * over: the Directory calls requestTeach and switches tabs, and the Scan tab takes the id once.
   */
  requestTeach(productId: string): void;
  /** The pending *Teach again* product, or null. Clears it, so a re-render never opens it twice. */
  consumeTeachRequest(): string | null;
  /** Goes up with every requestTeach, so the Scan tab knows to look. */
  readonly teachVersion: number;
  readonly diagnostics: Diagnostics;
}

export const AppServicesContext = createContext<AppServices | null>(null);

export function useAppServices(): AppServices {
  const services = useContext(AppServicesContext);
  if (services === null) throw new Error('useAppServices must be used under AppServicesContext (src/app/Root.tsx)');
  return services;
}
