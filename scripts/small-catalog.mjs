#!/usr/bin/env node
// Small-catalog simulation. How often does the τ/δ policy quote a price for an item the store
// never enrolled, when the store has enrolled only a few products (SR-44's "first five")?
//
// Runs on the laptop, no device needed:
//   node scripts/small-catalog.mjs spike/results/spike-dataset-20260913-233955.labeled.json
//
// Method: enroll a random N of the Phase 0 catalog's products. Everything else is un-enrolled —
// the `unknown:` frames AND the frames of catalog products left out of the subset. Every number is
// per frame, before the 3-of-5 stability gate (TR-36), and comes from one counter, one lighting
// setup and one phone (Infinix X6823). Treat it as a simulation on Phase 0 data, not a store
// measurement. Deterministic: fixed seeds, so the numbers in ARCHITECTURE.md §6 reproduce.

import { readFileSync } from 'node:fs';

const TAU = 0.46; // Phase 0 calibration, ARCHITECTURE.md §6 — fixture, the app reads app_meta (TR-35)
const DELTA = 0.075;
const FP_CEILING = 0.02; // NFR-02
const SIZES = [1, 2, 3, 5, 10, 15, 25];
const TRIALS = 500;

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/small-catalog.mjs path/to/spike-dataset.labeled.json');
  process.exit(1);
}
const data = JSON.parse(readFileSync(path, 'utf8'));

const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};
/** Brand family, so sibling SKUs (Dove pink / blue, the Zonrox sizes) stay on one side of a split. */
const family = (label) => label.replace(/^unknown:/, '').split('-')[0].replace('datuputi', 'datu');

const catalog = [...new Set(data.shots.map((s) => s.label))].sort();
const frames = data.frames.filter((f) => !f.trueLabel.startsWith('ambiguous:')); // L-01 / L-02
const unknownProducts = [...new Set(frames.map((f) => f.trueLabel).filter((l) => l.startsWith('unknown:')))].sort();
const unknownFamilies = [...new Set(unknownProducts.map(family))].sort();

// Per frame: best shot score for every catalog product (TR-31), and best score against every
// OTHER frame of each un-enrolled product — those frames stand in for a distractor bank's shots.
const scored = frames.map((frame, i) => {
  const best = {};
  for (const s of data.shots) {
    const v = dot(frame.vector, s.vector);
    if (!(s.label in best) || v > best[s.label]) best[s.label] = v;
  }
  const bank = {};
  frames.forEach((other, j) => {
    if (j === i || !other.trueLabel.startsWith('unknown:')) return;
    const v = dot(frame.vector, other.vector);
    if (!(other.trueLabel in bank) || v > bank[other.trueLabel]) bank[other.trueLabel] = v;
  });
  return { label: frame.trueLabel, best, bank };
});

function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}
function shuffled(items, rand) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The catalogs tried at size N — all 25 singletons, the full catalog once, else TRIALS draws. */
function catalogsOfSize(n) {
  if (n === 1) return catalog.map((c) => [c]);
  if (n === catalog.length) return [catalog];
  const rand = rng(1000 + n);
  return Array.from({ length: TRIALS }, () => shuffled(catalog, rand).slice(0, n));
}

/** TR-32–TR-34, plus the two variants under test. Returns the accepted productId, or null. */
function accepted(frame, enrolled, { tau = TAU, loneFloor = null, bank = null }) {
  const cands = enrolled.map((id) => [id, frame.best[id]]);
  if (bank) for (const u of bank) if (u in frame.bank) cands.push([u, frame.bank[u]]);
  cands.sort((a, b) => b[1] - a[1]);
  const [first, second] = cands;
  if (first[1] < tau) return null; // UNKNOWN
  if (bank?.has(first[0])) return null; // a bank item won → UNKNOWN
  if (!second) return loneFloor !== null && first[1] < loneFloor ? null : first[0];
  if (first[1] - second[1] < DELTA) return null; // DISAMBIGUATE
  return first[0];
}

function simulate(n, opts = {}) {
  const t = { neg: 0, negAccepted: 0, sibling: 0, pos: 0, posCorrect: 0, pairs: new Map() };
  catalogsOfSize(n).forEach((enrolled, trial) => {
    const inCatalog = new Set(enrolled);
    let bank = null;
    if (opts.bank) {
      // Half the un-enrolled FAMILIES become the bank; the other half stay as test items.
      const fams = new Set(shuffled(unknownFamilies, rng(5000 + trial)).slice(0, unknownFamilies.length >> 1));
      bank = new Set(unknownProducts.filter((u) => fams.has(family(u))));
    }
    for (const frame of scored) {
      if (bank?.has(frame.label)) continue;
      const got = accepted(frame, enrolled, { ...opts, bank });
      if (inCatalog.has(frame.label)) {
        t.pos++;
        if (got === frame.label) t.posCorrect++;
        continue;
      }
      t.neg++;
      if (got === null) continue;
      t.negAccepted++;
      if (family(frame.label) === family(got)) t.sibling++;
      const key = `${frame.label} → ${got}`;
      t.pairs.set(key, (t.pairs.get(key) ?? 0) + 1);
    }
  });
  return t;
}

const pct = (a, b) => `${((100 * a) / b).toFixed(1)}%`.padStart(6);
const row = (n, t) =>
  `  N=${String(n).padStart(2)}   un-enrolled accepted ${pct(t.negAccepted, t.neg)}` +
  `  (sibling SKU ${pct(t.sibling, Math.max(t.negAccepted, 1))})   correct accepts ${pct(t.posCorrect, t.pos)}`;

console.log(`Phase 0 data: ${catalog.length} catalog products, ${frames.length} non-ambiguous frames, ` +
  `${unknownProducts.length} un-enrolled products. τ ${TAU} / δ ${DELTA}. Per frame, before TR-36.`);
console.log('"un-enrolled accepted" = un-enrolled frames auto-ACCEPTed as some enrolled product (a wrong price).');

const variants = [
  ['A. Current policy', {}],
  ['B. Lone candidate must also clear 0.60', { loneFloor: 0.6 }],
  ['C. Hidden distractor bank (half the un-enrolled brand families; the rest are test items)', { bank: true }],
];
for (const [name, opts] of variants) {
  console.log(`\n${name}`);
  for (const n of SIZES) console.log(row(n, simulate(n, opts)));
}

console.log(`\nD. Smallest τ holding un-enrolled accepts ≤ ${FP_CEILING * 100}% at each size (δ ${DELTA})`);
for (const n of SIZES) {
  for (let tau = TAU; tau <= 0.9; tau = Math.round((tau + 0.01) * 100) / 100) {
    const t = simulate(n, { tau });
    if (t.negAccepted / t.neg <= FP_CEILING) {
      console.log(`${row(n, t)}   at τ ${tau.toFixed(2)}`);
      break;
    }
  }
}

console.log('\nMost frequent false accepts, current policy, N=5 (count across all trials)');
const top = [...simulate(5).pairs].sort((a, b) => b[1] - a[1]).slice(0, 8);
for (const [pair, count] of top) console.log(`  ${String(count).padStart(5)}  ${pair}`);
