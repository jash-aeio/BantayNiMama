import type { PersistenceProblem } from '../../domain/gateCheck.ts';
import { summarize } from '../../domain/stats.ts';
import type { StageTimings } from '../../ml/frameEmbedder';
import type { ShotMeasurement } from '../enrollment/useEnrollment';
import type { ScanTiming } from '../scanner/useScanner';
import type { GateCheckResult } from './runGateCheck';

// Gate-check and latency readouts. These are developer diagnostics for recording the gate
// (PHASE_1_PLAN.md §4), not tindera copy, so they are not translated. Record a run from the screen:
// console output did not reach logcat in the release build on the Infinix (P1-7).

export function describeGateCheck(r: GateCheckResult): string[] {
  const s = r.selfMatch;
  const passed = r.problems.length === 0 && s.passed;
  return [
    `${passed ? 'PASS' : 'FAIL'} — PHASE_1_PLAN §4 steps 3 and 4`,
    `step 3 · products ${r.counts.products} · shots ${r.counts.shots} · index ${r.indexSize} · other-model ${r.otherModelShots}`,
    `step 3 · app_meta schema ${r.meta.schemaVersion} · ${r.meta.modelId} · ${r.meta.embeddingDim}-d · τ ${r.meta.thresholds.tau} · δ ${r.meta.thresholds.delta}`,
    `step 3 · photo rows ${r.photoRows} · missing ${r.missingPhotos.length}`,
    ...r.problems.map((p) => `step 3 PROBLEM · ${describeProblem(p)}`),
    `step 4 · self-match ${s.shots - s.failures.length}/${s.shots} found their own vector first`,
    `step 4 · own score min ${fixed(s.ownScoreMin, 6)} · median ${fixed(s.ownScore?.median, 6)}`,
    `step 4 · nearest other shot median ${fixed(s.nearestOther?.median)} · p90 ${fixed(s.nearestOther?.p90)} · max ${fixed(s.nearestOther?.max)}`,
    ...s.failures.slice(0, 5).map((f) => `step 4 FAILURE · ${f.shotId} → nearest ${f.nearestShotId ?? 'none'} ${fixed(f.nearestScore)}`),
    `checked in ${(r.durationMs / 1000).toFixed(1)} s`,
  ];
}

function describeProblem(p: PersistenceProblem): string {
  switch (p.kind) {
    case 'emptyCatalog':
      return 'the catalog is empty';
    case 'schemaVersion':
    case 'embeddingDim':
      return `${p.kind} is ${p.found}, expected ${p.expected}`;
    case 'modelId':
      return `model_id is ${p.found}, expected ${p.expected}`;
    case 'indexMismatch':
      return `index ${p.indexSize} + other-model ${p.otherModelShots} ≠ ${p.shots} shot rows`;
    case 'missingPhotos':
      return `missing photos: ${p.paths.slice(0, 3).join(', ')}${p.paths.length > 3 ? ` (+${p.paths.length - 3} more)` : ''}`;
  }
}

/** Worklet per-stage median / p90 (P1-3). */
export function describeWorkletTimings(samples: readonly StageTimings[]): string {
  const stage = (name: string, pick: (t: StageTimings) => number) => {
    const s = summarize(samples.map(pick));
    return s === null ? `${name} —` : `${name} ${s.median.toFixed(1)}/${s.p90.toFixed(1)}`;
  };
  return (
    `worklet ms median/p90, n=${samples.length}: ` +
    [
      stage('crop+resize', (t) => t.cropResizeMs),
      stage('runSync', (t) => t.inferenceMs),
      stage('normalize', (t) => t.normalizeMs),
      stage('total', (t) => t.totalMs),
    ].join(' · ')
  );
}

/** JS-thread KNN and policy + stability median / p90 (P1-6). */
export function describeScanTimings(samples: readonly ScanTiming[]): string {
  const knn = summarize(samples.map((s) => s.knnMs));
  const policy = summarize(samples.map((s) => s.policyMs));
  const last = samples[samples.length - 1];
  if (knn === null || policy === null || last === undefined) return 'js ms: — (scan first)';
  return (
    `js ms median/p90, n=${knn.n}, ${last.shots} shots: knn ${knn.median.toFixed(2)}/${knn.p90.toFixed(2)} · ` +
    `policy+stability ${policy.median.toFixed(2)}/${policy.p90.toFixed(2)}`
  );
}

/** Frame-vs-JPEG agreement and JPEG size over the shots captured since launch (ARCHITECTURE.md §4, NFR-08). */
export function describeEnrollmentMeasurements(measurements: readonly ShotMeasurement[]): string {
  const agreement = summarize(measurements.map((m) => m.agreement));
  const bytes = summarize(measurements.map((m) => m.bytes));
  if (agreement === null || bytes === null) return 'enrollment shots this session: none yet (enroll first; lost on relaunch)';
  const min = Math.min(...measurements.map((m) => m.agreement));
  return (
    `enrollment shots this session n=${agreement.n}: frame-vs-JPEG dot min ${min.toFixed(4)} · ` +
    `median ${agreement.median.toFixed(4)} · JPEG median ${(bytes.median / 1024).toFixed(1)} KB, max ${(bytes.max / 1024).toFixed(1)} KB`
  );
}

function fixed(value: number | null | undefined, digits = 4): string {
  return value === null || value === undefined ? '—' : value.toFixed(digits);
}
