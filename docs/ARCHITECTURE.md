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
| **UI thread** | Native view rendering. The overlay is plain RN views that re-render only when the lock changes (P1-6); Reanimated is deferred (ADR-020) | Re-render React on the hot path |

**Rule:** per frame, the worklet posts only a `Float32Array(1280)` to the JS thread, with its stage
timings (P1-3) and a `Date.now()` capture stamp (P2-8). Nothing else crosses that boundary per frame. An explicit capture during enrollment is the one exception: it
also sends that frame's reticle crop, once per button press (P1-4).

**One model instance per thread.** The camera worklet calls `runSync` on its model continuously. A
single TFLite interpreter must not run on two threads at once, so JS-thread embedding uses its own
CPU-only instance: saved JPEGs at enrollment, and `TR-24` re-embeds. That costs a second copy of
the model in memory.

**Worklet helpers are declared above their callers.** The worklets Babel plugin captures what a
`'worklet'` function references at the moment that function object is created, not when it runs.
A helper declared further down the file is captured as `undefined`. JavaScript hoisting hides this
from `tsc` and from `node --test`, so it only shows on the device, as every frame failing with
"undefined is not a function" (P1-4).

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
║  9. Stability ring buffer  require 4-of-5 agreement          <1 ms     ║
║ 10. Fetch name + price     indexed lookup on lock            <1 ms     ║
║ 11. Render overlay         Reanimated shared values          <16 ms    ║
╚════════════════════════════════════════════════════════════════════════╝

