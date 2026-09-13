#!/usr/bin/env node
// Phase 0 offline analysis. Reads the dataset exported from the device and
// answers the gate question: does MobileNetV3 separate real sari-sari SKUs?
//
// Runs on the laptop, no device needed:
//   node scripts/analyze.mjs path/to/spike-dataset.json
//
// It reports top-1 / top-3 accuracy, the score distributions that τ and δ are
// read off, and a sweep that picks the (τ, δ) pair maximising recall subject to
// the NFR-02 false-positive ceiling. NFR-02 outranks NFR-01 — the sweep never
// trades precision for accuracy.

import { readFileSync } from 'node:fs';

const FP_CEILING = 0.02; // NFR-02: ≤ 2% confidently-wrong
const TOP1_GATE = 0.85; // Phase 0 gate: ≥ 85% top-1 on non-ambiguous items
const REJECTION_TARGET = 0.85; // NFR-03: ≥ 85% correct "Unknown" on un-enrolled items

/** Labels prefixed `ambiguous:` are L-01/L-02 cases, excluded from the gate. */
const AMBIGUOUS_PREFIX = 'ambiguous:';

/**
 * Labels prefixed `unknown:` are un-enrolled products recorded deliberately
 * (runbook A-4) so that rejection can be measured at all. They are NEVER
 * ranking failures — no enrolled label can match them — so they are scored
 * against NFR-03 and kept out of the top-1 denominator.
 */
const UNKNOWN_PREFIX = 'unknown:';

function dot(a, b) {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += a[i] * b[i];
  return sum;
}

function rankProducts(query, shots) {
  const best = new Map();
  for (const shot of shots) {
    const score = dot(query, shot.vector);
    const prev = best.get(shot.label);
    if (prev === undefined || score > prev) best.set(shot.label, score);
  }
  return [...best.entries()]
    .map(([label, score]) => ({ label, score }))
    .sort((a, b) => b.score - a.score);
}

function decide(ranked, tau, delta) {
  const first = ranked[0];
  if (first === undefined) return { kind: 'unknown' };
  if (first.score < tau) return { kind: 'unknown' };
  const second = ranked[1];
  if (second !== undefined && first.score - second.score < delta) {
    return { kind: 'disambiguate', first, second };
  }
  return { kind: 'accept', label: first.label };
}

function quantile(sorted, q) {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function histogram(values, bins = 20, lo = -1, hi = 1) {
  if (values.length === 0) return '  (no samples)';
  const counts = new Array(bins).fill(0);
  for (const v of values) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor(((v - lo) / (hi - lo)) * bins)));
    counts[idx]++;
  }
  const peak = Math.max(...counts);
  return counts
    .map((c, i) => {
      const from = (lo + ((hi - lo) * i) / bins).toFixed(2);
      const bar = '█'.repeat(peak === 0 ? 0 : Math.round((c / peak) * 40));
      return `  ${from.padStart(6)}  ${String(c).padStart(4)}  ${bar}`;
    })
    .join('\n');
}

function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/analyze.mjs <spike-dataset.json>');
  process.exit(1);
}

const data = JSON.parse(readFileSync(path, 'utf8'));
const shots = data.shots ?? [];
const frames = data.frames ?? [];

if (shots.length === 0 || frames.length === 0) {
  console.error(`Dataset has ${shots.length} shots and ${frames.length} frames — nothing to score.`);
  process.exit(1);
}

const products = [...new Set(shots.map((s) => s.label))];
const scored = frames.filter((f) => !f.trueLabel.startsWith(AMBIGUOUS_PREFIX));
const negatives = scored.filter((f) => f.trueLabel.startsWith(UNKNOWN_PREFIX));
const positives = scored.filter((f) => !f.trueLabel.startsWith(UNKNOWN_PREFIX));

