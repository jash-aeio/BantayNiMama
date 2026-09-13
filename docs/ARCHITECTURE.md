# BantayNiMama — Architecture

> **Last updated:** 2026-09-14 · **Schema version:** 1 · **Model:** `mobilenet_v3_large_embedder_v1`
>
> **Stack:** Expo SDK 57 / RN 0.86.3 (ADR-009) · VisionCamera v5.2.3 · react-native-fast-tflite v3.0.1 ·
> op-sqlite 18.2.1, plain SQLite *(sqlite-vec off: its 32-bit ARM build cannot load — ADR-014)*
>
> **Claude: update this document whenever you change the data model, the pipeline, the matching
> policy, or a core dependency.** See [`../CLAUDE.md`](../CLAUDE.md).

---

## 1. System Overview

```
┌──────────────────────────────────────────────────────────────┐
│                     BantayNiMama (device)                    │
│                                                              │
│   ┌────────────┐        ┌────────────┐                       │
│   │  Scanner   │        │ Directory  │   expo-router tabs    │
│   │   (Tab 1)  │        │  (Tab 2)   │                       │
│   └─────┬──────┘        └─────┬──────┘                       │
│         │                     │                              │
│   ┌─────▼─────────────────────▼──────┐                       │
│   │      Domain layer (pure TS)      │  matching policy,     │
│   │  match.ts · money.ts · stability │  unit-tested, no I/O  │
│   └─────┬─────────────────────┬──────┘                       │
│         │                     │                              │
│   ┌─────▼──────┐        ┌─────▼──────┐                       │
│   │ ML runtime │        │ Repository │                       │
│   │  (worklet) │        │   (SQL)    │                       │
│   └─────┬──────┘        └─────┬──────┘                       │
│         │                     │                              │
│   ┌─────▼──────┐        ┌─────▼────────────────┐             │
│   │  TFLite    │        │ SQLite · BLOB vectors│             │
│   │ MobileNetV3│        │ bantay.db            │             │
│   └────────────┘        └──────────────────────┘             │
│                         ┌──────────────────────┐             │
│                         │ documentDirectory/   │             │
│                         │   photos/*.jpg       │             │
│                         └──────────────────────┘             │
│                                                              │
│   ✗ No network. No backend. No API keys. Ever.               │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Threading Model

This is the most important thing to understand about the codebase.

| Thread | Runs | Must never |
|---|---|---|
| **Camera thread (worklet)** | Frame throttling, sharpness gate, crop/resize, TFLite inference, L2 normalization | Touch React state, call async JS, or query SQLite |
| **JS thread** | Vector search, matching policy, stability buffer, DB reads, enrollment | Run inference on live frames |
| **UI thread** | Overlay rendering via Reanimated shared values | Re-render React on the hot path |

**Rule:** the worklet's only output is a `Float32Array(1280)` posted to the JS thread. Nothing else
crosses that boundary per frame.

---

## 3. Recognition Pipeline

```
[Camera 1280×720 YUV @ 30fps]
         │
╔════════▼═══════════════════ WORKLET (camera thread) ═══════════════════╗
║  1. runAtTargetFps(4)      drop 26 of 30 frames              ~0 ms     ║
║  2. Sharpness gate         Laplacian variance; bail on blur  ~1 ms     ║
║  3. Crop + resize          reticle → 224×224 RGB Float32     1–3 ms    ║
║     via nitro-image        crop() → resize() → toRawPixelData()        ║
║  4. model.runSync()        TFLite forward pass               8–40 ms   ║
║  5. L2-normalize           1280-d unit vector                <0.1 ms   ║
╚════════╤═══════════════════════════════════════════════════════════════╝
         │  post Float32Array(1280)
╔════════▼═══════════════════ JS THREAD ═════════════════════════════════╗
║  6. JS brute-force KNN     inline loop, in-memory matrix     9–234 ms  ║
║  7. Aggregate shots→products   best shot wins per product    <1 ms     ║
║  8. τ/δ policy             ACCEPT | DISAMBIGUATE | UNKNOWN   <1 ms     ║
║  9. Stability ring buffer  require 3-of-5 agreement          <1 ms     ║
║ 10. Fetch name + price     indexed lookup on lock            <1 ms     ║
║ 11. Render overlay         Reanimated shared values          <16 ms    ║
╚════════════════════════════════════════════════════════════════════════╝