Stage times above are budgets. Measured values are in §8 (Infinix: 100.7 ms per frame on CPU).
Per processed frame:  30–50 ms budget Android · 15–25 ms iOS
CPU duty cycle:       12–20% at 4 fps
Perceived lock:       ~1 s computed (4 agreeing frames at 4 fps; was ~750 ms at 3 — ADR-016)
Measured lock:        median 1.69 s · p90 2.88 s from entering the reticle (P2-8, n = 19)
```

### Why 4 fps

`runAtTargetFps(4)` is the single biggest battery and thermal lever in the app (NFR-06). At 30 fps
a budget Android thermally throttles within minutes. At 4 fps, with a 4-of-5 stability gate
(ADR-016), a result locks in ~1 s nominal, a computed figure. **Measured on the Infinix it takes
longer:** median 1.69 s and p90 2.88 s from the product entering the reticle (P2-8, n = 19), against
the 1.2 s p90 target (NFR-04, not met). Recorded, not changed in Phase 2 (E-2, ADR-016).

### Time-to-lock proxy (P2-8, built and calibrated on the Infinix 2026-09-15)

The app cannot see a product enter the reticle, so `domain/timeToLock.ts` measures a proxy.
- **Frame log:** every processed frame's kind after `resolveFrame`, with two `Date.now()` stamps:
  when the worklet began on it and when the JS thread received it. It also marks every scanner
  reset. It is held in memory, up to 6,000 frames (about 25 min at 4 fps), and never persisted.
- **Episode:** from an Unknown lock (the empty table) to the next ACCEPT, chips or grid lock. t_seen is
  the capture time of the first frame received after the Unknown lock that was not UNKNOWN. The
  proxy is t_lock − t_seen.
- **Left out, and counted:** episodes that opened before the oldest logged frame (`truncated`), ones
  with a reset inside (`interrupted`), and ones with no non-UNKNOWN frame or with t_seen after t_lock
  (`inconsistent`, meaning the clocks disagree).
- **Clock check:** arrival − capture − worklet time per frame. It can be negative only if the two
  runtimes' `Date.now()` disagree.
- **Under-reads by design:** a product moving in, blurred, or below τ votes UNKNOWN while already in
  view. So a screen recording with the phone's clock overlaid (`screenrecord --bugreport`) gives
  t_enter, and the bias t_seen − t_enter is reported beside the proxy, not folded into it.
- **Informational, not `NFR-04`:** lock → *Yes* in confirm mode, from the lock log and interaction
  log.
- **Added cost per frame:** one `Date.now()` in the worklet; on the JS thread, one more `Date.now()`
  and an in-place append, outside the timed KNN and policy span.

#### Calibration, measured 2026-09-15

Infinix X6823, release APK, gate app, one process, airplane mode on, 28.1–33.7 °C. The per-episode
table and all evidence: `C:\BantayNiMamaBackups\p2-8-calibration` (README, SHA-256 checked).
- **Protocol:** recording 1 (10 gate products, `screenrecord --bugreport`) · 20 plain episodes (all 20
  products) · recording 2 (the other 10). The overlay clock maps to video time with 0 ms residual
  (5 samples per video).
- **t_enter is read by eye:** the first frame with the product itself inside the reticle, from
  sheets of every 2nd frame (median 101 ms apart, so a reading can be one tile late). A
  frame-difference rule was tried first and rejected: with the phone handheld, the reticle is never
  still.
- **Proxy bias (t_seen − t_enter), n = 19: median 496 ms, p90 849, range 206–850.** The proxy starts
  about half a second after the product is in view.
- **True time-to-lock (t_lock − t_enter), n = 19: median 1690 ms, p90 2879, min 1107, max 3288.** No
  episode reached the computed ≈ 0.9–1.0 s.
- **Proxy as the gate panel reads it:** n = 41, median 1152 ms, p90 2007. By condition: recording 1
  1152 / 1649, plain 1193 / 2007, recording 2 1116 / 1661 (median / p90, n = 10 / 21 / 10).
  **Screen recording did not slow scanning.** The plain block's corrected p90 is an **estimate**:
  2007 + 496 = 2503 ms.
- **Clock check:** 0 impossible frames of 2,809; arrival − capture − worklet median 1.6 ms.
- **Left out:** an episode that opens at an Unknown lock with the product already in view has no entry
  to read. One did (#34, Spicy Labuyo Beef): **9.8 s** from entry to chips. With it, the median and
  p90 are unchanged and the max is 9.8 s.
- **Lock → *Yes* (informational):** n = 12, median 1440 ms, p90 2084, max 3056.

---

## 4. Enrollment Pipeline

Separate path. Quality matters, latency does not, so this runs on the JS thread.

```
Tap "Add" (+ Add product · Unknown's Add · "n of 5" banner · first-run handoff)
                                          (SR-25)  interaction log: the 30 s clock starts here
  → framing coach + one angle per photo   (SR-20)  front · left · right · back/top · other light (P2-6)
  → save each as q80 JPEG, ≤ 512 px        (TR-42)  documentDirectory/photos/  (never upscaled)
  → decode once on the JS thread:
       embed                              (TR-24)
       measure luminance + sharpness      (SR-22)  too dark / blown out / blurry → warn, never block
  → duplicate check: KNN vs catalog       (SR-23)  match > τ → "Ganito ba ito?"
  → ONE transaction:                      (TR-45)
       INSERT products
       INSERT product_shots  × 3–5   (photo path + embedding BLOB)
  → add the vectors to the in-memory search matrix — only after COMMIT succeeds
  → live on the very next frame           (SR-24)
  → interaction log: enrollSaved          (SR-25)  Add → saved, per product
```

**Quality warnings (`SR-22`, P2-6) are measured after the JPEG is saved, not per frame.** They use
the same decoded 224² input the vector comes from, so a warning describes what was embedded.
- **Limits are placeholders** (`shotQuality.ts`): luminance < 0.12 or > 0.88, and sharpness < 0.0005.
  `TR-27`'s floor is still 0, so they only warn. The gate panel reads out every shot's luminance and
  sharpness, so Phase 3 can set measured limits.
- **Exposure wins over blur.** A black or clipped-white photo has almost no edges and would always
  read blurry too, so only the exposure warning shows.
- **Cost:** about one `laplacianVariance` per shot (20.9 ms per frame in the worklet, P1-8), on the
  JS thread, which enrollment may block (`TR-25`). Not yet measured on this path.

**Enrollment embeds a JPEG, scanning embeds a frame** (measured in P1-4). Both come from the same
reticle crop (`captureReference`). The enrolled vector goes through one more resize and JPEG q80;
the live one does not.

- **Measured:** on the Infinix, the two vectors agree at dot min 0.9803, median 0.9843, over 10
  captures of one static scene (P1-4). **On real products** (2026-09-14, two enrollment sessions,
  92 shots, Infinix X6823, release APK, CPU), they agree at dot **min 0.9882 / 0.9804, median
  0.9960 / 0.9963**. The worst shot (0.9804) bounds a score shift at ≈ 0.20, and a median shot at
  ≈ 0.09. The bound is loose. The P1-5 / P1-6
  scans ran on JPEG-path vectors and locked correctly.
- **What that allows:** unit vectors at 0.984 are √(2 − 2·0.984) ≈ 0.18 apart, which is the most a
  similarity score can move (δ = 0.075). The typical move is far smaller, but it is unmeasured on
  real products.
- **Consequence:** Phase 0 calibrated τ/δ on live-frame vectors on both sides. The P1-8 gate and
  the Phase 3 retune must therefore use JPEG-path enrollment vectors.
- **Size:** the frame is 1280 × 720, so the reticle crop is 396 px. It is stored at that size rather
  than upscaled to 512: 17.5 KB median per shot, ~88 KB per 5-shot product against `NFR-08`'s
  200 KB. **On real products** (same 92 shots): **21.9 / 24.2 KB median, 34.1 KB max** per
  shot, so ≤ 170.5 KB even for a product made of five worst-case shots.

**As implemented — `src/features/enrollment/` (P1-5, verified on the Infinix 2026-09-14: enroll
→ relaunch → scan locked the new products, and the size pair gave chips).**

- **Shot ids are chosen at capture.** The JPEG is written as `photos/<shot id>.jpg` straight away.
  `insertProductWithShots` stores that same id and refuses any other path, so a row can never point
  at another shot's photo.
- **The stored vector is the JPEG's** (CPU still model), never the live frame's. The frame vector
  is kept only for the agreement readout.
- **Duplicate check (`SR-23`):** each draft shot runs KNN against the index. `likelyDuplicates`
  keeps products whose best score over all shots is **≥ τ**, the bar at which the scanner would
  start naming them. It warns; "Save anyway" proceeds.
- **Failure:** if the transaction throws, the draft's JPEGs are deleted. If the app is killed
  before COMMIT, the photos are orphans, and the next launch's sweep removes them (§5, invariant 7).
- **Search index:** `appendToIndex` runs only after `insertProductWithShots` returns, and the
  scanner reads the new index on its next frame. That is all `SR-24` needs. With search in JS
  (ADR-014), nothing re-queries SQLite per frame.
- **Repacked (`SR-10`, P2-5):** the *repacked* toggle and the duplicate warning's offer to mark the
  look-alikes are both written inside the same transaction as the product (§6, quick-pick grid).
- **`openCatalog()`** refuses a `bantay.db` whose `app_meta.model_id` differs from the bundled
  `MODEL_ID` (`TR-23`).

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
-- Schema v2, as src/db/schema.ts creates it: migration 1 (P1-2) plus migration 2 (P2-2).
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
  created_at INTEGER NOT NULL,
  source     TEXT NOT NULL DEFAULT 'enroll'
             CHECK (source IN ('enroll', 'correction', 'teach'))   -- migration 2; SR-07, SR-33, ADR-019
);

-- Migration 2. Store-local negatives (SR-14, TR-39, ADR-017). No name or price column, by design:
-- no query can name or price a negative, whatever filter it forgets.
CREATE TABLE negative_shots (
  id         TEXT PRIMARY KEY,
  photo_path TEXT NOT NULL,           -- RELATIVE, photos/<id>.jpg, same store as product shots (TR-43)
  model_id   TEXT NOT NULL,           -- TR-23
  embedding  BLOB NOT NULL CHECK (typeof(embedding) = 'blob'),   -- the saved JPEG's vector (TR-24)
  source     TEXT NOT NULL CHECK (source IN ('confirm_no', 'wrong_lock', 'wrong_chip')),
  created_at INTEGER NOT NULL
);

CREATE TABLE price_history (
  id          TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL REFERENCES products(id),
  price_piece INTEGER,                -- centavos: the price in force BEFORE changed_at (P2-2)
  price_pack  INTEGER,                -- centavos: likewise
  changed_at  INTEGER NOT NULL
);
-- The current price lives in products, and each edit adds one row holding the prices it replaced.
-- The first edit therefore keeps the enrollment price, even for Phase 1 products with no history rows.

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
- **Migration 2 (P2-2).**
  - **Changes:** adds `negative_shots` and `product_shots.source`. The column defaults to `'enroll'`,
    which is true of every earlier shot.
  - **Literal CHECK lists:** written out, not generated from `SHOT_SOURCES` / `NEGATIVE_SOURCES`, so a
    shipped migration cannot change when a constant does. A test checks the lists agree.
  - **No `confirm_below` row** (ADR-017).
- **Tested against real SQLite, not on faith** (`src/db/*.test.ts`).
  - **Adapter:** `node:sqlite` is built into Node (v24.13.1, SQLite 3.51.2; the Infinix has 3.51.3),
    so it adds no dependency (`TR-51`). `nodeSqlite.testing.ts` puts it behind `executeSync`, and the
    real migrations and repositories run under `npm test`.
  - **The tests prove:**
    - a Phase 1 catalog upgrades with every row and BLOB byte intact;
    - a migration that fails part-way leaves the database at version 1;
    - each `negative_shots` reader includes negatives.
  - **Files those tests load** use `.ts` import extensions, as `src/domain/` does, because Node cannot
    resolve extensionless imports.
- **Repositories (P2-2).** Every multi-statement write is one transaction.
  - **Photos are written first, rows last.** Files are deleted only after COMMIT: a replaced
    correction, a purged product or a deleted negative.
  - **A kill between COMMIT and a file delete** leaves orphans for the launch sweep, never a row
    without its JPEG.
  - **Missing or trashed product:** `updatePrice`, `updateProduct` and `insertExtraShot` (corrections
    and taught photos) throw and write nothing, because a price or shot must never land on another
    product.
  - **Rebuild or append:**
    - *Rebuild* the index when a write removes or re-includes vectors: delete, restore, a replaced
      extra shot (a correction or taught photo, ADR-024), or a deleted negative (E-4).
    - *Append* when it only adds them.
    - *Neither* for an edit (`SR-31`): names, prices and the repacked flag are not in the index, and
      the scanner re-reads them through `catalogVersion`.

### Invariants

1. **Money is integer centavos.** ₱12.50 is `1250`. Floats are forbidden for currency (TR-41).
2. **Every vector is stamped with its `model_id`.** Swapping models means re-embedding every stored
   JPEG. This is why the JPEGs are never discarded (TR-24).
3. **Photo paths are relative.** iOS rewrites the container path on every app update; absolute paths
   break silently after an upgrade (TR-43).
4. **One product owns 3–5 enrollment vectors plus up to 3 correction vectors**, one per shot
   (`TR-42`, ADR-019). The oldest correction is replaced first, and enrollment shots never are.
   Matching aggregates shots → products. Top-10 search stays exact while a product has ≤ 9 shots.
5. **Enrollment is one transaction.** A half-written product with vectors but no metadata will
   produce confident matches against a nonexistent item (TR-45).
6. **The in-memory search matrix is derived, never authoritative** (ADR-014).
   - **Built** at startup from `product_shots` and `negative_shots`. Each negative is a flagged
     one-shot row.
   - **Extended** only after a write commits.
   - **Rebuilt** whenever a write removes vectors.
   - **Leaves out** soft-deleted products and vectors from any other `model_id`.
7. **Orphan photos are swept only at launch** (P1-5). `openCatalog()` deletes any photo in `photos/`
   that no row references, before any draft can exist.
   - **What counts as referenced:** `product_shots`, soft-deleted products' shots, and
     `negative_shots`. **Leaving a table out of `referencedPhotoPaths` deletes every one of its JPEGs**
     (ADR-017), and a test guards this.
   - **Why only at launch:** at any other time the sweep would delete a draft's photos, which have no
     row until COMMIT.
   - **If the reference query fails,** nothing is deleted.

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
locked result only when 4 of 5 agree on the same `product_id` (ADR-016; it was 3 of 5 until gate
run 2 locked a look-alike can). This is what stops the overlay from
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
  top-1 and top-2 from the 10 nearest shots equal the full brute-force ranking.
  - **The bound:** this holds while a product has ≤ 9 shots, because only top-1's own shots can
    rank above the second product's best shot.
  - **The cap:** `TR-42` allows 8 since ADR-019.
  - **Negatives** are one-shot rows, so any number of them keeps the bound.
  - **The proof:** `knn.test.ts` checks it at 9 shots with up to 200 negatives, and shows that a
    10th shot breaks it.
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

### As rendered — `src/features/scanner/` (P1-6, verified on the Infinix 2026-09-14)

- **The overlay shows exactly `lockedDecision`.** When no result has quorum, it shows a neutral
  "point the box at a product", never the previous lock. Holding a lock through lost quorum would
  cut flicker. It would also leave a confident price on screen while the camera sees something else,
  and `NFR-02` outranks flicker.
- **React renders on lock changes only.** `useScanner` compares `decisionKey`s. Per-frame state
  (votes, timings, the dev top 3) lives in refs.
- **Confidence (`SR-03`, `src/domain/confidence.ts`)** comes in three bands, never a number:

  | Decision | Condition | Shown |
  |---|---|---|
  | ACCEPT | margin ≥ 2δ | Sure (3 bars) |
  | ACCEPT | margin < 2δ, or no second product (`margin: null`) | Likely (2 bars) |
  | DISAMBIGUATE | — | Not sure (1 bar) + two chips |
  | UNKNOWN | — | "Unknown item" + Add |

  δ is read from `app_meta` (`TR-35`). Only the multiple `SURE_MARGIN_IN_DELTAS = 2` is a constant:
  an operator-chosen placeholder, retuned in Phase 3. On the P1-5 scans, Reno's margins
  (0.237 / 0.254) would read Sure, Argentina 260g's (0.160) Sure, and the size pair Not sure.
- **Chips.** A tap shows that product's price until the next lock. Nothing is learned from the tap
  yet (`SR-07`, Phase 2).

### Display step — `src/domain/scanDisplay.ts` (P2-1, 2026-09-14; wired into the scanner in P2-3)

Negatives and ambiguity are resolved **per frame, before stability**. Quote or question is decided
**after the lock**. `match()` is unchanged, so the golden replay stays valid (ADR-017, E-5).

```
decision = match(knn rows, τ/δ)                                   unchanged (ADR-012)
frame    = resolveFrame(decision, { negativeIds, ambiguousIds })  per frame     TR-39, SR-10
locked   = lockedDecision(pushDecision(buffer, frame))            4 of 5        TR-36
card     = displayFor(locked, liveProductCount, confirm_below)    after lock    SR-13, TR-38
```

| Frame decision | Condition | Becomes |
|---|---|---|
| ACCEPT, or chips | a negative at top-1 or in the pair | UNKNOWN, with no best candidate |
| UNKNOWN | its best candidate is a negative | UNKNOWN, with no best candidate |
| ACCEPT, or chips | an ambiguous product involved, no negative | `quickPick` |
| ACCEPT | a negative is only the runner-up | unchanged: it already counted toward δ |

| Locked | Condition | Card |
|---|---|---|
| nothing | — | scanning |
| ACCEPT | no `confirm_below` row, or live products < `confirm_below` | **confirm** (Yes / No) |
| ACCEPT | live products ≥ `confirm_below` | quote |
| DISAMBIGUATE | — | chips |
| `quickPick` | — | grid |
| UNKNOWN | — | unknown + Add |

- **A negative outranks ambiguity.** The tindera has already said a negative is not in her list, and
  UNKNOWN names nothing.
- **Grid votes share one stability key**, whichever bag ranked first, because clear bags swap places
  frame to frame.
- **A negative is its own one-shot "product"** in the index (`negativeIds`). Building the index
  refuses an id shared by a product and a negative, and a second row for one negative.
- **Bad input throws.** A NaN product count would make `count < confirm_below` false and quote every
  price, so `displayFor` refuses it, as `assertThresholds` refuses a NaN τ.
- **The capture guard** (`correction.ts`): a negative or correction is saved only if the next frame's
  resolved decision has the same stability key as the rejected lock.

### The scan card as built — `src/features/scanner/` (P2-3, 2026-09-14)

- **Per frame:** `useScanner` runs `resolveFrame` between `match()` and the vote. The repacked set
  comes from SQLite and is re-read when `catalogVersion` changes. It is held in a ref, so `onVector`
  keeps its identity and the camera worklet is never rebuilt. The lock log's votes keep the **raw**
  decision, so a diagnosis still shows what a negative silenced.
- **The card** is `displayFor(locked, liveProductCount, confirm_below)`.
  - **Confirm:** the product's first enrollment photo, *"Is this {name}? ₱price"*, confidence bars, and
    large Yes / No buttons.
  - **Yes** shows the price only while the same lock holds, as a quote does. It adds no second tap.
  - **No**, *Wrong?* on a quote, and *Neither* on chips open the reject sheet.
- **Rejecting pins the card and pauses voting.** `domain/rejection.ts` is a reducer, and
  `useRejection` performs only what its new stage allows.
  - **The pin:** the card's stability key, the source, and the product ids, as shown at tap time.
  - **The pause:** the Scan tab stops feeding votes, and resuming resets the stability window.
  - **Late events are ignored:** a capture after Cancel, or a second tap. Cancel is refused mid-write,
    so the result is always shown.
- ***Not in my list*** reuses enrollment's capture channel. The worklet cuts the next frame, and an
  owner ref routes the capture to the reject flow.
  - **The guard:** `classify` puts the frame through the scanner's own KNN → policy → `resolveFrame`
    path, without voting. A mismatch saves nothing and says so.
  - **On a match:** JPEG → embed → `insertNegativeShot` → `appendToIndex`, in that order. The index
    grows only after the INSERT, and a failed INSERT deletes the JPEG. The worklet does no new
    per-frame work (`NFR-07`).
- **Torch (`SR-11`):** VisionCamera's declarative `torchMode`, shown only when `device.hasTorch`, and
  off whenever the tab loses focus.
- **The interaction log:** Yes, No, *Not in my list* saved, refused or failed, chip picks and the
  torch, each with a time. Held in memory, shown in the gate panel, never persisted.
- **`quickPick`** showed chips for the products the frame involved, until P2-5's grid (below).

### Edit, correct, delete as built — `src/features/scanner/` (P2-4, 2026-09-14; gate A2–A4 passed on the Infinix)

- **The price editor (`SR-06`)** opens from the price on a settled card: a quote, the card after
  *Yes*, or after a chip or tile tap. It is **not** on the question card, where the product has not
  been agreed yet.
  - **The binding:** the product id is captured at tap time, and the panel never asks the scanner
    again. Voting pauses while it is open, so moving the phone cannot move the edit (gate A2).
  - **The write:** `planPriceEdit`, then `updatePrice`: the UPDATE and the `price_history` row in one
    transaction (ADR-021). An untouched save writes nothing.
- **The reject sheet (`SR-07`)** chooses what the capture frame is saved as:
  - *Not in my list* → a negative (P2-3);
  - a likely product or a search result → a correction shot on that product (D-3);
  - **on chips, either product of the pair**, listed first → a correction shot on it (ADR-022). A
    question or a quote still refuses the product it named, and a chip *tap* still teaches nothing.

  | | |
  |---|---|
  | **Likely products** | The scanner's latest top 3 at tap time, minus negatives and the products the card showed (`likelyProducts`). Voting is paused, so that is the frame she tapped on. |
  | **Guard** | The same capture guard for both. *Try again* keeps the choice. |
  | **Correction write order** | JPEG → embed → `insertCorrectionShot` (the oldest correction removed in the same transaction) → the replaced JPEG deleted → index **rebuilt** if a row was replaced, **appended** otherwise |
  | **Where** | In the panel under the camera, like enrollment, so the search field stays above the keyboard |

- **Delete (`SR-08`, `SR-32`)** is on the price editor: soft delete → index rebuild (E-4) → a 10 s
  *Undo* bar.
  - **Undo inside the window** restores the product and rebuilds again. After the window, the
    product stays in the trash, listed on the Products tab with *Restore* (pulled forward from P2-7).
  - **If a rebuild fails,** the old index still holds the product's rows. The card reads products
    through `getProduct`, which skips the trash, so it shows "scanning" rather than a price, and the
    bar says to restart.
- **Every catalog write bumps `catalogVersion`.** That empties `useScanner`'s product and photo
  caches and resets the stability window, so a lock never mixes votes from two indexes.
- **`rebuildIndex`** lives in `Root`: `loadVectorIndex` swapped into the shared ref between frames,
  timed, and shown in the gate panel with the `price_history` rows.

### Quick-pick grid as built — `src/features/scanner/` (P2-5, 2026-09-14; not yet verified on a device)

- **Tiles** (`QuickPickGrid`, ordered by `quickPickTiles`): photo and name in one horizontal row,
  ordered by name ignoring case, then by id.
  - **Nothing is highlighted, and no price shows until a tap** (operator's call). The tap shows the
    price with Edit (`SR-06`) and logs `tilePick`.
  - **Why a fixed order:** clear bags look identical (`L-01`), so the camera's first-ranked bag is a
    guess, and putting it at the front would hand the helper that guess as an answer.

  | Opened by | Tiles | Voting |
  |---|---|---|
  | a `quickPick` lock | every live repacked product, plus a non-repacked product the lock involved | continues; every grid lock shares one key, so a tile choice survives bags swapping places |
  | the pinned *Repacked* button, shown while a live repacked product exists | every live repacked product | paused; *Close* resets the stability window |

- **No reject on the grid:** no *Wrong?* and no *Not in my list*.
  - Nothing on the grid is named, so there is nothing to correct.
  - A negative saved from a clear bag would sit next to every look-alike bag and silence them all,
    because a negative outranks ambiguity (§6, display step).
- **Flagging (`SR-10`, `SR-23`):**
  - The enrollment toggle writes `is_ambiguous` in the product INSERT.
  - The duplicate warning's offer flags the named products in the same transaction, before the shot
    rows, so a failed enrollment leaves no look-alike flagged (`repackedPlan`, `TR-45`).
  - A later change belongs to the Directory (P2-7), through `setAmbiguous`.
- **The repacked set is re-read from SQLite on every `catalogVersion`** (`listQuickPickProducts` for
  the tiles, `ambiguousProductIds` in `useScanner`), so a flag set at enrollment applies from the
  next frame.

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
  marks (`SR-13`, `SR-14`, `TR-38`, `TR-39`). The domain rules are built (P2-1, *Display step*
  above). The schema, card and capture flow are not.

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
├── index.ts                   ← registers src/app/Root (App.tsx and src/spike/ were deleted in P1-7)
├── src/
│   ├── app/                   ← app shell (TR-14, ADR-015): React Navigation, two tabs
│   │   ├── Root.tsx           ← boot: catalog, language, both models once; tab navigator
│   │   ├── services.ts        ← shared context: catalog, index, models, language, diagnostics
│   │   ├── ScanScreen.tsx     ← one camera (live only while focused); overlay; enrollment slides up
│   │   └── ProductsScreen.tsx ← plain list from SQLite; language switch; gate check
│   ├── domain/                ← PURE TS. No I/O. Unit-tested.
│   │   ├── match.ts           ← τ/δ policy
│   │   ├── stability.ts       ← 4-of-5 vote over resolved frames (TR-36)
│   │   ├── money.ts           ← centavo arithmetic
│   │   ├── vector.ts          ← dot, L2-normalize, BLOB codec
│   │   ├── knn.ts             ← brute-force top-10 over the in-memory matrix; negative flag per row (TR-30, TR-39, ADR-014)
│   │   ├── appMeta.ts         ← strict app_meta parsing (TR-35, TR-38)
│   │   ├── migrations.ts      ← migration planning (TR-44)
│   │   ├── photoPath.ts       ← relative photo paths only (TR-43)
│   │   ├── pixels.ts          ← channel layout, model input, reticle rect — worklet-callable (TR-21)
│   │   ├── stats.ts           ← nearest-rank median / p90 for device measurements
│   │   ├── referencePhoto.ts  ← photo path per shot; 512 px cap without upscaling (TR-42); orphan detection
│   │   ├── enrollment.ts      ← form → centavos (SR-21); duplicates ≥ τ (SR-23); 3–5 shots
│   │   ├── confidence.ts      ← Sure / Likely / Not sure from δ (SR-03)
│   │   ├── language.ts        ← saved ui_language, else phone locale (fil / tl), else en (SR-42)
│   │   ├── gateCheck.ts       ← Phase 1 gate: persistence problems, self-match report (PHASE_1_PLAN §4)
│   │   ├── lockLog.ts         ← every lock change with its voting frames; segments at Unknown
│   │   ├── scanDisplay.ts     ← per frame: negative → Unknown, ambiguous → grid; after lock: quote or confirm (P2-1)
│   │   ├── quickPick.ts       ← grid tiles: repacked products by name, never by rank (SR-10, P2-5)
│   │   ├── correction.ts      ← ≤ 3 extra shots, corrections and taught photos together, oldest replaced (ADR-024); the capture guard; likely products (SR-07, SR-14, SR-33)
│   │   ├── rejection.ts       ← the reject sheet as a reducer: negative or correction, guard, late events ignored (P2-3, P2-4)
│   │   ├── priceEdit.ts       ← typed prices → centavos, shared with enrollment; no-op edits write nothing; editor text (SR-06)
│   │   ├── productEdit.ts     ← every field of a product: enrollment's parsing, no-op edits write nothing, prices only when changed (SR-31)
│   │   ├── productSearch.ts   ← name search, case and accents ignored (SR-07)
│   │   ├── directory.ts       ← name filter, three sorts, which lock counts as scanned, photo storage (SR-30, SR-34, SR-35)
│   │   ├── trash.ts           ← 10 s undo, 30-day purge, days left (SR-32)
│   │   ├── firstRun.ts        ← welcome / "n of 5" banner / complete; angle per photo; after-save step (SR-44, SR-20)
│   │   ├── cameraAccess.ts    ← permission status → ask / ask again / open settings; what to log (SR-43)
│   │   ├── shotQuality.ts     ← mean luminance; too dark / blown out / blurred, placeholder limits (SR-22)
│   │   ├── interactionLog.ts  ← gate taps in memory; enrollmentTimes: Add → saved per product, split into photos and typing (SR-25)
│   │   ├── timeToLock.ts      ← NFR-04 frame log, proxy episodes, clock check, lock → Yes, calibration bias
│   │   └── *.test.ts          ← `node --test`; match.golden.test.ts replays Phase 0 (ADR-012)
│   ├── ml/                    ← model loading, worklet frame processor
│   │   ├── model.ts           ← model id, input size, reticle fraction, fps — shared by scan + enroll
│   │   ├── loadModel.ts       ← expo-asset → file:// → TFLite, CPU or GPU; tensor shapes checked (TR-29)
│   │   ├── frameEmbedder.ts   ← camera-thread worklet; per-stage timings (TR-25)
│   │   ├── stillEmbedder.ts   ← saved JPEG → vector on the JS thread (enrollment, TR-24)
│   │   └── useEmbeddingModel.ts ← one model instance per call, loaded once in Root
│   ├── db/                    ← schema, migrations, repositories
│   │   ├── open.ts            ← openDatabase(): bantay.db in documentDirectory (TR-46)
│   │   ├── schema.ts          ← migrations, forward-only (TR-44)
│   │   ├── migrate.ts         ← applies them, one transaction per version
│   │   ├── transaction.ts     ← synchronous BEGIN IMMEDIATE / COMMIT / ROLLBACK
│   │   ├── catalog.ts         ← openCatalog(): migrate, model_id check, orphan sweep, index — once at launch
│   │   ├── products.ts        ← insertProductWithShots (TR-45), updatePrice + price_history, trash / restore / purge, setAmbiguous, catalogCounts
│   │   ├── shots.ts           ← loadVectorIndex incl. negatives (ADR-014); referencedPhotoPaths (both tables); insertCorrectionShot
│   │   ├── negatives.ts       ← negative_shots: insert, list, delete (SR-14, TR-39)
│   │   ├── schema.test.ts · repositories.test.ts ← real SQL under node:sqlite (P2-2)
│   │   ├── nodeSqlite.testing.ts ← tests only: node:sqlite behind executeSync; excluded from the app build
│   │   ├── photos.ts          ← reference JPEG store in documentDirectory/photos/ (TR-42, TR-43)
│   │   └── meta.ts · ids.ts   ← read app_meta · UUID v4
│   ├── features/
│   │   ├── scanner/           ← P1-6
│   │   │   ├── useScanner.ts  ← knn → match → resolveFrame → stability; classify for the capture guard; renders only on lock change
│   │   │   ├── ScanOverlay.tsx ← confirm / quote / chips / quick-pick grid / Unknown (SR-02–SR-05, SR-09, SR-10, SR-13)
│   │   │   ├── QuickPickGrid.tsx ← tiles: photo + name, a price only after a tap (SR-10, P2-5)
│   │   │   ├── useRejection.ts ← No / Wrong? / Neither → Not in my list or a correction: guard, JPEG, INSERT, index (SR-07, SR-14)
│   │   │   ├── RejectPanel.tsx ← the reject sheet: likely products, search, Not in my list (P2-4)
│   │   │   ├── PriceEditPanel.tsx ← price editor bound to the tapped id; Delete (SR-06, SR-08)
│   │   │   └── useUndoDelete.ts ← soft delete, 10 s undo, index rebuilds (SR-32, E-4)
│   │   ├── enrollment/        ← P1-5
│   │   │   ├── draft.ts       ← capture → JPEG → vector; one-transaction commit; rollback deletes photos
│   │   │   ├── useEnrollment.ts ← draft state; extends the index after COMMIT (SR-24)
│   │   │   └── EnrollmentPanel.tsx ← form, thumbnails, duplicate warning (SR-20, SR-21, SR-23)
│   │   ├── gate/              ← P1-7: runGateCheck (re-embed every JPEG, KNN), readout, panel
│   │   ├── firstRun/          ← P2-6: FirstRunIntro (welcome → language → camera, resumes at the camera step), useCameraAccess, CameraAccessPanel (SR-43, SR-44)
│   │   ├── teach/             ← P2-7: useTeach + TeachPanel — capture, review, keep or retake; insertTeachShot; index append or rebuild (SR-33, ADR-024)
│   │   └── directory/         ← P2-7: ProductEditPanel (every field, teach, delete), TrashList (thumbnails, days left, restore), NegativesList (photo, delete) (SR-14, SR-30–SR-32)
│   ├── app/                   ← Root (tabs, first-run and teach handoffs), ScanScreen, ProductsScreen = the Directory (search, sort, storage), services
│   ├── i18n/                  ← i18next init, en.json, fil.json, typed keys (TR-16, SR-42)
│   └── ui/                    ← FormControls: Field, Toggle, Button for the Directory and Teach again (P2-7)
```

**The `src/domain/` boundary matters.** Anything that can be a pure function goes there and gets
unit tests. Everything hard to test (camera, native modules) stays thin and delegates to it.

**Loading the model is not a plain `require()`.** `src/ml/loadModel.ts` resolves the bundled `.tflite` through `expo-asset` to a real `file://` path before handing
it to `react-native-fast-tflite`. A bare `require()` resolves to an `http://` Metro URL in debug and
to a schemeless Android resource name in release, and the library's loader understands only URLs. So
a `require()` that works throughout development fails on the first release build (TR-29, ADR-011).

---

## 8. Performance Budget

| Stage | Budget | Measured |
|---|---|---|
| Sharpness gate | ~1 ms | not isolated by the spike |
| Crop + resize | 1–3 ms | **CPU run: median 36.9 ms, p90 38.0** (P1-3, n = 40). Includes frame → image conversion and packing into Float32. With the GPU delegate: **median 36.6, p90 37.7**. The delegate does not touch this stage. **Later readings are ~60 ms:** P1-6 gave **median 60.4, p90 61.5** (n = 40, CPU, 2026-09-14), and two earlier spot readings agree. Those were taken while charging. **Unplugged** (operator-reported, 2026-09-14): **median 59.7, p90 60.6**, then **59.6 / 61.2** in a second session (n = 40 each, during enrollment). So charging heat does not explain it. Right after a relaunch, over **6 frames only**, it read 35.9. That points at heat from sustained use rather than P1-4's `embedCrop` refactor, but it is unproven. A controlled cold-versus-warm run (n = 40 each) would settle it. Phase 3 work (`NFR-07`); it does not block the Phase 1 gate. **P2-3 session (gate-panel readings, n = 40 each, CPU):** 14:47 **35.8 / 36.6**; 14:55 59.7 / 62.6; 14:58 59.4 / 60.5; 15:01 43.6 / 61.3. So in one session it swung between the P1-3 level and ~60 ms. That is consistent with heat, but the phone's temperature was not recorded, so it is still unproven. |
| TFLite inference | 8–40 ms | **CPU: median 62.8 ms, p90 72.2** (P1-3, n = 40). **`android-gpu` delegate: median 43.2 ms, p90 45.1**, 31% less. Whether GPU vectors match CPU vectors is **not yet measured**, so the delegate is not adopted: τ/δ were calibrated on CPU. |
| L2-normalize | <0.1 ms | **median 0.9 ms** (P1-3, n = 40). Also copies the vector out of the model's output buffer. |
| Sharpness (Laplacian variance, every 2nd px of 224², diagnostic) | ~1 ms (§3 budget) | **median 20.9 ms, p90 21.3** (P1-8 diagnosis, n = 40, 2026-09-14). About 20× the budget, and in the reproduction it did not separate wrong-product frames (`TR-27`). Infinix X6823, release APK. |
| **Per-frame worklet total, split measurement** | **9–43 ms** | **CPU: median 100.7 ms, p90 109.1 · GPU delegate: median 81.2 ms, p90 83.0** — Infinix X6823, release APK, 2026-09-14, n = 40 each. Neither meets `NFR-07`. Crop + resize alone is ~37 ms, so even a free model would leave this stage near the budget. Not directly comparable to the 145.5 ms below: that number also covered converting the vector to a JS array inside the worklet. |
| **Crop + resize + inference + L2, measured as one** | **9–43 ms** | **Release: median 145.5 ms, p90 160.1 ms, range 126.5–339.5 ms** (n = 226 test frames). Debug: 140–248 ms, median ~148 ms (7 spot readings). See note. |
| sqlite-vec KNN | 0.5–3 ms | **Could not run** — sqlite-vec does not load on 32-bit ARM (§5). Measured as a substitute: **JS brute force, 100 shots median 9.2 ms; 2,500 shots median 234.0 ms** (inline loop over one `Float32Array`, n = 10), and 831.1 ms at 2,500 when calling `dot()` per shot. Infinix X6823, release APK, 2026-09-14. |
| Read vectors from SQLite | — | **56.3 ms** for 2,500 × 1280-d BLOBs, bit-exact round trip. Same device and date. |
| Index rebuild after delete / undo / restore (E-4) | rare taps; no budget | **n = 3 (2 delete, 1 undo): median 9.2 ms, p90 17.0, max 17.0**; the last, an undo, took 6.2 ms and left 98 rows. `loadVectorIndex` over 93–98 rows (≤ 96 product shots + 2 negatives) — gate A4, Infinix X6823, release APK, 2026-09-14. Far below a tap's latency; at 2,500 rows the BLOB read alone measured 56.3 ms (above), so a rebuild there is still a rare-tap cost, not per-frame. **Restore, after a relaunch: 23.2 ms** to 103 rows (n = 1, 20:29:03). **P2-7, Directory, small catalog** (side-by-side copy, 2026-09-15): negative delete **2.6 ms**, delete **1.5 ms** to 13 rows, restore **4.8 ms** to 16 rows (n = 1 each). |
| JS brute-force KNN, in the scanner | — | **15 shots: median 1.31 ms, p90 4.23** (P1-6). **100 shots: median 8.52 ms, p90 13.78** (P1-8 gate catalog). n = 200 live frames each, `useScanner`. The 100-shot figure agrees with P1-2's synthetic 9.2 ms. **102 rows (100 shots + 2 negatives): median 8.94 ms, p90 12.30**, n = 60 (P2-3). Infinix X6823, release APK, 2026-09-14. |
| Policy + stability | <2 ms | **median 0.07 ms, p90 0.11** (P1-6, 15 shots) · **0.08 / 0.10** (P1-8, 100 shots). n = 200 live frames each: `match` + `pushDecision` + `lockedDecision`. Same device and date. **With `resolveFrame` added (P2-3), 102 rows: median 0.09 ms, p90 0.12**, n = 60. |
| **Total per frame** | **≤ 60 ms** (NFR-07) | **~126 ms at 15 shots, ~135 ms at 100 shots — not met.** These are **sums of medians**, not one timed span: P1-6 worklet 124.7 + KNN 1.31 + policy 0.07; P1-8 worklet 126.9 + KNN 8.52 + policy 0.08. The JS side is 1–7% of it; the worklet is the problem. |
| **Time-to-lock, p90** | **≤ 1.2 s** (NFR-04) | **Not met: median 1.69 s, p90 2.88 s, max 3.29 s** from the product entering the reticle (n = 19, read off `screenrecord` video; P2-8, Infinix X6823, release APK, 2026-09-15). The app's proxy reads **median 1.15 s, p90 2.01 s** (n = 41) and starts a median **496 ms** late (§3). No episode reached the computed ≈ 0.9–1.0 s for a clean 4-of-5 lock; the fastest took 1.11 s. Recorded, not gate-blocking (E-2); the quorum is not changed in Phase 2 (ADR-016). |

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
