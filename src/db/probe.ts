import { open } from '@op-engineering/op-sqlite';

import { rankProducts, type ShotMatch } from '../domain/match.ts';
import { dot } from '../domain/vector.ts';
import { openDatabase } from './open';

// P1-2 checkpoint, second build (docs/PHASE_1_PLAN.md). op-sqlite's bundled sqlite-vec cannot
// load on 32-bit ARM, so it is switched off. This build measures what the choice between
// "build sqlite-vec ourselves" and "search in JS" needs:
//   1. Plain SQLite opens bantay.db in documentDirectory.
//   2. A Float32Array survives a BLOB round trip bit for bit — the JS-search storage format —
//      and how long reading 2,500 vector BLOBs takes.
//   3. How long brute-force nearest-neighbour search in JS takes at 100 vectors (Phase 1's 20
//      products) and 2,500 (NFR-09's 500 products).
// Remove once the decision is made and schema v1 lands.

const DIM = 1280;
const SHOTS_PER_PRODUCT = 5; // TR-42
const RUNS = 11; // the first run is a warm-up and is not counted

type Step = { ok: true; detail: string } | { ok: false; error: string };

export interface DbProbe {
  open: Step;
  blob: Step;
  knn100: Step;
  knn2500: Step;
  knn2500DomainDot: Step;
}

export function probeDatabase(): DbProbe {
  return {
    open: step(() => {
      const db = openDatabase();
      try {
        const row = db.executeSync('select sqlite_version() as sqlite').rows[0];
        return `SQLite ${String(row?.sqlite)} · ${db.getDbPath()}`;
      } finally {
        db.close();
      }
    }),
    blob: step(probeBlobs),
    knn100: step(() => benchKnn(100, 'inline')),
    knn2500: step(() => benchKnn(2500, 'inline')),
    knn2500DomainDot: step(() => benchKnn(2500, 'domain-dot')),
  };
}

/** In memory, so the checkpoint leaves nothing behind in bantay.db. */
function probeBlobs(): string {
  const db = open({ name: 'probe', location: ':memory:' });
  try {
    const rng = mulberry32(1);
    db.executeSync('create table shots (id integer primary key, embedding blob not null)');

    const original = randomUnitVector(rng);
    // `as ArrayBuffer`: TypeScript types .buffer as ArrayBufferLike (it could be a
    // SharedArrayBuffer), which op-sqlite's Scalar rejects. A `new Float32Array(n)` always owns a
    // plain ArrayBuffer at offset 0, so the cast is exact.
    db.executeSync('insert into shots (embedding) values (?)', [original.buffer as ArrayBuffer]);
    const back = toFloat32(db.executeSync('select embedding from shots').rows[0]?.embedding);
    const exact = back.length === DIM && back.every((x, i) => x === original[i]);
    if (!exact) throw new Error(`BLOB round trip changed the vector (length ${back.length})`);

    db.executeSync('begin');
    for (let i = 1; i < 2500; i++) {
      db.executeSync('insert into shots (embedding) values (?)', [randomUnitVector(rng).buffer as ArrayBuffer]);
    }
    db.executeSync('commit');

    const t0 = performance.now();
    const rows = db.executeSync('select embedding from shots').rows;
    const readMs = performance.now() - t0;
    return `round trip bit-exact · read ${rows.length} × ${DIM}-d BLOBs in ${readMs.toFixed(1)} ms`;
  } finally {
    db.close();
  }
}

/**
 * Brute-force KNN the way a JS implementation would run per frame: score every shot, keep the
 * top 10 (TR-30), aggregate to products (TR-31). "inline" is a hand-written loop over one
 * contiguous matrix; "domain-dot" calls src/domain's dot() per shot, to price the abstraction.
 */
function benchKnn(shots: number, variant: 'inline' | 'domain-dot'): string {
  const rng = mulberry32(shots);
  const matrix = new Float32Array(shots * DIM);
  for (let s = 0; s < shots; s++) matrix.set(randomUnitVector(rng), s * DIM);
  const productOf = Array.from({ length: shots }, (_, s) => `p${Math.floor(s / SHOTS_PER_PRODUCT)}`);
  const query = randomUnitVector(rng);

  const times: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    const t0 = performance.now();
    const rows: ShotMatch[] = new Array(shots);
    for (let s = 0; s < shots; s++) {
      const base = s * DIM;
      let similarity: number;
      if (variant === 'inline') {
        similarity = 0;
        for (let d = 0; d < DIM; d++) similarity += matrix[base + d]! * query[d]!;
      } else {
        similarity = dot(matrix.subarray(base, base + DIM), query);
      }
      rows[s] = { productId: productOf[s]!, similarity };
    }
    rows.sort((a, b) => b.similarity - a.similarity);
    rankProducts(rows.slice(0, 10));
    if (run > 0) times.push(performance.now() - t0);
  }

  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)]!;
  const p90 = times[Math.ceil(times.length * 0.9) - 1]!;
  return `median ${median.toFixed(1)} ms · p90 ${p90.toFixed(1)} · max ${times[times.length - 1]!.toFixed(1)} (n=${times.length})`;
}

function toFloat32(value: unknown): Float32Array {
  if (value instanceof ArrayBuffer) return new Float32Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Float32Array(value.buffer, value.byteOffset, value.byteLength / Float32Array.BYTES_PER_ELEMENT);
  }
  throw new Error(`Expected a BLOB, got ${typeof value}`);
}

function randomUnitVector(rng: () => number): Float32Array {
  const v = new Float32Array(DIM);
  let sumSq = 0;
  for (let i = 0; i < DIM; i++) {
    v[i] = rng() * 2 - 1;
    sumSq += v[i]! * v[i]!;
  }
  const norm = Math.sqrt(sumSq);
  for (let i = 0; i < DIM; i++) v[i] = v[i]! / norm;
  return v;
}

/** Small deterministic PRNG, so every run benchmarks the same vectors. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function step(run: () => string): Step {
  try {
    return { ok: true, detail: run() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function describeProbe(probe: DbProbe): string {
  const line = (name: string, s: Step) => `${s.ok ? 'OK  ' : 'FAIL'} ${name}: ${s.ok ? s.detail : s.error}`;
  return [
    line('open bantay.db', probe.open),
    line('vector BLOBs', probe.blob),
    line('JS KNN 100 shots', probe.knn100),
    line('JS KNN 2,500 shots', probe.knn2500),
    line('JS KNN 2,500 via domain dot()', probe.knn2500DomainDot),
  ].join('\n');
}
