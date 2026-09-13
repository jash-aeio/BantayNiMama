#!/usr/bin/env node
// Phase 0 ground-truth corrections for test-frame labels, applied on the laptop.
//
// Collect-mode labels are typed by hand on the phone, and the app cannot edit an
// old frame (undo reaches only the latest one). Corrections therefore live here,
// in the repo, so every change to ground truth is reviewable. The input file is
// never modified.
//
//   node scripts/relabel.mjs <spike-dataset.json> <out.json>
//
// Only correct OPERATOR mistakes. Never add a rule because a frame scored wrong —
// that inflates top-1 and hides false positives (runbook A-4, NFR-02).
//
// Idempotent: already-prefixed labels are left alone, so the same rules can be
// re-applied to a later export of the same phone dataset.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Rules decided 2026-09-13, before any analysis was run on the store dataset.

/** Un-enrolled products recorded for NFR-03; the operator forgot the prefix. */
const UNKNOWN = [
  'ajinomoto-salt-11g',
  'alaska-evaporada-360ml',
  'century-tuna-flakesinoil-canned',
  'century-tuna-hotandspicy-canned',
  'cowbell-evapsarap-360ml',
  'linga-budget-pack',
  'magic-sarap-55g',
  'magic-sarap-8g',
  'mamasitas-brown-oystersauce-90g',
  'mamasitas-red-oystersauce-30g',
  'mamasitas-red-oystersauce-60g',
  'mangtomas-siga-325g',
  'margarine-budget-pack',
  'nescafe-classic-20g',
  'silka-herbalsoap-green-65g',
  'tuyo-pack-25p',
  'zonrox-blossomfresh-225ml',
  'zonrox-blossomfresh-450ml',
  'zonrox-original-250ml',
  'zonrox-original-450ml',
  // Enrolled in the first 26-product catalog, removed before collection finished.
  // A clear-bag repack beside the monggo repacks: a hard negative, deliberately kept.
  'oil-pack-5p',
];

/**
 * Same product, different size (L-02). The sugar-free twin pack was replaced by
 * the true twin pack of the solo, so this pair falls under the size-family rule.
 */
const AMBIGUOUS = ['nescafe-creamywhite-solo-pack-20g', 'nescafe-creamywhite-twin-pack-40g'];

/** Typo in collect mode: the enrolled label is the 59g pack. */
const RENAME = new Map([
  [
    'nissin-ramen-spicyseafood-instant-noodles-packed-55g',
    'nissin-ramen-spicyseafood-instant-noodles-packed-59g',
  ],
]);

/**
 * Dropped, not relabelled. A burst of 4 frames under the Dove pink label that the
 * operator could not confirm as eggs; guessing the label from the model's own
 * top match would score them correct by construction. Egg is to be re-collected.
 */
const DROP = [
  {
    label: 'dove-shampoo-pink-sachet',
    from: Date.parse('2026-09-13T06:21:30Z'), // 14:21:30 PHT
    to: Date.parse('2026-09-13T06:21:45Z'),
    expect: 4,
  },
];

// ---------------------------------------------------------------------------

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node scripts/relabel.mjs <spike-dataset.json> <out.json>');
  process.exit(1);
}
if (resolve(input) === resolve(output)) {
  console.error('Refusing to overwrite the input — the phone backup is the raw record.');
  process.exit(1);
}

const data = JSON.parse(readFileSync(input, 'utf8'));
const counts = new Map();
const bump = (key) => counts.set(key, (counts.get(key) ?? 0) + 1);

const kept = data.frames.filter((f) => {
  const rule = DROP.find((r) => f.trueLabel === r.label && f.at >= r.from && f.at <= r.to);
  if (rule) bump(`drop       ${rule.label}`);
  return !rule;
});

for (const f of kept) {
  if (RENAME.has(f.trueLabel)) {
    bump(`rename     ${f.trueLabel} → ${RENAME.get(f.trueLabel)}`);
    f.trueLabel = RENAME.get(f.trueLabel);
  } else if (UNKNOWN.includes(f.trueLabel)) {
    bump(`unknown:   ${f.trueLabel}`);
    f.trueLabel = `unknown:${f.trueLabel}`;
  } else if (AMBIGUOUS.includes(f.trueLabel)) {
    bump(`ambiguous: ${f.trueLabel}`);
    f.trueLabel = `ambiguous:${f.trueLabel}`;
  }
}

for (const rule of DROP) {
  const n = counts.get(`drop       ${rule.label}`) ?? 0;
  if (n !== rule.expect) {
    console.error(`DROP rule for ${rule.label} matched ${n} frames, expected ${rule.expect}. Nothing written.`);
    process.exit(1);
  }
}

writeFileSync(output, JSON.stringify({ ...data, frames: kept }));
for (const [rule, n] of [...counts].sort()) console.log(`${String(n).padStart(3)}×  ${rule}`);
console.log(`\nframes ${data.frames.length} → ${kept.length}  written to ${output}`);