Per processed frame:  30–50 ms budget Android · 15–25 ms iOS
CPU duty cycle:       12–20% at 4 fps
Perceived lock:       ~750 ms (3 agreeing frames at 4 fps)
```

### Why 4 fps

`runAtTargetFps(4)` is the single biggest battery and thermal lever in the app (NFR-06). At 30 fps
a budget Android thermally throttles within minutes. At 4 fps, with a 3-of-5 stability gate, a
result still locks in ~750 ms — below the 1.2 s p90 target (NFR-04).

---

## 4. Enrollment Pipeline

Separate path. Quality matters, latency does not, so this runs on the JS thread.

```
Tap "Add"
  → guided capture of 3–5 angles          (SR-20)
  → quality check per frame               (SR-22)  blown out? dark? blurry?
  → save each as 512px q80 JPEG           (TR-42)  documentDirectory/photos/
  → embed each once on the JS thread
  → duplicate check: KNN vs catalog       (SR-23)  match > τ → "Ganito ba ito?"
  → ONE transaction:                      (TR-45)
       INSERT products
       INSERT product_shots  × 3–5   (photo path + embedding BLOB)
  → add the vectors to the in-memory search matrix — only after COMMIT succeeds
  → live on the very next frame           (SR-24)
```

---

## 5. Data Model

Single SQLite file: `documentDirectory/bantay.db`.

**Opening it** (`src/db/open.ts`). op-sqlite is called with the document directory as an explicit,
absolute `location`. With no location it would put the file in Android's `databases/` folder,
which is outside the one-file-plus-`photos/` export layout (`TR-46`). Verified on the Infinix: SQLite
3.51.3 opens `/data/user/0/com.jash.bantaynimama/files/bantay.db` (2026-09-14).

**No sqlite-vec (ADR-014).** op-sqlite's bundled sqlite-vec cannot load on 32-bit ARM: its
`libsqlite_vec.so` calls `ceil` without declaring `libm.so` (op-sqlite#456). So `package.json` has
`"sqliteVec": false`. Each shot's vector is a `Float32Array` stored as a BLOB in `product_shots`,
and that round trip is bit-exact on device. Search runs in JS over an in-memory matrix built from
those rows (§3, §8). A native index can be added later without a data migration, because it is
rebuilt from the BLOBs.

```sql
-- Schema v1, as src/db/schema.ts (migration 1) creates it.
-- "centavos" below means: INTEGER CHECK (col IS NULL OR (typeof(col) = 'integer' AND col >= 0))
-- so SQLite itself rejects a float or negative price (TR-41).

CREATE TABLE products (
  id              TEXT PRIMARY KEY,   -- uuid v4
  name            TEXT NOT NULL CHECK (length(trim(name)) > 0),
  price_piece     INTEGER,            -- centavos (TR-41)
  price_pack      INTEGER,            -- centavos; the "buo" price (SR-06)
  unit_label      TEXT,               -- "sachet", "bote", "piraso"
  category        TEXT,
  is_ambiguous    INTEGER NOT NULL DEFAULT 0 CHECK (is_ambiguous IN (0, 1)),  -- SR-10
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  last_scanned_at INTEGER,
  deleted_at      INTEGER             -- soft delete (SR-32)
);

CREATE TABLE product_shots (
  id         TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  photo_path TEXT NOT NULL,           -- RELATIVE to documentDirectory (TR-43)
  model_id   TEXT NOT NULL,           -- stamp: which model produced this vector (TR-23)
  embedding  BLOB NOT NULL CHECK (typeof(embedding) = 'blob'),
                                      -- little-endian Float32 × embedding_dim, L2-normalized (TR-22, ADR-014)
  created_at INTEGER NOT NULL
);

CREATE TABLE price_history (
  id          TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL REFERENCES products(id),
  price_piece INTEGER,                -- centavos
  price_pack  INTEGER,                -- centavos
  changed_at  INTEGER NOT NULL
);

CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- Created before any migration runs, because schema_version lives in it.
-- schema_version, model_id, embedding_dim, tau, delta; confirm_below once calibrated (TR-38)

CREATE INDEX idx_products_name     ON products(name);
CREATE INDEX idx_products_deleted  ON products(deleted_at);
CREATE INDEX idx_shots_product     ON product_shots(product_id);
```

**How the schema gets there** (`src/db/`, P1-2):

- **Migrations are forward-only (`TR-44`).** `migrate()` plans with `planMigrations`, then runs
  each version in its own transaction together with its `schema_version` bump. A crash therefore
  leaves the database at the last version that fully applied. A database **newer** than the app is
  refused, not opened: an older APK must not guess at tables whose meaning has changed.
- **Seeded once, as data (`TR-35`, ADR-008).** Migration 1 writes the Phase 0 calibration
  (`model_id`, `embedding_dim` 1280, τ 0.46, δ 0.075) into `app_meta`. After that, code only reads
  them. `parseAppMeta` refuses a blank or malformed value, because `Number('')` is 0 and a zero τ
  accepts everything. `confirm_below` is not seeded (`TR-38`).
- **Transactions are synchronous `BEGIN IMMEDIATE … COMMIT`.** Because it runs through
  `executeSync`, nothing else on the JS thread can interleave with a half-written enrollment.
  `insertProductWithShots` validates everything before `BEGIN`: centavos, 3–5 shots, relative
  paths, dimension, unit length.
- **Per connection:** `PRAGMA foreign_keys = ON`. The default journal mode stays, because WAL's
  `-wal` / `-shm` side files would break the one-file layout (`TR-46`).

### Invariants

1. **Money is integer centavos.** ₱12.50 is `1250`. Floats are forbidden for currency (TR-41).
2. **Every vector is stamped with its `model_id`.** Swapping models means re-embedding every stored
   JPEG. This is why the JPEGs are never discarded (TR-24).
3. **Photo paths are relative.** iOS rewrites the container path on every app update; absolute paths
   break silently after an upgrade (TR-43).
4. **One product owns 3–5 vectors**, one per shot. Matching aggregates shots → products.
5. **Enrollment is one transaction.** A half-written product with vectors but no metadata will
   produce confident matches against a nonexistent item (TR-45).
6. **The in-memory search matrix is derived, never authoritative** (ADR-014). It is rebuilt from
   `product_shots` at startup and extended only after an enrollment commits. It leaves out
   soft-deleted products and vectors from any other `model_id`.

---

## 6. Matching Policy

Implemented as a **pure function** in `src/domain/match.ts` — no camera, no DB, fully unit-testable
(TR-37).

```
candidates = KNN(query, k=10)                      TR-30
byProduct  = groupBy(candidates, product_id)
              .map(best shot similarity)           TR-31

top1, top2 = two highest-scoring DISTINCT products

