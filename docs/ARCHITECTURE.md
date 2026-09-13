# BantayNiMama — Architecture

> **Last updated:** 2026-09-12 · **Schema version:** 1 · **Model:** `mobilenet_v3_large_embedder_v1`
>
> **Stack:** Expo SDK 57 / RN 0.86.3 (ADR-009) · VisionCamera v5.2.3 · react-native-fast-tflite v3.0.1
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
│   │  TFLite    │        │ SQLite + sqlite-vec  │             │
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
║  6. sqlite-vec KNN         brute force over ≤2500 vectors    0.5–3 ms  ║
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
       INSERT product_shots  × 3–5
       INSERT vec_shots      × 3–5
  → live on the very next frame           (SR-24)
```

---

## 5. Data Model

Single SQLite file: `documentDirectory/bantay.db`.

```sql
CREATE TABLE products (
  id              TEXT PRIMARY KEY,   -- uuid
  name            TEXT NOT NULL,
  price_piece     INTEGER,            -- centavos; NEVER float (TR-41)
  price_pack      INTEGER,            -- nullable; the "buo" price (SR-06)
  unit_label      TEXT,               -- "sachet", "bote", "piraso"
  category        TEXT,
  is_ambiguous    INTEGER DEFAULT 0,  -- 1 → quick-pick grid, skip recognition (SR-10)
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
  created_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE vec_shots USING vec0(
  shot_id    TEXT PRIMARY KEY,
  product_id TEXT,
  embedding  FLOAT[1280]              -- L2-normalized at write time (TR-22)
);

CREATE TABLE price_history (
  id TEXT PRIMARY KEY, product_id TEXT, price_piece INTEGER,
  price_pack INTEGER, changed_at INTEGER
);

CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT);
-- schema_version, model_id, model_version, embedding_dim, tau, delta

CREATE INDEX idx_products_name     ON products(name);
CREATE INDEX idx_products_deleted  ON products(deleted_at);
CREATE INDEX idx_shots_product     ON product_shots(product_id);
```

### Invariants

1. **Money is integer centavos.** ₱12.50 is `1250`. Floats are forbidden for currency (TR-41).
2. **Every vector is stamped with its `model_id`.** Swapping models means re-embedding every stored
   JPEG. This is why the JPEGs are never discarded (TR-24).
3. **Photo paths are relative.** iOS rewrites the container path on every app update; absolute paths
   break silently after an upgrade (TR-43).
4. **One product owns 3–5 vectors**, one per shot. Matching aggregates shots → products.
5. **Enrollment is one transaction.** A half-written product with vectors but no metadata will
   produce confident matches against a nonexistent item (TR-45).

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
│   └── analyze.mjs            ← Phase 0 offline accuracy + τ/δ sweep
├── App.tsx                    ← PHASE 0 ONLY. Throwaway spike UI; replaced by app/
│                              once the gate passes.
├── src/spike/                 ← PHASE 0 ONLY. Deleted at the start of Phase 1.
│   ├── config.ts              ← spike constants (τ/δ are NOT here — see TR-35)
│   ├── embed.ts               ← in-worklet crop→resize→runSync→L2-normalize
│   ├── vectors.ts             ← pure cosine ranking + τ/δ decision
│   └── dataset.ts             ← capture, persist, share-sheet export
├── src/
│   ├── domain/                ← PURE TS. No I/O. Unit-tested.
│   │   ├── match.ts           ← τ/δ policy
│   │   ├── stability.ts       ← ring buffer
│   │   └── money.ts           ← centavo arithmetic
│   ├── ml/                    ← model loading, worklet frame processor
│   ├── db/                    ← schema, migrations, repositories
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
| Crop + resize | 1–3 ms | not isolated — folded into the row below |
| TFLite inference | 8–40 ms | not isolated — folded into the row below |
| **Crop + resize + inference + L2, measured as one** | **9–43 ms** | **Release: median 145.5 ms, p90 160.1 ms, range 126.5–339.5 ms** (n = 226 test frames). Debug: 140–248 ms, median ~148 ms (7 spot readings). See note. |
| sqlite-vec KNN | 0.5–3 ms | _pending Phase 1_ |
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

- **No ANN index.** 500 SKUs × 5 shots = 2,500 vectors. Brute-force cosine is sub-millisecond.
  HNSW here is complexity for zero gain. Revisit only above ~50,000 vectors.
- **No backend, no API keys, no auth** (TR-50). If a feature seems to need one, it is out of scope.
- **No runtime network I/O from any dependency** (TR-51). Audit every package before adding it.
- **SQLite is the source of truth.** Zustand holds UI state only; never cache catalog data in it.
- **Inference never runs on the JS thread** during live scanning (TR-25). Enrollment is exempt.

---

## 10. Open Questions

| # | Question | Blocks | Resolve by |
|---|---|---|---|
| Q-1 | Does MobileNetV3 separate real sari-sari SKUs at ≥85% top-1? | Everything | **Resolved 2026-09-13: yes** — 94.5% (86/91), 95% CI 87.8–97.6% |
| Q-2 | What are the empirical values of τ and δ? | SR-09, TR-32 | **Resolved for Phase 0 (2026-09-13): τ = 0.46, δ = 0.075** — retune in Phase 3 (§6) |
| Q-3 | Does MobileCLIP via ExecuTorch beat MobileNetV3 enough to justify a JS-thread architecture? | — | Phase 3 |
| Q-4 | Is INT8's accuracy cost acceptable on this data? | — | Phase 3 |