// A frame label that matches no enrolled product can only score as a miss, so a
// typo in collect mode silently lowers top-1. Surface them before any numbers.
const enrolled = new Set(products);
const orphans = new Map();
for (const f of frames) {
  if (f.trueLabel.startsWith(UNKNOWN_PREFIX)) continue;
  const label = f.trueLabel.startsWith(AMBIGUOUS_PREFIX)
    ? f.trueLabel.slice(AMBIGUOUS_PREFIX.length)
    : f.trueLabel;
  if (!enrolled.has(label)) orphans.set(f.trueLabel, (orphans.get(f.trueLabel) ?? 0) + 1);
}
if (orphans.size > 0) {
  console.warn('WARNING: test-frame labels with no enrolled product (typo? deleted product?):');
  for (const [label, n] of orphans) console.warn(`  ${String(n).padStart(3)}×  "${label}"`);
  console.warn('Non-ambiguous frames among these score as misses. Fix the labels in the JSON and re-run.\n');
}

if (positives.length === 0) {
  console.error('No enrolled-product test frames to score — every frame is ambiguous: or unknown:.');
  process.exit(1);
}

// Rank each frame exactly once. The τ/δ sweep below tries ~4200 pairs; ranking
// inside that loop would redo tens of billions of multiply-adds on a real
// 100-frame / 80-shot / 1280-d dataset.
const rankedOf = new Map(scored.map((f) => [f, rankProducts(f.vector, shots)]));

console.log('='.repeat(72));
console.log('BantayNiMama — Phase 0 embedding viability analysis');
console.log('='.repeat(72));
console.log(`model        ${data.modelId}`);
console.log(`device       ${data.device}`);
console.log(`dimension    ${data.dim}`);
console.log(`products     ${products.length}  (${shots.length} reference shots)`);
console.log(
  `test frames  ${frames.length}  (${positives.length} enrolled · ` +
    `${negatives.length} unknown-negatives · ` +
    `${frames.length - scored.length} ambiguous, excluded)`,
);

const latencies = frames.map((f) => f.elapsedMs).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
if (latencies.length > 0) {
  console.log(
    `latency      median ${quantile(latencies, 0.5).toFixed(1)} ms · ` +
      `p90 ${quantile(latencies, 0.9).toFixed(1)} ms · ` +
      `max ${latencies[latencies.length - 1].toFixed(1)} ms  ` +
      `(crop+resize+inference, measured in-worklet on ${data.device})`,
  );
}

// --- Ranking accuracy, independent of any threshold ------------------------

let top1 = 0;
let top3 = 0;
const correctScores = [];
const wrongScores = [];
const margins = [];
const confusions = new Map();

for (const frame of positives) {
  const ranked = rankedOf.get(frame);
  const first = ranked[0];
  if (first === undefined) continue;

  if (first.label === frame.trueLabel) {
    top1++;
    correctScores.push(first.score);
  } else {
    wrongScores.push(first.score);
    const key = `${frame.trueLabel} → ${first.label}`;
    confusions.set(key, (confusions.get(key) ?? 0) + 1);
  }
  if (ranked.slice(0, 3).some((c) => c.label === frame.trueLabel)) top3++;
  if (ranked[1] !== undefined) margins.push(first.score - ranked[1].score);
}

const top1Acc = top1 / positives.length;
const top3Acc = top3 / positives.length;

console.log('\n' + '-'.repeat(72));
console.log('Ranking accuracy (enrolled products only, no threshold applied)');
console.log('-'.repeat(72));
console.log(`top-1        ${pct(top1Acc)}   (${top1}/${positives.length})`);
console.log(`top-3        ${pct(top3Acc)}   (${top3}/${positives.length})`);

console.log('\nTop-1 similarity when CORRECT:');
console.log(histogram(correctScores));
const cs = [...correctScores].sort((a, b) => a - b);
if (cs.length > 0) {
  console.log(`  p05 ${quantile(cs, 0.05).toFixed(4)} · median ${quantile(cs, 0.5).toFixed(4)} · p95 ${quantile(cs, 0.95).toFixed(4)}`);
}

console.log('\nTop-1 similarity when WRONG (these are what τ must exclude):');
console.log(histogram(wrongScores));
const ws = [...wrongScores].sort((a, b) => a - b);
if (ws.length > 0) {
  console.log(`  p05 ${quantile(ws, 0.05).toFixed(4)} · median ${quantile(ws, 0.5).toFixed(4)} · p95 ${quantile(ws, 0.95).toFixed(4)}`);
}