if   top1.sim >= τ  and  (top1.sim - top2.sim) >= δ   → ACCEPT        TR-32
elif top1.sim >= τ                                    → DISAMBIGUATE  TR-33
else                                                  → UNKNOWN       TR-34
```

Then the **temporal stability gate** (TR-36): push each decision into a 5-slot ring buffer; render a
locked result only when 3 of 5 agree on the same `product_id`. This is what stops the overlay from
flickering between neighbours.

### As implemented — `src/domain/` (P1-1, 2026-09-14)

The pseudocode above is literal, with these edge cases pinned down by tests:

- **Entry point.** `match(rows, { tau, delta })` is `decide(rankProducts(rows), …)`. Rows carry
  **cosine similarity**, which the JS search computes directly as a dot product (ADR-014).
- **Ties.** Equal product scores rank by `productId` in code-unit order, so the result does not
  depend on the phone's locale. An **exact top-1 / top-2 tie always disambiguates**, even at
  δ = 0, because accepting would be a coin flip.
- **Bad thresholds throw.** A NaN τ or δ makes every `<` comparison false, which would turn the
  policy into "accept everything". Thresholds come from `app_meta` as TEXT, so `decide()` refuses
  anything non-finite or out of range with a `RangeError`. Non-finite similarities are dropped
  before ranking.
- **A lone candidate** at or above τ is ACCEPTed with `margin: null`. **Consequence:** δ does the
  un-enrolled rejection (see calibration below), and δ only works when some enrolled product sits
  close to the item. The problem is a *sparse* catalog, not only a catalog of one. With a few
  products, top-2 exists but is far away, so the margin looks large and an un-enrolled item is
  accepted. Simulated on Phase 0 data (*Small catalogs*, below), 15.1% of un-enrolled frames are
  accepted at 5 products, which is SR-44's first-run size. The mitigation lives in the UI and the
  catalog, not in this function (ADR-013, `SR-13`, `SR-14`).
- **`LIMIT 10` is safe (TR-30).** The golden replay checks, for all 196 Phase 0 frames, that
  top-1 and top-2 from the 10 nearest shots equal the full brute-force ranking. That holds while
  a product has ≤ 6 shots; `TR-42` caps it at 5.
- **Stability.**
  - **What agrees:** ACCEPTs agree on the product. DISAMBIGUATEs agree on the **unordered** pair,
    because near-tied products swap order frame to frame, which is the flicker this gate stops.
    UNKNOWNs agree with each other, so "Unknown Item" locks too (`SR-04`).
  - **What is returned:** the lock is the *most recent* decision with the winning key, so the
    confidence shown is current. It is `null` until something reaches quorum.
  - **Quorum rule:** quorum must exceed half the window, so two results can never lock at once.
- **Golden replay.** `match.golden.test.ts` runs this policy over the Phase 0 dataset. It must
  reproduce 86/91 top-1 and 68 / 19 / 4 accept / disambiguate / unknown on enrolled frames. On
  un-enrolled frames it must give 3 / 50 / 52, with all 3 false accepts → Datu Puti vinegar
  (ADR-012).

### Threshold calibration

`τ` and `δ` live in `app_meta`, **never hard-coded** (TR-35). They are read from the score
distributions of a real labeled frame set in Phase 0, and retuned in Phase 3 against the full
catalog. Tune toward **precision** — NFR-02 outranks NFR-01.

**Phase 0 calibration — τ = 0.46, δ = 0.075** (2026-09-13, Infinix X6823, 25 products × 6 shots,
91 gated + 105 un-enrolled test frames; `ambiguous:` frames excluded).

- **τ is set by the true matches.** Correct top-1 scores have p05 0.465, so τ = 0.46 admits 95%
  of them.
- **τ barely separates un-enrolled products.** Their top-1 median is 0.460, level with the
  correct-match p05; 53 of 105 clear τ.
- **δ does the rejecting.** The 5 wrong top-1s on enrolled products all had margins ≤ 0.039
  (correct margins: median 0.169), so δ ≥ 0.04 already stops them. δ = 0.075 is set by
  un-enrolled products: at δ = 0.05, 12 of them would be accepted (6.1% FP).
- **Consequence for the policy above.** Of the 53 un-enrolled frames that clear τ, 3 are
  ACCEPTed — all Zonrox bottles → `datu-puti-bottle-vinegar-385ml`, margins 0.087–0.137 — and
  **50 land in DISAMBIGUATE, not UNKNOWN**. The UI would offer two wrong products for about half of
  all un-enrolled items, so `NFR-03` (return "Unknown") measures 49.5% (52/105). `analyze.mjs`
  reports 97.1% because it counts anything not ACCEPTed as rejected.
- **Small samples at the edges.** 5 wrong matches, 105 negatives; the 95% CI on FP 3/196 is
  0.5–4.4%, which spans the `NFR-02` ceiling. Retune in Phase 3 on the full catalog.

### Small catalogs — simulated (2026-09-14)

`scripts/small-catalog.mjs` enrolls a random N of the 25 Phase 0 products and treats everything else
as un-enrolled: the `unknown:` frames plus the frames of the products left out. It uses the same data
and phone as above (Infinix X6823), τ 0.46 / δ 0.075, 500 random catalogs per size. Results are
**per frame, before the 3-of-5 stability gate**. This is a **simulation on Phase 0 data**, not a
store measurement.

| Products enrolled | Un-enrolled frames auto-accepted (wrong price) | Correct accepts |
|---|---|---|
| 1 | 7.9% | 95.6% |
| 2 | 12.0% | 92.7% |
| 3 | 14.2% | 91.4% |
| 5 | **15.1%** | 88.8% |
| 10 | 12.6% | 83.1% |
| 15 | 9.7% | 79.1% |
| 25 | 2.9% — the 3/105 above | 74.7% |

- **The risk is sparsity, not a missing top-2.** It peaks near SR-44's five products and is still
  9.7% at 15. `NFR-02` allows ≤ 2%.
- **Mostly unrelated items.** At 5 products, 8.9% of false accepts are same-brand siblings. The
  most frequent pairs are Ajinomoto salt → Colgate sachet and Century Tuna → Nissin spicy seafood.
- **Fixes in the policy were rejected** (ADR-013).
  - A 0.60 floor for a lone candidate fixes only N=1, where correct accepts drop to 65.9%.
  - Holding ≤ 2% with τ alone takes 0.58–0.61, where correct accepts drop to 59.7–71.0%.
- **Deferred to Phase 3: a bundled distractor bank.** Using half the un-enrolled brand families as
  hidden items gives 4.7% at 5 products, with 79.1% correct accepts. The number is flattered: the
  bank and the test frames share one counter.
- **Adopted instead:** confirm mode below `confirm_below` products, plus negatives the tindera
  marks (`SR-13`, `SR-14`, `TR-38`, `TR-39`). Neither is built yet.

---

## 7. Directory Layout

```
BantayNiMama/
├── CLAUDE.md                  ← agent instructions; read every session
├── docs/
│   ├── PROJECT_SPECS.md       ← requirements (SR-, TR-, NFR- IDs)
│   ├── ARCHITECTURE.md        ← this file
│   ├── PROJECT_STATUS.md      ← current phase + gates
│   ├── CHANGELOG.md           ← what shipped
│   ├── DECISIONS.md           ← ADRs
│   └── TOOLING.md             ← Claude Code setup
├── .claude/
│   ├── settings.json          ← hooks + permissions
│   ├── commands/              ← project slash commands
│   └── hooks/                 ← doc-sync guard
├── assets/models/             ← .tflite model files; gitignored, fetched by
│                              `npm run fetch-model` (scripts/fetch-model.mjs)
├── scripts/
│   ├── fetch-model.mjs        ← dev-time model download (TR-20)
│   ├── analyze.mjs            ← Phase 0 offline accuracy + τ/δ sweep
│   └── small-catalog.mjs      ← small-catalog false-accept simulation (ADR-013)
├── App.tsx                    ← PHASE 0 ONLY. Throwaway spike UI; replaced by app/
│                              once the gate passes.
├── src/spike/                 ← PHASE 0 ONLY. Deleted at the start of Phase 1.
│   ├── config.ts              ← spike constants (τ/δ are NOT here — see TR-35)
│   ├── vectors.ts             ← pure cosine ranking + τ/δ decision
│   └── dataset.ts             ← capture, persist, share-sheet export
├── src/
│   ├── domain/                ← PURE TS. No I/O. Unit-tested.
│   │   ├── match.ts           ← τ/δ policy
│   │   ├── stability.ts       ← ring buffer
│   │   ├── money.ts           ← centavo arithmetic
│   │   ├── vector.ts          ← dot, L2-normalize, BLOB codec
│   │   ├── knn.ts             ← brute-force top-10 over the in-memory matrix (TR-30, ADR-014)
│   │   ├── appMeta.ts         ← strict app_meta parsing (TR-35, TR-38)
│   │   ├── migrations.ts      ← migration planning (TR-44)
│   │   ├── photoPath.ts       ← relative photo paths only (TR-43)
│   │   ├── pixels.ts          ← channel layout, model input, reticle rect — worklet-callable (TR-21)
│   │   ├── stats.ts           ← nearest-rank median / p90 for device measurements
│   │   └── *.test.ts          ← `node --test`; match.golden.test.ts replays Phase 0 (ADR-012)
│   ├── ml/                    ← model loading, worklet frame processor
│   │   ├── model.ts           ← model id, input size, reticle fraction, fps — shared by scan + enroll
│   │   ├── loadModel.ts       ← expo-asset → file:// → TFLite, CPU or GPU; tensor shapes checked (TR-29)
│   │   ├── frameEmbedder.ts   ← camera-thread worklet; per-stage timings (TR-25)
│   │   └── stillEmbedder.ts   ← saved JPEG → vector on the JS thread (enrollment, TR-24)
│   ├── db/                    ← schema, migrations, repositories
│   │   ├── open.ts            ← openDatabase(): bantay.db in documentDirectory (TR-46)
│   │   ├── schema.ts          ← migrations, forward-only (TR-44)
│   │   ├── migrate.ts         ← applies them, one transaction per version
│   │   ├── transaction.ts     ← synchronous BEGIN IMMEDIATE / COMMIT / ROLLBACK
│   │   ├── products.ts        ← insertProductWithShots (TR-45), getProduct
│   │   ├── shots.ts           ← loadVectorIndex from embedding BLOBs (ADR-014)
│   │   ├── meta.ts · ids.ts   ← read app_meta · UUID v4
│   │   └── devCheck.ts        ← TEMPORARY P1-2 device check; replaced by enrollment in P1-5
│   ├── features/
│   │   ├── scanner/
│   │   ├── enrollment/
│   │   └── directory/
│   ├── i18n/                  ← en.json, fil.json
│   └── ui/                    ← shared components, theme
└── app/                       ← expo-router routes
```

**The `src/domain/` boundary matters.** Anything that can be a pure function goes there and gets
unit tests. Everything hard to test (camera, native modules) stays thin and delegates to it.

**Loading the model is not a plain `require()`.** `src/ml/` — and `App.tsx` while Phase 0 stands in
for it — resolves the bundled `.tflite` through `expo-asset` to a real `file://` path before handing
it to `react-native-fast-tflite`. A bare `require()` resolves to an `http://` Metro URL in debug and
to a schemeless Android resource name in release, and the library's loader understands only URLs. So
a `require()` that works throughout development fails on the first release build (TR-29, ADR-011).

