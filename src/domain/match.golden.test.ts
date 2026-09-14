// Golden replay — ADR-012, PHASE_1_PLAN.md P1-1.
//
// Runs the Phase 1 matching policy over the Phase 0 labeled dataset and requires it to
// reproduce the numbers that passed the gate. If this policy disagrees with the one that
// passed, this policy is wrong.
//
// The dataset is gitignored (9.6 MB). Without it this test FAILS rather than skips: a
// skipped regression test reads as a passing one.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { buildIndex, KNN_LIMIT, nearestShots } from './knn.ts';
import { decide, rankProducts, type Decision, type ShotMatch } from './match.ts';
import { dot } from './vector.ts';

const DATASET = 'spike-dataset-20260913-233955.labeled.json';
const DATASET_PATH = join(import.meta.dirname, '..', '..', 'spike', 'results', DATASET);

/** The Phase 0 calibration (ARCHITECTURE.md §6). A test fixture — the app reads app_meta (TR-35). */
const PHASE_0_THRESHOLDS = { tau: 0.46, delta: 0.075 };

interface LabeledDataset {
  shots: { label: string; vector: number[] }[];
  frames: { trueLabel: string; vector: number[] }[];
}

function loadDataset(): LabeledDataset {
  if (!existsSync(DATASET_PATH)) {
    throw new Error(
      `Golden replay needs spike/results/${DATASET}, which is gitignored. ` +
        'Restore spike/results/ from backup (docs/PHASE_1_PLAN.md §2). ' +
        'This test fails instead of skipping on purpose (ADR-012).',
    );
  }
  return JSON.parse(readFileSync(DATASET_PATH, 'utf8')) as LabeledDataset;
}

type Tally = Record<Decision['kind'], number>;

test('Phase 0 golden replay: the Phase 1 policy reproduces the gate result at τ 0.46 / δ 0.075', () => {
  const { shots, frames } = loadDataset();

  // Search exactly as the app does (ADR-014): shots stored as Float32 in one matrix, inline loop,
  // top 10. The Phase 0 vectors are float64 JSON, so this also proves Float32 storage does not
  // move a single decision.
  const index = buildIndex(
    shots[0]!.vector.length,
    shots.map((s, i) => ({ shotId: `shot-${i}`, productId: s.label, vector: s.vector })),
  );

  let positives = 0;
  let negatives = 0;
  let top1 = 0;
  let correctAccepts = 0;
  const wrongAccepts: string[] = [];
  const onEnrolled: Tally = { accept: 0, disambiguate: 0, unknown: 0 };
  const onUnenrolled: Tally = { accept: 0, disambiguate: 0, unknown: 0 };

  for (const frame of frames) {
    if (frame.trueLabel.startsWith('ambiguous:')) continue; // L-01 / L-02, excluded from the gate

    const ranked = rankProducts(nearestShots(index, frame.vector, KNN_LIMIT));

    // Keeping only the top 10 (TR-30) is safe only if it never changes top-1 or top-2. With ≤ 6
    // shots per product it cannot — checked against a full float64 ranking of every shot.
    const full = rankProducts(shots.map((s): ShotMatch => ({ productId: s.label, similarity: dot(frame.vector, s.vector) })));
    assert.deepEqual(
      ranked.slice(0, 2).map((p) => p.productId),
      full.slice(0, 2).map((p) => p.productId),
    );

    const decision = decide(ranked, PHASE_0_THRESHOLDS);

    if (frame.trueLabel.startsWith('unknown:')) {
      negatives++;
      onUnenrolled[decision.kind]++;
      if (decision.kind === 'accept') wrongAccepts.push(`${frame.trueLabel} → ${decision.product.productId}`);
      continue;
    }

    positives++;
    onEnrolled[decision.kind]++;
    if (ranked[0]?.productId === frame.trueLabel) top1++;
    if (decision.kind === 'accept') {
      if (decision.product.productId === frame.trueLabel) correctAccepts++;
      else wrongAccepts.push(`${frame.trueLabel} → ${decision.product.productId}`);
    }
  }

  // The frame set the gate was scored on (PROJECT_STATUS.md, "Measured results").
  assert.equal(positives, 91, 'gated enrolled frames');
  assert.equal(negatives, 105, 'un-enrolled frames');

  // Phase 0 gate: top-1 94.5%.
  assert.equal(top1, 86, 'top-1 on gated products');

  // NFR-01 / NFR-02 / NFR-03 at τ/δ, as recorded.
  assert.equal(correctAccepts, 68, 'correct accepts');
  assert.deepEqual(onEnrolled, { accept: 68, disambiguate: 19, unknown: 4 });
  assert.deepEqual(onUnenrolled, { accept: 3, disambiguate: 50, unknown: 52 });
  assert.equal(wrongAccepts.length, 3, `false accepts: ${wrongAccepts.join('; ')}`);
  for (const wrong of wrongAccepts) {
    assert.match(wrong, / → datu-puti-bottle-vinegar-385ml$/, 'all Phase 0 false accepts were Zonrox → Datu Puti');
  }
});