if (confusions.size > 0) {
  console.log('\nMost frequent confusions:');
  [...confusions.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([pair, n]) => console.log(`  ${String(n).padStart(3)}×  ${pair}`));
}

// --- τ / δ sweep -----------------------------------------------------------
// Precision first: only pairs whose false-positive rate clears NFR-02 are
// eligible, and among those we take the one that accepts the most frames.

console.log('\n' + '-'.repeat(72));
console.log(`τ / δ sweep — maximise accepts subject to FP ≤ ${pct(FP_CEILING)} (NFR-02)`);
console.log('-'.repeat(72));

const scoredTotal = positives.length + negatives.length;

let best = null;
for (let tau = 0.3; tau <= 0.98; tau += 0.01) {
  for (let delta = 0.0; delta <= 0.3; delta += 0.005) {
    let accepted = 0;
    let correctAccepts = 0;
    let wrongAccepts = 0;
    for (const frame of positives) {
      const d = decide(rankedOf.get(frame), tau, delta);
      if (d.kind !== 'accept') continue;
      accepted++;
      if (d.label === frame.trueLabel) correctAccepts++;
      else wrongAccepts++;
    }
    // Accepting an un-enrolled product is the worst false positive there is:
    // a confident price for something not in the catalog. It counts against
    // NFR-02 exactly like naming the wrong product.
    let rejected = 0;
    for (const frame of negatives) {
      const d = decide(rankedOf.get(frame), tau, delta);
      if (d.kind === 'accept') {
        accepted++;
        wrongAccepts++;
      } else {
        rejected++;
      }
    }
    const fpRate = wrongAccepts / scoredTotal;
    if (fpRate > FP_CEILING) continue;
    const recall = correctAccepts / positives.length;
    if (best === null || recall > best.recall) {
      best = { tau, delta, recall, fpRate, accepted, correctAccepts, wrongAccepts, rejected };
    }
  }
}

if (best === null) {
  console.log('No (τ, δ) pair keeps the false-positive rate under the NFR-02 ceiling.');
  console.log('That is a real signal, not a bug: at this catalog the embeddings do not separate.');
} else {
  console.log(`τ = ${best.tau.toFixed(2)}`);
  console.log(`δ = ${best.delta.toFixed(3)}`);
  console.log(
    `  correct accepts   ${pct(best.recall)}  (${best.correctAccepts}/${positives.length} enrolled)` +
      `  NFR-01 target ≥ 90%`,
  );
  console.log(
    `  false positives   ${pct(best.fpRate)}  (${best.wrongAccepts}/${scoredTotal} scored)` +
      `  NFR-02 ceiling ${pct(FP_CEILING)}`,
  );
  if (negatives.length > 0) {
    const rejRate = best.rejected / negatives.length;
    console.log(
      `  unknown rejection ${pct(rejRate)}  (${best.rejected}/${negatives.length} un-enrolled)` +
        `  NFR-03 target ≥ ${pct(REJECTION_TARGET)}` +
        `${rejRate >= REJECTION_TARGET ? '' : '  ← MISSED'}`,
    );
  } else {
    console.log(
      '  unknown rejection  NOT MEASURED — dataset has no `unknown:` frames. ' +
        'NFR-03 is unproven; see runbook A-4.',
    );
  }
  console.log(`  deferred to disambiguate/unknown  ${pct(1 - best.accepted / scoredTotal)}`);
  console.log('\nWrite these into app_meta in Phase 1 (TR-35, ADR-008) — never as constants.');
}

// --- Gate ------------------------------------------------------------------

console.log('\n' + '='.repeat(72));
const passed = top1Acc >= TOP1_GATE;
console.log(
  `PHASE 0 GATE: top-1 ≥ ${pct(TOP1_GATE)} on enrolled, non-ambiguous items → ` +
    `${pct(top1Acc)} → ${passed ? 'PASS' : 'FAIL'}`,
);
console.log('='.repeat(72));
if (!passed) {
  console.log('\nPer PROJECT_STATUS.md, do not start Phase 1. In order:');
  console.log('  1. Tighten reticle guidance and re-shoot — framing beats model choice.');
  console.log('  2. Try MobileCLIP via react-native-executorch.');
  console.log('  3. Reconsider the product thesis.');
}
process.exit(passed ? 0 : 1);