---

## 8. Performance Budget

| Stage | Budget | Measured |
|---|---|---|
| Sharpness gate | ~1 ms | not isolated by the spike |
| Crop + resize | 1–3 ms | **CPU run: median 36.9 ms, p90 38.0** (P1-3, n = 40). Includes frame → image conversion and packing into Float32. With the GPU delegate: **median 36.6, p90 37.7**. The delegate does not touch this stage. |
| TFLite inference | 8–40 ms | **CPU: median 62.8 ms, p90 72.2** (P1-3, n = 40). **`android-gpu` delegate: median 43.2 ms, p90 45.1**, 31% less. Whether GPU vectors match CPU vectors is **not yet measured**, so the delegate is not adopted: τ/δ were calibrated on CPU. |
| L2-normalize | <0.1 ms | **median 0.9 ms** (P1-3, n = 40). Also copies the vector out of the model's output buffer. |
| **Per-frame worklet total, split measurement** | **9–43 ms** | **CPU: median 100.7 ms, p90 109.1 · GPU delegate: median 81.2 ms, p90 83.0** — Infinix X6823, release APK, 2026-09-14, n = 40 each. Neither meets `NFR-07`. Crop + resize alone is ~37 ms, so even a free model would leave this stage near the budget. Not directly comparable to the 145.5 ms below: that number also covered converting the vector to a JS array inside the worklet. |
| **Crop + resize + inference + L2, measured as one** | **9–43 ms** | **Release: median 145.5 ms, p90 160.1 ms, range 126.5–339.5 ms** (n = 226 test frames). Debug: 140–248 ms, median ~148 ms (7 spot readings). See note. |
| sqlite-vec KNN | 0.5–3 ms | **Could not run** — sqlite-vec does not load on 32-bit ARM (§5). Measured as a substitute: **JS brute force, 100 shots median 9.2 ms; 2,500 shots median 234.0 ms** (inline loop over one `Float32Array`, n = 10), and 831.1 ms at 2,500 when calling `dot()` per shot. Infinix X6823, release APK, 2026-09-14. |
| Read vectors from SQLite | — | **56.3 ms** for 2,500 × 1280-d BLOBs, bit-exact round trip. Same device and date. |
| Policy + stability | <2 ms | _pending Phase 1_ |
| **Total per frame** | **≤ 60 ms** (NFR-07) | _pending — but already exceeded by the row above_ |

**Measurement, 2026-09-13.** 7 samples read off the spike's on-screen counter (`elapsedMs`, timed
inside the worklet around crop → resize → `runSync` → L2-normalize): 140.5, 142.4, 147.5, 148.2,
161.1, 167.3, 248.3 ms. Device: Infinix X6823 (Unisoc T616, armeabi-v7a 32-bit, Android 12, 2 GB RAM).

**Measurement, 2026-09-13, release APK.** `elapsedMs` of all 226 test frames kept in
`spike-dataset-20260913-233955.labeled.json`, recorded in collect mode during the Phase 0 run:
min 126.5, median 145.5, p90 160.1, max 339.5 ms. Same device.

> **This is 4–6× over budget and `NFR-07` is not currently met.** Three caveats before anyone
> redesigns the pipeline around it:
>
> 1. **It is a debug build.** Inference itself is native C++ and largely indifferent to JS debug
>    overhead, so this will not explain the whole gap — but it is unmeasured until a release build
>    is timed. **Answered 2026-09-13: it explains essentially none of it** — the release median
>    (145.5 ms, n = 226) matches the debug median (~148 ms).
> 2. **The device is 32-bit `armeabi-v7a`.** TFLite gives up its arm64 kernels there. A 64-bit
>    budget phone is the more representative target and has not been measured.
> 3. **The stages are not separated.** We do not yet know whether crop/resize or `runSync`
>    dominates. Separating them is the first diagnostic, not a model swap.
>
> At `TR-26`'s 4 fps (250 ms per frame) a 148 ms median leaves the camera thread busy ~60% of each
> interval, and the slowest release frame (339.5 ms) overruns it outright. The throttle holds for now; it has no
> headroom.

> **Claude: fill the "Measured" column as real numbers arrive.** Do not leave it as estimates once
> the spike has run.

---

## 9. Architectural Constraints

- **No ANN index.** 500 SKUs × 5 shots = 2,500 vectors, few enough for brute force. The original
  "sub-millisecond" figure was an estimate for native code. The JS brute force used for now
  (ADR-014) **measured 234 ms at 2,500 shots** on the Infinix, which is why native search is still
  owed for `NFR-09`. HNSW would not fix that and adds complexity; revisit only above ~50,000 vectors.
- **No backend, no API keys, no auth** (TR-50). If a feature seems to need one, it is out of scope.
- **No runtime network I/O from any dependency** (TR-51). Audit every package before adding it.
- **SQLite is the source of truth.** Zustand holds UI state only; never cache catalog data in it.
  The in-memory search matrix is a derived index rebuilt from SQLite, not a cache of record
  (ADR-014).
- **Inference never runs on the JS thread** during live scanning (TR-25). Enrollment is exempt.

---

## 10. Open Questions

| # | Question | Blocks | Resolve by |
|---|---|---|---|
| Q-1 | Does MobileNetV3 separate real sari-sari SKUs at ≥85% top-1? | Everything | **Resolved 2026-09-13: yes** — 94.5% (86/91), 95% CI 87.8–97.6% |
| Q-2 | What are the empirical values of τ and δ? | SR-09, TR-32 | **Resolved for Phase 0 (2026-09-13): τ = 0.46, δ = 0.075** — retune in Phase 3 (§6) |
| Q-3 | Does MobileCLIP via ExecuTorch beat MobileNetV3 enough to justify a JS-thread architecture? | — | Phase 3 |
| Q-4 | Is INT8's accuracy cost acceptable on this data? | — | Phase 3 |
