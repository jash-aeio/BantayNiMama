# Changelog

All notable changes to BantayNiMama are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Claude: add an entry under `[Unreleased]` whenever you complete a feature, fix a bug, change
> the schema, or add/remove a dependency.** Reference requirement IDs (`SR-`, `TR-`, `NFR-`) so the
> entry ties back to `PROJECT_SPECS.md`. Do not write an entry for pure refactors that change no
> behaviour.

---

## [Unreleased]

### Added
- Project documentation set: `PROJECT_SPECS.md`, `ARCHITECTURE.md`, `PROJECT_STATUS.md`,
  `DECISIONS.md`, `TOOLING.md`, `CHANGELOG.md`
- `CLAUDE.md` with project conventions and documentation-maintenance rules
- Claude Code project configuration: doc-sync `Stop` hook, project slash commands
  (`/feature-done`, `/phase-gate`, `/spike-report`)
- Git repository initialised with a React Native / Expo `.gitignore`
- Expo SDK 57 dev-client project scaffolding: `app.json`, `metro.config.js` (with `tflite` asset
  extension), `babel.config.js` (worklets plugin), `tsconfig.json` with `strict` and
  `noUncheckedIndexedAccess` (TR-05)
- Phase 0 spike app (`App.tsx`) — VisionCamera v5 preview with a centre reticle, three capture
  modes (enroll / scan / collect), live top-3 with cosine scores and top1−top2 margin (SR-01,
  ADR-006)
- `src/spike/embed.ts` — in-worklet crop → resize → float32 → `runSync` → L2-normalize, throttled
  to 4 fps on the camera thread (TR-21, TR-22, TR-25, TR-26)
- `src/spike/vectors.ts` — pure cosine ranking, best-shot-per-product aggregation and the τ/δ
  decision function (TR-31, TR-32, TR-33, TR-34, TR-37)
- `src/spike/dataset.ts` — dataset capture, persistence under the document directory, and export
  via the system share sheet (no network path, TR-50)
- `scripts/analyze.mjs` — offline accuracy, score histograms, confusion pairs, a (τ, δ) sweep
  constrained to the NFR-02 false-positive ceiling, and Phase 0 gate evaluation
- `scripts/fetch-model.mjs` — reproducible dev-time download of the MobileNetV3-Large embedder
  (TR-20); the 10 MB binary stays gitignored
- `docs/PHASE_0_RUNBOOK.md` — what the spike does, what only the operator can supply, and the
  known risks in the spike itself
- Android build toolchain stood up and verified on the development machine — JDK 17.0.20.1,
  `ANDROID_HOME`, `adb` on PATH, SDK platform `android-36`; `npx expo prebuild` generates the
  native `android/` project on Gradle 9.3.1. This clears Phase 0 blocker A-1 and is what makes a
  dev build possible at all (`TR-03`). Versions are recorded in `docs/TOOLING.md` → "Verified local toolchain".
  **No APK has been compiled and no device has run the app yet**; no NDK is installed.
- `expo-asset` ~57.0.17 as a direct dependency — required to resolve the bundled `.tflite` to a
  real `file://` path in release builds (see **Fixed** below, and ADR-011). It was already in the
  tree transitively and its native module was already autolinked, so nothing new compiles in. For
  an embedded asset it copies out of the APK rather than opening a socket; confirmed in airplane
  mode on device (`TR-50`, `TR-51`, `TR-53`).
- Phase 0 spike app: mistake correction before store capture — *Undo last shot* (enroll),
  *Undo last test frame* (collect), and tap-to-delete a product's shots from the Enrolled list
  with a confirmation. Deleting a product leaves its test frames in place and warns when any
  exist, so the scored set never changes as a side effect. Undo is by position only: shots have no
  id or photo in the spike format. Usage rules, including "never undo a frame because it matched
  wrong" (`NFR-02`), are in `PHASE_0_RUNBOOK.md`. Release APK rebuilt (3m 12s) and installed on
  the Infinix X6823 as an upgrade; the existing 8-shot dataset survived and *Undo last shot*
  renders with its label. The three actions themselves have **not yet been exercised** on device.
- `scripts/analyze.mjs`: warns, before any numbers, about test-frame labels that match no enrolled
  product (after stripping `ambiguous:`; `unknown:` frames are skipped). Collect-mode labels are
  typed by hand, and a typo'd label silently scores as a top-1 miss. Verified on a 6-frame
  synthetic fixture: flags exactly the two mis-spelt labels, passes the correct and `unknown:` ones.
- `PHASE_0_RUNBOOK.md` A-4: test frames must span settings (shelf / in hand / counter), because
  enrollment was shot held in hand under store lighting. A-3 records the dishwashing-liquid and
  cooking-oil size families as further `L-02` cases.
- `PHASE_0_RUNBOOK.md`: labelling decisions for the gate, fixed before any test frame — oil repacks
  and dishwashing-liquid sizes are `ambiguous:` (`L-01`, `L-02`); the Nescafe solo / sugar-free
  twin pair counts in the gate as a variant pair. 21 of 26 products are gated. Also documents the
  USB export route (debug-APK swap + `run-as`), because this phone's share sheet has no local
  save target and Bluetooth failed.
- Phase 0 spike app: *Save dataset to folder* — writes a timestamped copy of the dataset into a
  folder picked with the Android folder picker (`expo-file-system` `Directory.pickDirectoryAsync`,
  already a dependency; local storage only, `TR-50`). The folder is reused for the rest of the
  session and no copy overwrites another. Added because this phone's share sheet offers no local
  save target. Release APK rebuilt (Gradle 3m 59s), same signing certificate, installed on the
  Infinix X6823 as an upgrade. **Verified on device** (2026-09-13): saved
  `Download/BantayNiMama/spike-dataset-20260913-134211.json`, 4,022,207 bytes, SHA-256 identical to
  the pre-upgrade USB copy — so the upgrade kept all 156 shots and the save is byte-exact. The
  second-tap folder reuse was not exercised.
- `scripts/relabel.mjs`: ground-truth corrections for test-frame labels, applied on the laptop
  because the app cannot edit an old frame. Writes a new file and never overwrites the phone
  backup; idempotent, so it re-applies to later exports. It holds only operator-mistake rules, and
  every rule was decided before any analysis ran (runbook A-4, `NFR-02`). Applied to
  `spike-dataset-20260913-232309.json` (225 frames → 221) and `-233955.json` (230 → 226; adds the
  5 retaken egg frames):
  - `unknown:` added to 21 un-enrolled products (105 frames, `NFR-03`), including `oil-pack-5p`,
    which was removed from the catalog.
  - The Nescafe solo / twin frames get `ambiguous:` (`L-02`).
  - The Nissin spicy seafood `55g` typo becomes the enrolled `59g`.
  - 4 frames labelled Dove pink are dropped: the model put egg first, and the operator could not
    confirm they were eggs, so relabelling from the model's guess would have scored them correct
    by construction.
- **Phase 0 gate PASSED** (2026-09-13). Infinix X6823, release APK, `mobilenet_v3_large_embedder_v1`
  (1280-d), 25 products × 6 shots. Test frames (A-4): 230 recorded, 226 after `relabel.mjs` —
  91 gated + 30 `ambiguous:` + 105 `unknown:`, split 2 shelf / 2 in hand / 1 counter per product
  (operator-reported). Source: `spike-dataset-20260913-233955.labeled.json`.
  - Gate (Q-1): top-1 **94.5%** (86/91; 95% CI 87.8–97.6%) ≥ 85% → **PASS**. Top-3 **100%**.
    Including `ambiguous:` frames, top-1 92.6% (112/121), and all 30 land in the right size family.
  - The 5 misses: Dove pink → blue ×2, Dove blue → pink, Datu Puti vinegar bottle → Clover chips,
    Datu Puti sakto vinegar → Colgate sachet. The Nissin pair was 10/10.
  - Distributions: correct top-1 p05 0.465, median 0.653; wrong top-1 0.486–0.642; un-enrolled
    top-1 median 0.460. Correct margins median 0.169; wrong margins all ≤ 0.039.
  - τ = 0.46, δ = 0.075 (Q-2): correct accepts **74.7%** (`NFR-01` ≥ 90%, not met); false
    positives **1.5%** (3/196, `NFR-02` ≤ 2%), all Zonrox bottles accepted as Datu Puti vinegar.
  - `NFR-03`: only **49.5%** (52/105) un-enrolled frames return Unknown; 50 fall into disambiguate.
    `analyze.mjs` prints 97.1% because it counts anything not auto-accepted as rejected.
  - Latency, release APK: median 145.5 ms, p90 160.1 ms, max 339.5 ms (n = 226); `NFR-07` not met.
- `docs/PHASE_1_PLAN.md` — Phase 1 plan, approved 2026-09-14. It sets out the readiness verdict,
  housekeeping, and work steps P1-1 to P1-8 in risk order: a device checkpoint for
  op-sqlite + sqlite-vec comes first. It also lists what is deferred to Phases 2–4, the risks
  carried in (`NFR-07` latency, the untested frame-vs-JPEG enrollment gap), and the measurements
  Phase 1 must record. Decisions settled with the operator:
  - **D-1 gate:** after force stop and relaunch, row counts, `app_meta` and photo paths must
    survive. Every stored JPEG must re-embed to its own nearest vector (`TR-24`). Each of 20
    products must lock correctly or appear as a disambiguation chip (`TR-32`, `TR-33`). Any
    wrong lock fails the gate (`NFR-02`).
  - **D-2:** `node --test` for `src/domain/` (ADR-012).
  - **D-3:** the golden replay of the Phase 0 dataset is a local-only test that fails loudly
    when the file is absent (ADR-012).
  - **D-4:** Claude drafts `fil.json` and the operator corrects it (`SR-42`).
- Checked before planning (2026-09-14):
  - `@op-engineering/op-sqlite` 18.2.1 bundles `libsqlite_vec.so` for `armeabi-v7a`, the test
    phone's ABI.
  - Its only socket-opening paths are `openSync` / `openRemote`, which need the `libsql` build
    flag (`TR-51`).
  - `scripts/analyze.mjs` and `relabel.mjs` import nothing from `src/spike/`.
- **P1-1 — `src/domain/`, the pure domain layer** (2026-09-14). 40 tests under `node --test`;
  no device and no network needed (`TR-37`, `TR-53`).
  - `match.ts` — groups shots into products by best shot, then ACCEPT / DISAMBIGUATE / UNKNOWN
    at τ/δ (`TR-30`–`TR-35`). Beyond the spike's `decide()`:
    - an exact top-1/top-2 tie never auto-accepts;
    - a NaN or out-of-range τ/δ throws instead of accepting everything (`NFR-02`);
    - non-finite similarities are dropped.
  - `stability.ts` — 3-of-5 lock (`TR-36`, `SR-12`). A disambiguation pair agrees in either
    order, Unknown can lock, and the lock returns the newest agreeing decision.
  - `money.ts` — `parsePesos` works on the typed digits, never a float (`"0.29"` → `29`), and
    rejects anything it would have to round. `formatCentavos` renders `₱1,250.00` (`TR-41`,
    ADR-007).
  - `vector.ts` — `dot` throws on a dimension mismatch rather than truncating (`TR-23`);
    `l2Normalize` refuses a zero or NaN vector (`TR-22`).
  - `match.golden.test.ts` — replays the Phase 0 labeled dataset through the new policy. It
    reproduces the gate exactly: top-1 86/91; enrolled frames 68 / 19 / 4
    (accept / disambiguate / unknown); un-enrolled frames 3 / 50 / 52; all 3 false accepts →
    Datu Puti vinegar. It also proves `TR-30`'s `LIMIT 10` never changes top-1 or top-2 on that
    data. **Verified:** without `spike/results/` it fails with restore instructions rather than
    skipping (ADR-012).
- `@types/node` ~22.20.2 as an explicit devDependency. It was already installed, but only as a
  dependency of another package; it is types only, with no runtime code (`TR-51`).
- `tsconfig.test.json` — typechecks `src/domain/` with Node types. TypeScript 6 no longer loads
  every installed `@types` package by default. Adding `node` globally would leak Node's types
  (e.g. `setTimeout`'s return type) into React Native app code, so test files are excluded from
  the app typecheck and checked separately.
- **P1-2 (in progress) — `@op-engineering/op-sqlite` ~18.2.1 with sqlite-vec enabled** through
  `"op-sqlite": { "sqliteVec": true }` in `package.json` (`TR-13`, `TR-40`, ADR-003).
  - **Network audit (`TR-51`):** there is no network code in its JS API, Android Kotlin or core
    C++. Network code exists only in the optional libsql and turso backends, which stay disabled;
    `openSync` / `openRemote` need them.
  - **Versions:** it bundles sqlite-vec **v0.1.7-alpha.2** (read from the `armeabi-v7a`
    `libsqlite_vec.so`), loaded as an extension inside `open()`, which throws if it cannot load.
  - `src/db/open.ts` — `openDatabase()` opens `bantay.db` in the document directory, next to
    `photos/` (`TR-46`). The location is explicit because op-sqlite otherwise defaults to Android's
    `databases/` folder, outside the export layout. A location starting with `/` is used as-is
    (read from `OPSqlite.cpp`).
  - `src/db/probe.ts` — the P1-2 day-one checkpoint, shown in the spike app and written to logcat.
    It checks three things:
    - `open()` succeeds and `vec_version()` answers on `bantay.db`;
    - an in-memory `vec0` table with the `ARCHITECTURE.md` §5 shape (text `shot_id` primary key,
      `product_id`, `float[1280]`, cosine) returns nearest-neighbour rows;
    - a nearest-neighbour query can filter on `product_id` (`PHASE_1_PLAN.md` §7).

    Temporary — removed once schema v1 lands.
  - **Checkpoint FAILED on device.** Infinix X6823, Android 12, release APK built for
    `armeabi-v7a` only (Gradle 5m 47s), 2026-09-14. All three probe steps throw
    `dlopen failed: cannot locate symbol "ceil" referenced by …/lib/armeabi-v7a/libsqlite_vec.so`.
    - **Cause (`llvm-readelf`, NDK 27.1):** op-sqlite 18.2.1's prebuilt `armeabi-v7a`
      `libsqlite_vec.so` leaves `ceil` undefined but lists only `libdl.so` and `libc.so` as
      `NEEDED`; `ceil` lives in `libm.so`.
    - **64-bit:** the `arm64-v8a` build has no undefined `ceil`, so 64-bit phones would probably
      load it. Not tested: this phone reports `abilist` = `armeabi-v7a,armeabi`.
    - **Not the cause:** the APK was packaged correctly (`libop-sqlite.so`, `libsqlite_vec.so`,
      embedded JS bundle), and SQLite itself was never the problem.
    - **Upstream:** 18.2.1 is the latest release and no existing issue matched, so the bug is now
      reported as [OP-Engineering/op-sqlite#456](https://github.com/OP-Engineering/op-sqlite/issues/456).
  - **Response, decided with the operator:** measure JS search on the phone before choosing
    between building sqlite-vec ourselves and searching in JS.
    - op-sqlite's bundled sqlite-vec is switched **off** (`"sqliteVec": false`). Both fixes need
      it off: with it on, `open()` throws before SQLite is usable.
    - `src/db/probe.ts` now checks that plain SQLite opens `bantay.db`, and that a 1280-d
      `Float32Array` survives a BLOB round trip bit for bit. It also times reading 2,500 vector
      BLOBs, and brute-force JS KNN at 100 and 2,500 shots (inline loop, and through
      `src/domain`'s `dot()`).
    - **Results** — Infinix X6823, release APK, Hermes, `armeabi-v7a`, Gradle 1m 35s, 2026-09-14.
      The APK no longer contains `libsqlite_vec.so`.
      - Plain SQLite 3.51.3 opens `/data/user/0/com.jash.bantaynimama/files/bantay.db`, the same
        folder as `photos/` (`TR-46`).
      - Vector BLOBs: a 1280-d `Float32Array` round trip is bit-exact, and reading 2,500 BLOBs
        takes **56.3 ms**.
      - JS brute-force KNN (score every shot → top 10 → `rankProducts`), n = 10 runs after one
        warm-up. With an inline loop over one `Float32Array`: 100 shots median **9.2 ms**;
        2,500 shots median **234.0 ms** (p90 234.4). Calling `src/domain`'s `dot()` per shot:
        2,500 shots median **831.1 ms**, 3.5× slower. A `subarray` per call is costly on Hermes,
        which has no JIT.
      - **Consequence:** cost grows in proportion to shots (25× the shots took 25× the time). JS
        search fits Phase 1's 20 products. At `NFR-09`'s 500 products (2,500 shots) it would take
        ~234 ms of the 250 ms frame interval at 4 fps (`TR-26`), so it cannot meet `NFR-09` on
        this phone.
      - The first screen stayed white for about a minute: the checkpoint runs synchronously during
        the first render. Checkpoint-only; not a finding about the app.
  - **Decision (operator, ADR-014): vectors as BLOBs, searched in JS; native search later.**
    - Vectors move into `product_shots.embedding` (BLOB), and the `vec0` table leaves the schema.
    - Search becomes a pure inline loop over an in-memory matrix rebuilt from SQLite.
    - `TR-13`, `TR-30` and `TR-40` are amended, and ADR-003's sqlite-vec half is superseded.
    - Native search stays owed for `NFR-09` and is tracked for Phase 3.
- **P1-2 — search, schema v1 and the storage layer** (2026-09-14). Domain tests 40 → **74**;
  typecheck clean.
  - **Domain (pure, tested):**
    - `knn.ts` — brute-force top 10 over one contiguous Float32 matrix. It uses an inline loop and
      a small sorted buffer rather than a full sort (`TR-30`, ADR-014). Vectors of the wrong
      dimension are refused (`TR-23`), and non-finite similarities never rank.
    - `vector.ts` — `vectorToBlob` / `blobToVector`: always little-endian Float32, size-checked.
    - `appMeta.ts` — strict parsing of `app_meta` text: a blank τ is refused, not read as 0
      (`TR-35`). `confirm_below` stays optional until calibrated (`TR-38`).
    - `migrations.ts` — forward-only plan; refuses gaps, repeats, and a database newer than the
      app (`TR-44`).
    - `photoPath.ts` — only relative, non-escaping photo paths (`TR-43`). `money.ts` gains
      `isCentavos`.
    - The golden replay now searches through `knn.ts`. It reproduces the Phase 0 gate exactly,
      so Float32 storage moved no decision.
  - **Storage (`src/db/`):**
    - `schema.ts` — migration 1: `products`, `product_shots` with `embedding BLOB`,
      `price_history` and indexes. `CHECK` constraints make SQLite reject float or negative prices
      (`TR-41`). It seeds `model_id`, `embedding_dim`, τ 0.46 and δ 0.075 once, as data.
    - `migrate.ts` — one transaction per version, including its `schema_version` bump.
    - `transaction.ts` — synchronous `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`.
    - `products.ts` — `insertProductWithShots` validates everything before `BEGIN`, then writes
      product + shots in one transaction (`TR-45`). Also `getProduct`.
    - `shots.ts` — `loadVectorIndex`. Shots from another model are counted, not silently dropped
      (`TR-24`).
    - `meta.ts` reads `app_meta`; `ids.ts` makes UUID v4s without a native crypto dependency.
    - `open.ts` turns foreign keys on per connection, and keeps SQLite's default journal mode so
      the database stays one file (`TR-46`).
  - `devCheck.ts` replaces the checkpoint probe. On the phone it migrates `bantay.db`, runs
    enroll → close → reopen → search on a throwaway file, and checks that a failed transaction
    leaves no row.
  - **Verified on device** — Infinix X6823, release APK (`armeabi-v7a`, Gradle 42 s), 2026-09-14.
    All three checks passed:
    - `bantay.db` migrated from schema 0 to 1. `app_meta` parsed back as
      `mobilenet_v3_large_embedder_v1`, 1280-d, τ 0.46, δ 0.075, `confirm_below` not set
      (`TR-35`, `TR-38`, `TR-44`).
    - Enroll → close → reopen → search: 3 shots reloaded from BLOBs in 0.6 ms. Each shot's own
      vector came back as the top hit at similarity 1.000000, and the price read back as 1250
      centavos (`TR-41`, `TR-45`, ADR-014).
    - A transaction that threw after its first `INSERT` left no row behind (`TR-45`).
  - **Found in passing:** the phone's font drew the `→` arrows in these debug lines as a wrong
    glyph, while τ and δ rendered correctly. Keep arrows out of user-facing copy (P1-7, `SR-42`).
- **P1-3 — the ML module** (2026-09-14). `src/ml/` replaces `src/spike/embed.ts`, which is
  deleted. Domain tests 74 → **88**; typecheck clean.
  - `src/ml/model.ts` — the model id, input size (224), reticle fraction (0.55) and target frame
    rate (4 fps), shared by scanning and enrollment so the two paths cannot crop differently.
  - `src/ml/loadModel.ts` — `expo-asset` → `file://` → `loadTensorflowModel` (`TR-29`), on CPU or
    the `android-gpu` delegate.
    - It refuses a model URL that is not a local file. The loader would fetch `http(s)` (`TR-51`).
    - It checks the model's own tensors: input float32 `[1,224,224,3]`, output float32. A
      different model file then fails at load instead of scoring quietly wrong (`TR-21`).
  - `src/ml/frameEmbedder.ts` — the camera-thread worklet (`TR-25`). It posts a `Float32Array`,
    where the spike posted `number[]` (`ARCHITECTURE.md` §2).
    - It times crop + resize, `runSync` and normalization separately, because Phase 0's 145 ms
      was one undivided number.
    - It throws instead of returning null, so the reason a frame failed reaches the screen.
    - A comment in the spike was wrong: `new Float32Array(head)` is a view of the model's output
      buffer, not a copy. The copy really comes from `l2Normalize`.
  - `src/ml/stillEmbedder.ts` — embeds a saved square JPEG on the JS thread, for enrollment and
    for `TR-24` re-embeds. It refuses non-square images, which would be stretched. **Not yet
    exercised on device**; that is P1-4, once reference JPEGs exist.
  - `src/domain/pixels.ts` — `channelLayout`, `toModelInput` (byte × 1/255, `TR-21`) and
    `reticleRect`, all marked `'worklet'`, so both embedders run this same tested code. A pixel
    buffer of the wrong size throws rather than being read with shifted rows. `l2Normalize` is
    marked `'worklet'` too.
  - `src/domain/stats.ts` — nearest-rank median / p90 / max, so every reported latency is a real
    sample.
  - The spike app now runs on `src/ml`, with a temporary CPU / GPU switch and a live per-stage
    timing readout over the last 40 frames.
  - **Verified on device** — Infinix X6823, release APK (`armeabi-v7a`, Gradle 47 s), 2026-09-14.
    Live frames give 1280-d vectors at length 1.00000 (`TR-20`, `TR-22`). Per-stage timings,
    median / p90 over n = 40 frames each:

    | Stage | CPU | `android-gpu` delegate |
    |---|---|---|
    | Crop + resize (incl. frame conversion and Float32 packing) | 36.9 / 38.0 ms | 36.6 / 37.7 ms |
    | `runSync` | 62.8 / 72.2 ms | **43.2 / 45.1 ms** |
    | Normalize | 0.9 / 0.9 ms | 0.9 / 0.9 ms |
    | **Total** | **100.7 / 109.1 ms** | **81.2 / 83.0 ms** |

  - **Consequences:**
    - `NFR-07` (≤ 60 ms) is not met on either path.
    - The GPU delegate cuts inference by 31% but leaves crop + resize (~37 ms) untouched. That
      stage is the next lever, not a model swap.
    - The GPU delegate is **not adopted**: nobody has checked that its vectors match CPU's, and
      τ/δ were calibrated on CPU.
    - Phase 0's 145.5 ms is not directly comparable, because it also covered building a JS array
      in the worklet.
  - **Found in passing:** `adb` twice lost its shell channel mid-install. `adb shell` answered
    `error: closed` while `adb devices` still listed the phone. Restarting the local adb server
    fixed it; this was not an app fault.
- **P1-4 — the reference photo store** (2026-09-14). Domain tests 88 → **93**;
  typecheck clean.
  - `src/domain/referencePhoto.ts` — `referencePhotoPath(shotId)` gives `photos/<id>.jpg`,
    relative (`TR-43`), and refuses ids unsafe as file names. `referenceSide` applies `TR-42`'s
    512 px cap but never upscales: at 0.55 of a 720 px frame edge, the reticle is 396 px, and
    enlarging it only adds bytes (`NFR-08`).
  - `src/db/photos.ts` — saves a square crop as a q80 JPEG under `photos/`, lists photos with
    sizes, deletes one. Absolute paths are worked out at use and never stored. A missing or empty
    file after saving throws, because a shot without its photo could never be re-embedded
    (`TR-24`).
  - `src/ml/frameEmbedder.ts` — `captureReference` cuts **one** reticle crop and uses it twice:
    through the scanning path for the live vector, and at the stored size for the JPEG. The only
    differences left to measure are the extra resize and the JPEG encoding. The pixel buffer is
    copied before the native image is freed.
  - **One model instance per thread.** JPEGs are embedded on the JS thread with a **second,
    CPU-only** model instance, because the camera worklet is running `runSync` on the first, and
    one TFLite interpreter must not run on two threads at once. P1-5 enrollment inherits this.
  - `src/dev/referenceCheck.ts` (temporary) — for each capture it records the frame-vs-JPEG dot
    product and the JPEG size. A sidecar lets the next launch re-embed every stored photo and
    compare it with its saved vector.
  - The spike app gains "P1-4 capture" (a synchronizable flag the worklet reads) and
    "Clear P1-4".
  - **Measured on device** — Infinix X6823, release APK, CPU, 10 captures of **one static scene**,
    2026-09-14:
    - Frame-vs-JPEG vector agreement: dot **min 0.9803, median 0.9843**.
    - JPEG size: **median 17.5 KB, max 17.6 KB** per shot, so about 88 KB per 5-shot product
      against `NFR-08`'s 200 KB. A busier label may compress less well.
    - The frame is **1280 × 720**, so the reticle crop is **396 px** and is stored at 396 px,
      not upscaled to 512.
  - **What the agreement means:** a dot of 0.984 puts the two unit vectors √(2 − 2·0.984) ≈ 0.18
    apart. That is the most any similarity score can move. The typical move is far smaller, but it
    has not been measured on real products, and δ is 0.075. Phase 0 calibrated τ/δ on live-frame
    vectors, while enrolled vectors now come from JPEGs. So the P1-8 gate and the Phase 3 retune
    must use JPEG-path vectors.
  - **Survives a force-stop.** After `am force-stop` and relaunch, all 10 photos were on disk
    (175.5 KB total). Each re-embedded to dot **1.000000** with the vector saved before the stop.
    So the store persists, and re-embedding from JPEGs is deterministic on CPU (`TR-24`,
    `TR-43`). The 10 test photos stay on the phone for now; P1-5 clears them.
  - **Fixed before it shipped: every frame failed with "undefined is not a function".**
    - **Symptom:** the first P1-4 APK processed no frames at all.
    - **Diagnosis:** a diagnostic build with stack lines pointed inside `embedFrame`, not at the
      new capture flag.
    - **Cause:** declaration order. The worklets Babel plugin turns each `'worklet'` function into
      an object that captures the functions it references when that object is created. The new
      `embedCrop` helper was declared *below* `embedFrame` and `captureReference`, so both
      captured it as `undefined`.
    - **Why nothing caught it:** plain JavaScript hoists function declarations, so neither the
      typecheck nor the Node tests could see it.
    - **Fix:** helpers now sit above the worklets that call them, and the rule is recorded in
      `ARCHITECTURE.md` §2 and `CLAUDE.md`.
- **P1-5 — enrollment** (2026-09-14, **verified on device**). Domain tests 93 → **107**;
  typecheck clean.
  - `src/domain/enrollment.ts`:
    - `parseEnrollmentForm` covers `SR-21`. Name and per-piece price are required, and every
      error is returned at once. Prices go through `parsePesos`, never a float (`TR-41`). A zero
      price is refused as a typo (`NFR-02`).
    - `likelyDuplicates` covers `SR-23`. It merges each new shot's KNN hits, ranks products by best
      shot and keeps those at or above τ from `app_meta` (`TR-35`). It warns and never blocks,
      because size variants are supposed to look alike (`L-02`).
    - `MIN_SHOTS` / `MAX_SHOTS` moved here from `db/products.ts`.
  - `src/features/enrollment/` covers `SR-20`, `SR-24` and `TR-45`, writing files first and rows
    last:
    - `captureShot` saves the JPEG when the photo is taken, then embeds **that JPEG** with the
      CPU still model. The stored vector is therefore the production path's, and also what a
      re-embed after a model swap gives (`TR-24`). The live-frame vector is kept only to measure
      agreement.
    - `commitEnrollment` writes product + shots in one transaction, and deletes the draft's JPEGs
      if it throws.
    - `useEnrollment` extends the in-memory index only after COMMIT, so the next frame can match
      the product (`SR-24`).
    - `EnrollmentPanel` has the form, 3–5 thumbnails (tap to remove), a live duplicate warning
      and a "Save anyway" confirmation.
  - `insertProductWithShots` takes each shot's id from the caller, because the photo is already
    saved under it. It refuses a `photoPath` other than `photos/<id>.jpg`, so a row can never point
    at another shot's photo (`TR-24`, `TR-43`).
  - `src/db/catalog.ts` — `openCatalog()` runs once at launch. It migrates, reads `app_meta`, and
    **refuses a database whose `model_id` is not the bundled model** (`TR-23`). It then removes
    orphan photos and builds the index.
  - **Orphan-photo sweep.** A kill between saving JPEGs and COMMIT leaves photos with no row. At
    launch, `unreferencedPhotos` names files in `photos/` that no `product_shots` row references,
    soft-deleted products included. Those are deleted. Nothing is deleted if the query fails. The
    sweep runs only at launch, because a draft's photos have no row yet. **On device:** the first
    launch of the P1-5 release APK on the Infinix X6823 reported 10 removed, which is the P1-4 check
    photos, with schema 1, τ/δ read from `app_meta` and 0 products (2026-09-14).
  - **i18n pulled forward from P1-7** (`TR-16`, `SR-42`). The operator decided enrollment copy
    should not be hardcoded, even for one step.
    - Added `i18next` ~26.4.2 and `react-i18next` ~17.0.14. Audited against `TR-51`: neither
      package, nor `html-parse-stringify`, `void-elements` or `use-sync-external-store`, contains
      `fetch`, `XMLHttpRequest`, `WebSocket` or `sendBeacon`. Their only URLs are in comments.
      No backend plugin is installed.
    - `src/i18n/en.json` and `fil.json` hold the enrollment copy. `fil.json` is Claude's draft,
      for the operator to correct (D-4).
    - Keys are typed, so an unknown key fails typecheck. Checked with a probe.
    - Each file must have every key of the other, which is also enforced at compile time.
    - Device-locale detection (`expo-localization`) stays in P1-7.
  - `App.tsx` (still the temporary dev host) now has two modes:
    - **Enroll** — the real panel, plus a frame-vs-JPEG agreement and bytes readout over this
      session's shots.
    - **Scan** — a lock readout (`knn` → `match` → `stability`) with top 3 and per-frame search
      time. It lets P1-5's "enroll → scan → locks" be checked before P1-6.
    - An `en` / `fil` switch.
  - **Measured on device** — Infinix X6823, release APK, CPU, 2026-09-14:
    - Enrolled Reno Liver Spread, Argentina Corned Beef 260g and Argentina Corned Beef 100g, 5 shots
      each. When the second Argentina was saved, the duplicate warning fired and "Save anyway" was
      used (`SR-23`).
    - Relaunched after enrolling: 3 products / 15 shots, index 15, orphan sweep 0 (`TR-45`
      persistence).
    - Scanned in order Reno → 260g → 100g, 19 screenshots 5 s apart. Frames were matched to
      products by that order (operator-reported):
      - **Reno: LOCK** ₱20.00, score 0.750 / 0.746, margin 0.237 / 0.254.
      - **260g: LOCK** ₱35.00, score 0.881, margin 0.160. Then **CHIPS** 260g | 100g, margins
        0.042 / 0.021 / 0.012. The frame-level top-1 flipped between the two sizes, and the
        stability gate held it as chips.
      - **100g: CHIPS** only (0.821 vs 0.805). It never locked, as expected for a size-only pair
        (`L-02`).
      - Empty and in-between frames: UNKNOWN (best ≤ 0.37).
      - **Zero wrong locks.** A new product locked with no restart (`SR-24`).
    - KNN + policy + stability read **1.4–4.3 ms** per frame at 15 shots. This is a spot reading
      from the screen, not a timed run; P1-6 times it.
    - **Not recorded:** frame-vs-JPEG agreement on real products. The readout lasts one session
      and was lost to the relaunch; it is owed before P1-8.
- **P1-6 — scanner** (2026-09-14, **verified on device**). Domain tests 107 → **114**;
  typecheck clean.
  - `src/domain/confidence.ts` — the `SR-03` indicator is three bands built from the policy's
    own δ (the operator chose this over a score bar or a percentage):
    - ACCEPT with margin ≥ 2δ → **Sure**.
    - ACCEPT with a smaller margin → **Likely**.
    - ACCEPT with no second product in the running → **Likely**, never Sure, because a lone
      candidate proves nothing (ADR-013).
    - DISAMBIGUATE → **Not sure**.
    - δ comes from `app_meta` (`TR-35`). Only the 2× multiple is a constant
      (`SURE_MARGIN_IN_DELTAS`), a placeholder that Phase 3 retunes. No number or percentage is
      shown, because a similarity is not a probability.
  - `src/features/scanner/useScanner.ts` — the JS-thread path: `nearestShots` → `match` →
    `pushDecision` → `lockedDecision` (`TR-30`–`TR-36`).
    - React state changes **only when the lock's key changes**, never per frame (`SR-12`).
    - When quorum is lost, the overlay **clears to "scanning" instead of holding the last lock**.
      Holding it could leave a confident price on screen while the camera sees something else
      (`NFR-02` outranks flicker).
    - KNN and policy + stability are timed separately each frame. The last 200 frames are kept in
      a ref, for `ARCHITECTURE.md` §8.
  - `src/features/scanner/ScanOverlay.tsx` — plain RN views over the camera, every string
    translated:
    - **LOCK:** name, price in large type (with "/ unit" when set), the whole-pack price when set,
      and confidence bars (`SR-02`, `SR-03`).
    - **UNKNOWN:** "Unknown item" and **Add**, which opens enrollment in one tap with the camera
      still live (`SR-04`, `SR-05`).
    - **CHIPS:** "Which one is it?" and two product chips. A tap shows that product's price, and
      any new lock clears the choice (`SR-09`).
    - A locked id with no product row shows no price at all.
  - `en.json` / `fil.json` gain the `scan` strings. `fil` is Claude's draft (D-4).
  - `App.tsx` dev host:
    - It opens in scan mode, and the panel shrinks to 26% there.
    - Diagnostics (worklet stages, JS KNN and policy median/p90, last top 3) refresh once a second
      from refs.
    - The `→` in the catalog line is now "to", because the phone's font did not render it.
  - **Measured on device** — Infinix X6823, release APK, CPU, 3 products / 15 shots, 2026-09-14.
    18 screenshots were taken 5 s apart. Each one was checked against the product actually inside
    the reticle, not assumed from the scan order.
    - **Locks: 3, all correct.** Argentina 100g ₱25.00 once, Argentina 260g ₱35.00 twice. All
      three read *Likely*: no margin reached 2δ this run.
    - **Wrong locks: 0.**
    - **Chips:**
      - The size pair gave 260g | 100g. Tapping 100g showed ₱25.00 (`SR-09`).
      - Reno held sideways gave 100g | Reno. Tapping Reno showed ₱20.00.
      - **Near miss:** on those Reno frames Argentina 100g ranked top-1, and only the δ margin kept
        it from a wrong lock. In P1-5, Reno held upright locked at 0.750. This goes to the Phase 3
        retune (`NFR-01`, `NFR-02`).
    - **Unknown:** an un-enrolled ascorbic acid blister pack, motion-blurred frames and empty
      frames all read **Unknown item** + Add (`SR-04`). Tapping Add was not exercised.
    - **JS thread**, n = 200 frames: KNN **median 1.31 ms, p90 4.23**; policy + stability
      **median 0.07, p90 0.11** (`ARCHITECTURE.md` §8).
    - **Worklet**, n = 40, while charging: crop+resize **60.4** / 61.5, `runSync` 63.5 / 76.3,
      total **124.7** / 142.9 ms median / p90. Crop+resize is up from P1-3's 36.9 ms, with the cause
      unconfirmed. `NFR-07` stays unmet, and the JS side is ~1% of the per-frame cost.
- **P1-7 — app shell** (2026-09-14, **verified on device**). Domain tests 114 → **131**;
  typecheck clean.
  - **Navigation (`TR-14`, ADR-015):** `@react-navigation/native` ~7.3.18 +
    `@react-navigation/bottom-tabs` ~7.18.18, with `react-native-screens` ~4.26.0 and
    `react-native-safe-area-context` ~5.7.0 at SDK 57's pins. Two tabs:
    - **Scan:** one camera, live only while the tab is focused (`NFR-06`). It holds the overlay, a
      "+ Add product" button, and enrollment sliding up under the preview (`SR-05`).
    - **Products:** a plain list from SQLite, with name, price, pack price and photo count.
  - **Language (`TR-16`, `SR-42`):** `expo-localization` ~57.0.2.
    - `src/domain/language.ts` picks the saved `app_meta.ui_language` first, then the phone's first
      supported locale (`fil` or legacy `tl` → Filipino), then English.
    - The switch on the Products tab applies immediately and is saved.
  - **Network audit (`TR-51`):** 25 packages read before install, the SDK-pinned screens and
    safe-area versions included. Zero hits for JS network calls (`fetch`, XHR, WebSocket,
    `sendBeacon`) or native HTTP clients (`HttpURLConnection`, OkHttp, `URLSession`).
    `expo-router` was also read: its network code is inert unless enabled (ADR-015).
  - **Gate check (`PHASE_1_PLAN.md` §4 steps 3–4):**
    - `src/domain/gateCheck.ts` is pure. `persistenceProblems` covers an empty catalog, `app_meta`
      versus this build, index plus other-model shots versus shot rows, and missing photos.
      `selfMatchReport` requires each re-embedded photo's nearest neighbour to be its own vector,
      and reports own-score and nearest-other-shot distributions.
    - `features/gate/runGateCheck` re-embeds every searchable JPEG and yields to the UI between
      photos.
    - The collapsed **Gate check** section on the Products tab shows the result and latency
      readouts. The screen is the record: its `console.log` output never reached logcat in the
      release build, and neither did the launch `[catalog]` line.
  - **Services:** `src/app/services.ts` shares one catalog connection, the live index, both model
    instances, the language and the diagnostics refs, all created once in `Root`.
  - **New repositories:** `listProducts`, `listShotRows`, `photoExists`, `readMetaValue` /
    `writeMetaValue` and `LATEST_SCHEMA_VERSION`.
  - **New copy:** app, camera, tabs, products, settings and gate strings in `en` + `fil`. The gate
    readout lines are developer diagnostics and stay English.
  - **Fixed before it shipped: tab labels clipped by the navigation bar.**
    - **Symptom:** on the first P1-7 APK (Infinix X6823), the bottom of "Scan" and "Products" was
      hidden behind Android's navigation-bar scrim.
    - **Not the inset:** the phone reports the navigation bar at y 1544–1640 (48 dp), and the tab
      bar was 195 px tall, i.e. 49 dp of content plus that 48 dp inset.
    - **Cause:** `tabBarIcon: () => null` left an empty icon slot above each label. That pushed the
      16 sp label below the bar's content area.
    - **Fix:** `tabBarIconStyle: { display: 'none' }` with `tabBarLabelPosition: 'beside-icon'`.
      Re-checked on device: both labels are centred and fully visible.
  - **Measured on device** — Infinix X6823, release APK, CPU, 2026-09-14:
    - **Launch:** no crash. The Scan tab shows "+ Add product" and the overlay. The Products tab
      lists products by name with prices and photo counts.
    - **Enroll from the Scan tab:** the operator saved a 4th product, Clover Chips 24g
      (₱12.00 / pack), through the new form.
    - **Language:** after switching to Filipino, force-stopping and relaunching (new process id),
      the app came back in Filipino: "Paninda", "I-scan", "5 litrato" (`SR-42`, `app_meta.ui_language`).
    - **Gate check PASS**, on the 4 products / 20 shots:
      - **Step 3:** index 20, other-model 0, schema 1, `mobilenet_v3_large_embedder_v1`, 1280-d,
        τ 0.46, δ 0.075, 20 photo rows, **0 missing**.
      - **Step 4:** self-match **20/20**, own score **min 1.000000**, median 1.000000. The nearest
        other shot scored median 0.7186, p90 0.7815, **max 0.8679**.
      - **Took 2.4 s** (about 120 ms per photo).
    - **Worklet**, n = 40: crop+resize **59.6** / 60.8, `runSync` 64.8 / 71.3, total **125.6** /
      134.4 ms median / p90. That is the fourth reading near 60 ms for crop+resize. Battery was at
      100%; whether the charger was connected was not recorded.
    - **Camera pausing on the Products tab:** operator-reported, not measured.
  - **Measured with the restored readout** while enrolling toward the gate (2026-09-14, n = 40
    shots, Infinix X6823, release APK, CPU):
    - Frame-vs-JPEG agreement on real products: dot **min 0.9882, median 0.9960**. This closes
      the item owed before P1-8; P1-4 had measured only one static scene.
    - JPEG size: **21.9 KB median, 32.5 KB max** per shot, within `NFR-08`.
    - The worklet read crop+resize **59.7** / 60.6 ms, `runSync` 71.6 / 82.2, total **132.0** /
      144.2 (n = 40, **unplugged**, operator-reported). So the ~60 ms crop+resize is not charging
      heat. After a relaunch, over 6 frames only, crop+resize read 35.9 ms. That points at heat
      from sustained use rather than code, but 6 frames prove nothing; a cold-versus-warm run
      (n = 40 each) would settle it.
    - **Second enrollment session** (9 more products, n = 52 shots, unplugged, operator-reported):
      - Frame-vs-JPEG dot: **min 0.9804, median 0.9963**. The minimum is about P1-4's one-scene
        worst (0.9803) and bounds a score shift at ≈ 0.20.
      - JPEG: 24.2 KB median, 34.1 KB max, so ≤ 170.5 KB for five worst-case shots.
      - Worklet: crop+resize **59.6** / 61.2, `runSync` 72.5 / 75.9, total **133.2** / 138.0 ms.
  - **Readout restored after the device check:** the per-session frame-vs-JPEG agreement and JPEG
    size line lived only in the deleted dev host. It moved to the gate check section
    ("enrollment shots this session"), fed from `useEnrollment` through the shared diagnostics refs.
    It is still owed before P1-8 on real products, and still lost on relaunch.
- **P1-8 — gate run, first attempt** (2026-09-14, Infinix X6823, release APK, CPU). **Not yet a
  pass.**
  - **Setup:** 20 products / 100 shots, enrolled through the app. Same-brand pairs: Alaska
    140/360 ml and Argentina 100/260 g (size-only, `L-02`); Lucky Me Noodle Soup Beef / Spicy
    Labuyo Beef; Lucky Me Pancit Canton Chilimansi / Kalamansi; Knorr Chicken / Pork; Datu Puti
    Soy Sauce / Vinegar. Force-stop confirmed (new process), airplane mode on (`TR-53`).
  - **Steps 3–4 PASS:** 0 missing photos; self-match 100/100, own score min 1.000000; nearest
    other shot median 0.7512, max 0.8954; 11.7 s. The check ran after the scan step, in the same
    process; scanning writes nothing.
  - **Step 5 (scan all 20), sampled:** 57 screenshots about 6 s apart, each checked against the
    product in the reticle. Size pairs were attributed by list order.
    - **19/20 observed correct:** 13 LOCK, 6 chips containing the right product.
    - **0 wrong locks observed.**
    - **Piattos Cheese 18g not observed:** one screenshot, still settling on Unknown.
    - **Why it is not a pass:** a product is missing, and a wrong lock shorter than ~6 s could fall
      between screenshots.
    - **Near misses:** Datu Puti Soy Sauce ranked Vinegar top-1 (shown as chips), and Lucky Me Beef
      was once chipped with Pancit Canton Chilimansi. Chips were tapped four times, which only shows
      a price.
  - **Latency at 100 shots:** KNN 8.52 / 13.78 ms, policy + stability 0.08 / 0.10 ms (n = 200).
    Worklet crop+resize 59.2, total 126.9 ms (n = 40).
- **Lock log for the gate run** (2026-09-14). Domain tests 131 → **139**.
  - `src/domain/lockLog.ts`: `lockEvent`, `appendLockEvent` (capped at 5,000) and
    `segmentLockLog`. The last splits a run at Unknown locks, counts re-locks, merges chip pairs
    whichever product ranked first, and ignores lost-quorum events.
  - `useScanner` appends an event on every lock change, which already happens only on key changes
    and so adds no per-frame cost. `reset()` never clears the log.
  - The gate check section shows one line per segment, with a translated "Clear lock log" button.
  - `PHASE_1_PLAN.md` §4 amended: the lock log is step 5's evidence, and screenshots are backup.
- **P1-8 — gate run 2** (2026-09-14, Infinix X6823, release APK, CPU). **FAILED step 5.**
  - **Conditions:** force-stop confirmed (new process), airplane mode on, 20 products / 100 shots.
  - **Lock log** 11:42:38–11:49:12: 98 changes, 20 LOCK, 26 CHIPS, 25 segments.
  - **Wrong lock (fails §4):** at 11:43:56, with a motion-blurred **Alaska Evaporada 360ml** in the
    reticle (backup screenshot 012), the app locked **Argentina Corned Beef 260g** and showed
    ₱35.00; the true price is ₱50.00. The next screenshots show Alaska chips, then LOCK Alaska 360ml.
  - **Every other outcome was correct:** all 20 products were locked (14, including Piattos, missed in
    run 1) or offered as chips containing the right product (6). Chips mixed in other products at
    times: Soy Sauce/Vinegar, Clover with Knorr, Lucky Me Beef with Pancit Canton Chilimansi,
    Reno with Alaska 140ml.
  - **Suspected cause: motion blur, not measured.** `TR-27`'s sharpness gate is deferred (floor 0),
    and the log records no scores.
  - **Steps 3–4 PASS in the same process** (pid 19300, airplane mode, after the scan): 0 missing
    photos, self-match 100/100, own score min 1.000000, nearest other shot max 0.8954, 13.3 s.
    Run 2 is therefore: step 3 pass, step 4 pass, **step 5 fail**.
- **Wrong-lock diagnostics** (2026-09-14, after gate run 2; operator's call: diagnose before fixing).
  Domain tests 139 → **145**. Nothing here changes a decision yet.
  - `src/domain/sharpness.ts`: `laplacianVariance`, the variance of the Laplacian of luminance over
    the 224² model input. It is worklet-callable and sampled every 2 px. It **measures only**:
    `TR-27`'s floor is still uncalibrated, so no frame is dropped.
  - **Sharpness is computed per frame** in `embedCrop`, as `sharpnessMs`, a separate stage between
    crop+resize and `runSync`. Its worklet cost is **not yet measured**.
  - **Lock events** now carry the locked decision's score and margin, plus the 5 stability-window
    frames that voted (`FrameVote`: top-1, score, margin, sharpness).
  - **Gate check section:** a sharpness distribution over the last 300 frames, and "lock detail"
    lines for the last 30 lock changes.
  - **Reproduction measured** (Infinix X6823, release APK, CPU, airplane mode, 12:03:46–12:07:04).
    The operator held Alaska Evaporada 360ml steady then moving, then Argentina Corned Beef 260g the
    same way.
    - **No wrong lock reproduced:** 43 lock changes, 7 LOCK (all Alaska 360ml, during its own
      phase), 22 CHIPS.
    - **The confusion runs both ways.** In the Argentina 260g phase, Alaska 360ml repeatedly
      ranked top-1 (scores 0.63–0.76), including accept-grade votes above δ: margin 0.09 at
      12:06:11 and 0.12 at 12:06:27. At most one wrong accept vote per stability window was seen;
      the gate failure needed three.
    - **Chips in that phase:** some pairs left Argentina 260g out (Alaska 360 | Argentina 100g ×3,
      Alaska 360 | 140 ×1).
    - **Sharpness does not separate right from wrong** (×1000). Wrong-can votes ranged 1.7–12.6,
      and the two wrong accept votes were 2.4 and 5.9. All frames (n = 300): p10 0.3, median 8.6,
      p90 20.9.
    - **Cost of measuring sharpness:** **20.9 / 21.3 ms** median/p90 per frame (n = 40), taking the
      worklet total to 144.1 / 148.2 ms.
    - **Limits:** there were no screenshots during the reproduction, so votes are attributed to a
      can by protocol timing only. One pair, about 2 minutes.
- **Lock quorum 3 → 4 of 5** (2026-09-14, ADR-016, `TR-36` amended; operator's call after the
  diagnosis).
  - `STABILITY_QUORUM` is now 4. `stability.test.ts` pins it, including that the 3-of-5 pattern
    behind gate run 2 no longer locks.
  - **Unchanged:** τ and δ.
  - **Nominal time-to-lock:** about 1 s at 4 fps, up from ~750 ms. Not yet measured.
  - **Sharpness measurement removed from the worklet** (it cost 20.9 ms per frame and did not
    separate wrong votes). `laplacianVariance` stays in `src/domain` with its tests, and lock detail
    lines keep score, margin and votes.
  - **Verification:** credited only if gate run 3 passes, in a full re-run.
- **P1-8 — gate run 3** (2026-09-14, Infinix X6823, release APK, CPU, 4-of-5 quorum). **Meets
  `PHASE_1_PLAN.md` §4**, verified with `/phase-gate` after the operator's `fil.json` pass (D-4).
  - **Conditions:** force-stop confirmed (new process, pid 27320), airplane mode on.
  - **Steps 3–4 PASS**, run before the scan this time, as §4 orders:
    - 20 products / 100 shots, index 100, other-model 0; schema 1, 1280-d, τ 0.46, δ 0.075.
    - 100 photo rows, 0 missing.
    - Self-match 100/100, own score min 1.000000; nearest other shot median 0.7512, max 0.8954.
    - 13.3 s.
  - **Step 5 PASS** (same process pid 27320 throughout; lock log 12:20:48–12:27:16):
    - **20/20 products** locked correctly or offered as chips containing the product: 15 LOCK,
      5 chips only (Alaska 360ml, Datu Puti Soy Sauce, Knorr Chicken, Knorr Pork, Pancit Canton
      Chilimansi).
    - **0 wrong locks** in 145 lock changes (24 LOCK, 26 CHIPS, 21 segments). Every LOCK names the
      product scanned in its segment.
    - **Attribution checked against 63 backup screenshots** where it mattered:
      - Segment #8 was a second Clover lock, with the Clover bag in view (shot 024).
      - Segment #3's LOCK Argentina 100g had the squat 100 g can in the reticle (shot 012).
      - The "260", "SPICY LABUYO", "CHILIMANSI" and "KALAMANSI" labels are readable during their
        segments.
      - Alaska 140/360 ml was attributed by list order plus the operator's chip taps.
  - **Caveats:**
    - **Not proof of ADR-016.** One clean run is consistent with it, but run 2's wrong lock was
      rare: it did not reproduce in 2 minutes, and run 1 observed none.
    - **Chip taps:** chips were tapped ~10 times. A tap only shows a price and never creates a
      lock.
    - **Time-to-lock under 4-of-5** (`NFR-04`) is unmeasured.
  - **Latency in this run** (n = 40 worklet / 200 JS): crop+resize 60.0, `runSync` 64.4, total
    125.8 ms; KNN 8.45 / 11.37 ms; policy + stability 0.09 / 0.10 ms.
- **Filipino copy reviewed** by the operator (2026-09-14, D-4): no corrections, so `fil.json` stands
  as drafted (`SR-42`).
- `scripts/small-catalog.mjs` — simulates small catalogs on the Phase 0 dataset (2026-09-14). It
  enrolls a random N of the 25 products and scores everything else as un-enrolled, 500 catalogs
  per size, per frame, at τ 0.46 / δ 0.075. Deterministic.
  - Un-enrolled frames auto-accepted: 7.9% at 1, **15.1% at 5**, 9.7% at 15, 2.9% at 25
    (`NFR-02` ≤ 2%). The 25-product row matches the golden replay's 3/105.
  - At 5 products, 8.9% of false accepts are same-brand siblings.
  - Also measures three candidate fixes: a lone-candidate floor, τ scaled to catalog size, and a
    distractor bank. Results in ADR-013.
- `docs/PHASE_2_PLAN.md` — Phase 2 (UI / UX) plan, approved 2026-09-14. **Nothing is built yet.**
  - **Contents:** readiness, steps P2-1 to P2-9, deferrals, risks, and the measurements Phase 2
    must record.
  - **Gate:** two runs on the Infinix in airplane mode.
    - *Upgrade* on the 20-product catalog: migration 1 → 2, edit / correct / delete from the scan
      card, time-to-lock over 60 episodes.
    - *Fresh install* on 5 products: first run, confirm mode, *Not in my list*, quick pick.
    - Pass on **zero confident wrong prices**. `NFR-04` is recorded but does not block.
  - **Decisions settled with the operator, all as recommended:**
    - **D-1:** until Phase 3 writes `confirm_below`, every ACCEPT is a question (`SR-13`, `TR-38`,
      ADR-017).
    - **D-2:** ambiguous products keep their shots, and a frame that resolves to one opens the
      quick-pick grid instead of naming it (`SR-10`, ADR-018).
    - **D-3:** a correction saves up to 3 extra shots per product, oldest replaced first (`TR-42`,
      ADR-019).
    - **D-4:** correcting takes two taps, *Wrong?* then the right product (`SR-07`, ADR-019).
  - **Engineering choices adopted:**
    - Negatives in their own `negative_shots` table with no name column (`TR-39`, ADR-017).
    - Negatives and ambiguity resolved per frame, with `match.ts` unchanged.
    - Delete and restore rebuild the index from SQLite.
    - Reanimated and zustand deferred again (`TR-15`, `TR-18`, ADR-020).
- ADR-017 to ADR-020 in `docs/DECISIONS.md`.
- **P2-1: the Phase 2 domain layer** (2026-09-14, branch `feat/phase-2-ui`). Pure and unit-tested.
  Tests went from 147 to **210**, typecheck is clean, and the Phase 0 golden replay is unchanged
  because `match.ts` is untouched (E-5). **Nothing is wired into the app yet, and nothing has run on a
  device.**
  - `scanDisplay.ts` (`SR-10`, `SR-13`, `TR-38`, `TR-39`, ADR-017, ADR-018):
    - `resolveFrame` runs per frame, before stability. A negative at top-1 or in a chip pair becomes
      UNKNOWN, carrying no negative id. An ambiguous product becomes `quickPick`. A negative outranks
      ambiguity.
    - `displayFor` runs after the lock. With no `confirm_below` row, every ACCEPT is `confirm`. A bad
      product count throws instead of quoting.
  - `stability.ts` votes on resolved frames, and grid votes agree whichever bag ranked first.
    `lockLog.ts` records grid locks, and the gate readout labels them GRID.
  - `knn.ts` (`TR-30`, `TR-39`, ADR-019):
    - A negative flag per row, and `negativeIds` on the index. The index refuses an id shared by a
      product and a negative, and a second row for one negative.
    - A new test shows top-1 and top-2 from the 10 nearest shots equal the full ranking at 9 shots
      per product with 0, 5 or 200 negatives. A second test shows a 10th shot breaks it.
  - `correction.ts` (`SR-07`, `SR-14`, `TR-42`): `correctionsToReplace` drops the oldest correction
    once a product holds 3, and never an enrollment or teach shot. `captureStillMatches` is the
    capture guard.
  - `priceEdit.ts` (`SR-06`, `TR-41`): `parsePrices` is now shared with enrollment, which behaves
    the same. `planPriceEdit` writes nothing for an edit that lands on the stored prices.
  - `trash.ts` (`SR-32`): a 10 s undo and a 30-day purge. A clock set backwards never purges.
    **Known limit:** a clock set forwards purges early, and offline there is no trusted time to
    check against.
  - `firstRun.ts` (`SR-44`): welcome, the *n of 5* banner, or complete, from the product count and
    a saved `first_run_dismissed`.
  - `timeToLock.ts` (`NFR-04`):
    - Builds lock episodes from the frame log and the lock log. Grid locks count as results.
    - Episodes whose t_seen is lost, or whose clocks disagree, are counted and left out, never
      guessed.
    - Reports the nearest-rank median and p90, plus a p90 adjusted by the calibration bias.
  - `appMeta.ts`: `confirm_below` tests. No row means confirm everything, and a malformed row is
    refused. A written `0` is accepted as a deliberate value.
- **P2-2: schema v2 and its repositories** (2026-09-14). Tests went from 210 to **231** and
  typecheck is clean. **Device checkpoint PASS on the real 20-product catalog.**
  - **Migration 2** (`TR-44`, `TR-39`, ADR-017, ADR-019):
    - Adds `negative_shots` (no name or price column) and `product_shots.source`, which defaults to
      `'enroll'`. The CHECK lists are literals.
    - No `confirm_below` row.
  - **Repositories**, each multi-statement write in one transaction:
    - `updatePrice` (`SR-06`): a `price_history` row holds the prices in force **before** the change.
    - `softDeleteProduct`, `restoreProduct`, `listTrash`, `purgeProducts` (`SR-08`, `SR-32`).
    - `setAmbiguous` (`SR-10`).
    - `insertCorrectionShot` (`SR-07`, D-3): the replaced correction is removed in the same
      transaction.
    - `insertNegativeShot`, `listNegatives`, `deleteNegative` (`SR-14`).
    - `listPriceHistory`.
    - Shot validation is shared by both vector tables (`assertNewShot`).
  - **The three readers of `negative_shots` (E-1), each tested:**
    - `loadVectorIndex` flags negatives;
    - `referencedPhotoPaths` includes them, so the orphan sweep keeps their JPEGs;
    - the gate check counts negatives, corrections and trashed shots, and self-matches negatives.
  - **Tests against real SQLite:**
    - `node:sqlite` is built into Node, so there is no new dependency (`TR-51`).
    - `src/db/nodeSqlite.testing.ts` adapts it to `executeSync`. `npm test` now also runs
      `src/db/**/*.test.ts`, and `src/db` files use `.ts` import extensions.
    - The migration test shows a Phase 1 catalog upgrades with every row and BLOB byte intact, and
      that a failed migration leaves version 1.
  - **Gate panel:** a launch line (schema from → to, orphan sweep, index and its negatives), because
    release builds do not log to logcat.
  - **Backup before the migration** (operator's call; amends `PHASE_2_PLAN.md` §2):
    - **How:** the Phase 0 debug APK was installed over the release app without launching it.
      `bantay.db` and `photos/` were copied off with `run-as`.
    - **Where:** `C:\BantayNiMamaBackups\gate-catalog-v1`.
    - **Checks:** 101/101 SHA-256 hashes match the phone. The copy passes `integrity_check`, at
      schema 1, with 20 products, 100 shots and 100 photos.
    - Google Play Protect showed a dialog on both installs, and each needed a tap on the phone.
  - **Rehearsal on a copy of that backup,** through the app's own code under `node:sqlite` on the
    laptop:
    - migration 1 → 2 in 3.4 ms, laptop time, not a device figure;
    - rows byte-identical;
    - index 100, sweep would delete 0, 0 gate problems.
  - **Device checkpoint** (Infinix X6823, release APK, 14:15, gate A1 taken early):
    - **Launch:** `schema 1 → 2 · orphan photos removed 0 · index 100 (negatives 0) · other-model 0`.
    - **Gate check PASS:** products 20, shots 100, corrections 0, negatives 0, index 100,
      other-model 0, trashed 0; schema 2, 1280-d, τ 0.46, δ 0.075.
    - **Photos:** 100 rows, 0 missing.
    - **Self-match:** 100/100, own score min 1.000000.
    - **Nearest other shot:** median 0.7512, p90 0.8254, max 0.8954, identical to Phase 1 run 3.
    - **Time:** 13.6 s.
    - Not in airplane mode; the checkpoint makes no network claim.
- **P2-3: the scan card — confirm mode, *Not in my list*, torch** (2026-09-14; `SR-11`, `SR-13`,
  `SR-14`, `TR-38`, `TR-39`). Tests went from 231 to **245** and typecheck is clean. **Verified on the
  Infinix X6823 (release APK) on the 20-product gate catalog.** That amends P2-3's done-when, by the
  operator's call: confirm mode ignores catalog size until Phase 3 (D-1).
  - **Built:**
    - **Scanning:** `useScanner` runs `resolveFrame` before the vote. `classify` puts the capture
      guard's frame through the same path without voting.
    - **Card states:** `confirm` (first enrollment photo, *"Is this {name}? ₱price"*, confidence bars,
      Yes / No), `quote` with *Wrong?*, `chips` with *Neither*, an interim `quickPick` until P2-5, and
      Unknown.
    - **Rejecting:** `domain/rejection.ts` (a reducer) and `useRejection` pin what the card showed and
      pause voting. *Not in my list* saves the next frame only if it still resolves to the rejected
      lock. The write order is JPEG → INSERT → index append.
    - **Torch:** a toggle, shown only when `device.hasTorch`, and off on blur.
    - **Interaction log:** `domain/interactionLog.ts`, shown in the gate panel and never persisted.
    - **Repositories:** `ambiguousProductIds`, `firstEnrollPhotoPath`.
    - Filipino copy is Claude's draft, for the operator's review before `/phase-gate`.
  - **On device (14:39–15:12, not in airplane mode):**
    - **Question card:** 3 Yes taps (Clover Chips, Lucky Me Beef, Piattos), each on a LOCK in the lock
      log.
    - **Torch:** it lit, and the button changed state.
    - **2 negatives saved through the flow:**
      - one before an app swipe-away (`am_kill … remove task` at 14:54:16), whose taps went with that
        process;
      - one logged in full: *Neither* on Pancit Canton Chilimansi | Kalamansi chips → start → saved,
        all at 14:55:08.
      - The operator did not name the marked items.
    - **A negative silences after a relaunch:** the next process launched with `index 101
      (negatives 1)`. Frames voting chips with that negative locked **UNKNOWN** 3 times
      (14:54:22–14:54:43), with no name or score carried.
    - **Force-stop relaunch:** `index 102 (negatives 2)`. **Gate check PASS:** 20 products, 100 shots,
      2 negatives, photo rows 102, 0 missing, self-match **102/102**, own min 1.000000, 13.6 s.
    - **Neighbours still lock with both negatives loaded:** Kalamansi LOCK ×4 (0.740–0.812),
      Chilimansi LOCK (0.818), Lucky Me Beef LOCK ×3 (0.700–0.840). No vote for them hit a negative.
  - **Not verified on device:** the capture guard's refusal. No mismatch was logged; it is proven
    only by unit tests.
  - **Incidental:** in one 40-frame reading at 14:47, crop+resize was **35.8 ms median**, the
    P1-3 level. Other readings that session were 43–60 ms. It adds to the unconfirmed heat
    explanation (`NFR-07`).
- ADR-021 in `docs/DECISIONS.md`: a `price_history` row holds the prices it replaced (`SR-06`,
  `SR-31`). This records the P2-2 choice so a later edit does not silently flip its meaning.
- `ARCHITECTURE.md` §8 gains the P2-3 device readings (Infinix X6823, release APK, CPU):
  - **KNN at 102 rows:** median 8.94 ms, p90 12.30 (n = 60).
  - **Policy + stability, now including `resolveFrame`:** 0.09 / 0.12 ms (n = 60).
  - **Crop + resize, four readings in one session** (n = 40 each): 35.8 up to 59.7 ms median.
- **P2-4: edit, correct and delete from the scan card, with undo** (2026-09-14; `SR-06`, `SR-07`,
  `SR-08`, `SR-32`, `TR-41`, `TR-42`, D-3, E-4, ADR-022). Tests went from 245 to **264**, and typecheck is
  clean. **Gate A2–A4 passed on the Infinix X6823** (release APK, 20-product catalog, not in airplane mode), which is P2-4's done-when.
  - **Domain (pure, tested):**
    - `rejection.ts`: the sheet now chooses what the capture frame is saved as, a negative or a
      correction shot on a picked product. *Try again* keeps that choice, so a retried correction can
      never become a negative. A correction to a product the card itself showed is refused.
    - `correction.ts` `likelyProducts`: the latest top 3 at tap time, without negatives or the
      rejected products.
    - `productSearch.ts`: every word in any order, ignoring case and accents. P2-7's `SR-30` reuses it.
    - `priceEdit.ts` `priceFormOf`: stored centavos → editor text. Saving it untouched is `unchanged`.
    - `interactionLog.ts`: correction, price edit, delete, undo, undo lapsed, restore.
  - **Scan tab:**
    - **Price editor (`SR-06`):** the price on a settled card opens it: a quote, the card after *Yes*,
      or after a chip or tile tap. It is bound to that product id, and voting pauses. The question
      card's price is not tappable. Saving is `updatePrice`, one transaction.
    - ***Wrong?* sheet (`SR-07`):** likely products, a name search, and *Not in my list*. A pick runs
      the capture guard and saves a correction shot. A replaced correction's JPEG is deleted after
      COMMIT, and the index is rebuilt in that case, appended to otherwise. The saved state shows the
      picked product's price. The sheet moved from an overlay into the panel under the camera, so the
      search field stays above the keyboard.
    - **Delete (`SR-08`, `SR-32`):** on the price editor. Soft delete → index rebuilt from SQLite (E-4)
      → a 10 s *Undo* bar. If a rebuild fails, the bar says to restart. The card still cannot price a
      trashed product, because it reads products through `getProduct`.
    - Every catalog write empties `useScanner`'s product and photo caches and resets the stability
      window.
  - **Products tab:** deleted products with *Restore*, pulled forward from P2-7 so gate A4 can run.
  - **Gate panel:** index rebuild timings (§9); `price_history` rows with the newest changes (A2's
    evidence, since release builds do not log); logs name trashed products
    (`productNameIncludingTrash`).
  - **Shared services:** `rebuildIndex(reason)`, timed, and `logInteraction` now live in `Root`.
  - Filipino copy is Claude's draft, for the operator's review before `/phase-gate`.
  - **On device (Infinix X6823, release APK built 19:29 in 1m 53s, `adb install -r` over the
    20-product catalog; not in airplane mode):**
    - **Gate A2 passed.** Clover Chips 24g was repriced from the scan card twice (19:36:13, 19:42:16).
      The second edit was the binding check: opened on Clover at 19:41:44, phone moved to another
      product before Save (operator-reported; voting pauses while the editor is open, so the phone
      records nothing about where it pointed). It landed on Clover, and no other product gained a
      `price_history` row.
    - **After `am force-stop`** (new pid 16551; launch `schema 2 -> 2`, orphan photos 0, index 102,
      negatives 2): Clover showed the new price on Yes (operator-reported), and the gate panel still
      read `price_history rows 2` — was ₱12.00, was ₱20.00.
    - **Gate A3, first attempt (~19:50, same process): not passable as built.** The Knorr Broth Cube
      Pork | Chicken pair only ever showed chips. *Neither* (19:50:44) opened the sheet, but it
      refused both chip products, so the sheet was closed and nothing was saved. The tap log had no
      `correctStart` or `correctSaved`; two chip taps showed prices only.
    - **Fix (ADR-022, operator's call):** the chip card's link is now *Wrong?*. Its sheet lists both
      chip products first, and picking one saves a correction shot through the same capture guard.
      A question or a quote still refuses the product it named. The log kind `neither` became
      `wrongChip`. Tests 263 → 264. Rebuilt (1m 14s) and installed over the catalog at 20:01.
    - **Gate A3 passed (20:07–20:13).**
      - *Wrong?* on CHIPS Knorr Broth Cube Chicken | Pork (20:07:09), then Chicken.
      - **The capture guard refused** at 20:07:27 (`correctMismatch`, nothing saved), its first
        refusal seen on device. The retry saved at 20:07:45 (`correctSaved`).
      - The same pair then **locked Chicken**, confirmed with Yes at 20:08:04. That is the intended
        effect, and the `L-02` risk ADR-022 records.
      - The Products tab read Chicken 6 photos, Pork 5.
      - **After `am force-stop`** (pid 21337; launch index 103, negatives 2): **gate check PASS** —
        products 20, shots 101 (corrections 1), negatives 2, photo rows 103, **missing 0**,
        self-match **103/103**, own min 1.000000, nearest other median 0.7512 / p90 0.8254 / max 0.8954
        (unchanged from Phase 1 run 3), 13.9 s.
    - **Gate A4, before force-stop (pid 21337, 20:16–20:17):**
      - **Sponge Scouring Pad** deleted from the price editor at 20:16:58; the operator let the undo
        lapse (20:17:08), so the lapse was exercised on the sponge. It is listed in *Deleted products (1)*.
      - **Kopiko** was used for Undo: LOCK at 20:17:35 → delete → **Undo** at 20:17:46 (logged only
        inside the 10 s window) → LOCK Kopiko at 20:17:47.
      - **Index rebuilds:** n = 3 (2 delete, 1 undo), median 9.2 ms, p90 17.0, max 17.0; rows
        103 → 98 → 93 → 98. The next 58 frames searched 98 shots (KNN 8.39 / 8.48 ms).
      - The sponge never locked while deleted.
      - **Possible wrong lock, unattributed:** at 20:17:04, 6 s after the sponge was deleted, the log
        shows **LOCK Knorr Broth Cube Pork** (score 0.536, margin 0.088, four accept votes at
        0.51–0.55), then CHIPS Knorr Pork | Clover until 20:17:17. The operator is not sure what was in
        the box. If it was the sponge, deleting a product made it an un-enrolled item that fell through
        to its nearest neighbour (`NFR-03`, ADR-013). Confirm mode showed a question, not a price.
    - **Gate A4, after `am force-stop`** (pid 23604 at 20:25:10):
      - The launch read `index 98 (negatives 2)`, so the deleted sponge stayed out of the index.
      - Restored from *Deleted products* at 20:29:03; the rebuild took **23.2 ms** to 103 rows.
      - **LOCK Sponge Scouring Pad** at 20:29:25, Yes at 20:29:27.
      - The lock log since the relaunch held 1 LOCK (the sponge, after restore) and 0 CHIPS. That does
        not settle the 20:17:04 lock: whether the sponge was held before the restore was not recorded.
      - **Gate A4 passed.**
- **P2-5: quick-pick grid — built 2026-09-14; gate B5 early run passed 2026-09-15** (`SR-10`, `SR-23`,
  `L-01`, `TR-45`, ADR-018). Tests went from 264 to **277**, and typecheck is clean.
  - **Domain (pure, tested):**
    - `quickPick.ts` `quickPickTiles`: every live repacked product, plus a non-repacked product that a
      grid lock involved. Each appears once, ordered by name ignoring case, then by id. The order never
      depends on which bag the frame ranked first.
    - `enrollment.ts` `repackedPlan`: the *repacked* toggle and the `SR-23` offer. Marking the
      look-alikes flags the new product too, because a pair is ambiguous both ways. With no duplicates
      left, the offer is ignored.
    - `interactionLog.ts`: `gridOpen`, `gridClose`, `tilePick`. The interim grid logged its taps as
      `chipPick`.
  - **Repositories:** `insertProductWithShots` writes `is_ambiguous` and flags live look-alikes in the
    same transaction, before the shot rows, so a failed shot INSERT rolls the flags back (tested).
    `listQuickPickProducts` returns live repacked products with their first enrollment photo.
  - **Enrollment panel:** a *Looks like other items (repacked)* toggle. When the duplicate warning
    shows, it also offers, off by default, to mark the named products as repacked. That locks the
    toggle on and skips the *Save anyway?* alert. The hint says it is not for two sizes of one product
    (`L-02`).
  - **Scan tab:**
    - **A grid lock shows tiles** with photo and name, in the fixed order, nothing highlighted and no
      price until a tap (operator's call; P2-5 said "photo, name and price"). A tap shows the price
      with Edit (`SR-06`).
    - **A pinned *Repacked* button**, under *Light*, shows whenever a live repacked product exists.
      It opens the same grid. Voting pauses while the grid is open, and *Close* resumes with a fresh
      stability window.
    - **The grid has no *Wrong?* and no *Not in my list*.** Nothing on it is named. A negative saved
      from a clear bag would also silence every look-alike bag, because a negative outranks ambiguity
      (E-5).
    - The undo bar moved down to make room for the button.
  - **Products tab:** repacked products read "· repacked".
  - Filipino copy is Claude's draft, for the operator's review before `/phase-gate`.
  - **Gate B5, early run, on the 20-product gate catalog** (2026-09-15, Infinix X6823, release APK
    built 09:58 from `b875d1f` and installed with `adb install -r`, operator's call per `PHASE_2_PLAN.md`
    P2-5):
    - **Setup:** 3 repacked clear bags enrolled with the toggle on: Sugar White 5g, Sugar Brown 10g
      and Sili 20p, 5 shots each.
    - **Scan (operator-reported):** for each bag, the grid opened and named nothing, a tile tap showed
      that product's price, and the pinned *Repacked* button opened the same grid. **Pass.**
    - **Cleanup:** all 3 bags deleted (10:43:18–10:43:40).
    - **Checked in the database afterwards:** `bantay.db` was copied with the debug APK and `run-as`
      (SHA-256 match), then the release APK was reinstalled.
      - The catalog still has 20 live products, and none of the 20 gate products is flagged repacked
        or deleted, so gate A5 scans the same 20.
      - No negatives and no price changes were written.
      - 118 photos on disk match 118 referenced rows, with 0 missing and 0 orphans. That is 100
        enrollment shots, 1 correction, 2 negatives and the bags' 15.
    - **Not recorded:** whether the look-alike offer appeared, and airplane mode.
- **Gate check after B5, in airplane mode** (2026-09-15, Infinix X6823, release APK, CPU): **PASS.**
  - **Conditions:** `am force-stop` at 10:54:19 moved the app from pid 24308 to 27266 on a cold start.
    `airplane_mode_on` was 1 and Wi-Fi was off. The check ran at 10:55:35 in the same process.
  - **Launch:** `schema 2 -> 2`, orphan sweep 0, index 103 (negatives 2), other-model 0. The Scan tab
    showed no *Repacked* button, since no live repacked product is left.
  - **Step 3:** 20 products and 116 shots (corrections 1), 2 negatives, index 103, other-model 0, and
    3 trashed products (15 shots). `app_meta` reads schema 2, `mobilenet_v3_large_embedder_v1`,
    1280-d, τ 0.46 and δ 0.075. There are 118 photo rows, and **0 are missing**.
  - **Step 4:** self-match **103/103**, and own score min 1.000000. Nearest other shot is median
    0.7512, p90 0.8254 and max 0.8954, identical to Phase 1 run 3. Checked in 14.3 s.
  - **So:** the trashed bags stay out of search and do not change the 20-product catalog's
    geometry. Claude drove the check by adb taps and read it from the screen layout, since the
    readout does not reach logcat in release.
- **Filipino copy for P2-3 to P2-5 reviewed by the operator** (2026-09-15, `SR-42`): **no corrections**,
  so `fil.json` stands as drafted. This covers the scan card and reject sheet, the price editor,
  *Wrong?* sheet, undo bar and trash, and the repacked toggle, look-alike offer and grid.
- **P2-6: first run, permission recovery, guided enrollment — done** (2026-09-15; `SR-44`, `SR-43`,
  `SR-20`, `SR-22`, `SR-25`, `SR-42`). Tests went from 277 to **311**, and typecheck is clean.
  - **Gate B1 passed** on attempt 2.
  - **Gate B2 passed on its other checks** on attempt 4.
  - **`SR-25`'s time per product is recorded, not blocking** (ADR-023, operator's call). The best
    run had a median of 27.5 s, with 3 of 5 products within 30 s.
  - **Domain (pure, tested):**
    - `firstRun.ts`: `nextShotAngle` gives one prompt per photo (front, turned left, turned right,
      back or top, other light), up to `MAX_SHOTS`. `afterGuidedSave` decides what follows a save: the
      first product offers *Try scanning it*, two to four ask for the next, five completes.
    - `cameraAccess.ts`: VisionCamera's status becomes *ask*, *ask again* or *open settings*. On
      Android, `denied` means "don't ask again", where asking shows nothing, so the only button there
      is *Open Settings*. `permissionChangeKind` logs a grant however it arrived.
    - `shotQuality.ts`: mean luminance, plus the existing `laplacianVariance`. At most one warning,
      exposure first. **The limits are placeholders** (luminance 0.12 / 0.88, sharpness 0.0005) and
      never block a save.
    - `interactionLog.ts`: kinds for each *Add* source, `enrollSaved`, `enrollClosed`, first run and
      the camera. `enrollmentTimes` pairs each *Add* with its save. A save with the panel still open
      starts the next timing, and closing the panel abandons one.
  - **First run:** on an empty, never-dismissed catalog, welcome → language → camera replaces the tabs.
    The camera step asks only on a tap, shows *Open Settings* when blocked, and moves on by itself
    when the grant arrives, including on return from system settings. *Finish later* writes
    `first_run_dismissed` to `app_meta`.
  - **Scan tab:**
    - **It no longer asks for the camera on mount.** The same camera panel is its recovery screen.
    - **An *n of 5* banner** opens the guided add until five products exist.
    - **Each way into enrollment is logged:** *+ Add product*, Unknown's *Add*, the banner, and the
      first-run handoff.
  - **Enrollment panel:**
    - **Photos now come before the form.** The camera is already on the item, and the `SR-23` warning
      shows before a name is typed.
    - The framing coach, a *Photo n* angle prompt, and a quality warning per photo with its thumbnail
      marked.
    - In the guided flow: *Item n of 5*, *Finish later*, and *Try scanning it* after the first save.
  - **Confirm card:** while fewer than five products exist, one line says why the app asks (`SR-44`
    step 7).
  - **Gate panel:** each shot's luminance and sharpness, for Phase 3's calibration. Enrollment times:
    n, median, p90, max, how many were over 30 s, and how many started from Unknown's *Add*.
  - **Side-by-side test install** (operator's call): `"-PbantayAppIdSuffix=.fresh"` builds
    `com.jash.bantaynimama.fresh`, labelled "BantayNiMama fresh", with its own data and camera
    permission. B1–B2 then never touch the gate catalog (`TOOLING.md`). Release APK built at 11:21 in
    3 min.
  - **Copy:** `camera.permissionNeeded` and `enroll.captureHint` are replaced by `camera.why`, the
    coach and the angle prompts. The Filipino copy is Claude's draft, for the operator's review before
    `/phase-gate`.
  - **Device attempt 1 (2026-09-15, 11:22–11:36, Infinix X6823, fresh copy): not recordable.**
    - **B1:** the system log shows one OS camera prompt, allowed in 3.4 s. No denial, so the recovery
      screen was not exercised.
    - **B2:** 5 products were saved in 6 min 51 s. The app was then swiped from Recents, which cleared
      the in-memory interaction log, so per-product times are gone.
  - **Fixed from attempt 1** (operator's call): Android's memory manager killed the app 4 s after
    system Permissions opened (`rampolicy`, 293 MB free). The relaunch replayed the welcome, breaking
    `SR-43`'s return to the flow. The intro now writes `first_run_intro` = `camera` to `app_meta` on
    reaching that step, `introStartStep` resumes there, and the step moves on by itself once the camera
    is granted. Logged as `introResumedAtCamera`.
  - **Device attempt 2 (2026-09-15, 11:45–11:53, Infinix X6823, fresh copy cleared with `pm clear`,
    one process throughout, airplane mode on): B1 PASS, B2 FAIL on `SR-25`.**
    - **B1:** two OS prompts, both denied, then blocked. The app's *Open Settings* opened App info
      (`APPLICATION_DETAILS_SETTINGS`, 11:46:28). Camera granted 11:46:54, and the guided add opened in
      the same second. The system log and the interaction log agree.
    - **B2:** 6 products, 5 photos each, one started from an Unknown card's *Add*. **Add → saved: median
      42.6 s, max 55.7 s, 0 of 6 within 30 s.**
    - **Photos:** 31 shots, luminance 0.204–0.590, sharpness ×1000 min 1.24. **No quality warning
      fired**, so the placeholder limits were never crossed.
    - **Scan afterwards:** all 6 products locked and were confirmed with *Yes*.
  - **Changed after attempt 2** (operator's call, `SR-25`, `SR-21`):
    - **The guided form shows only name and price per piece.** Pack price, unit and category sit behind
      *More details*, which a bad pack price opens. The *repacked* toggle stays visible (ADR-018).
      Outside the guided flow the form is unchanged.
    - **Step timings:** `enrollPhoto` and `enrollTyping` join the interaction log. `enrollmentTimes`
      reports each product's photo count, first and last photo, and first keystroke. The gate panel
      shows medians for *Add* → first photo, first → last photo, last photo → saved, and first key →
      saved.
  - **Device attempt 3, B2 only (2026-09-15, 12:03–12:10, Infinix X6823, cleared fresh copy, trimmed
    form, one process, airplane mode on): FAIL on `SR-25` again.**
    - **Times:** 6 products; median 40.8 s, max 64.6 s, min 31.9 s (the product from an Unknown card's
      *Add*). 0 of 6 within 30 s.
    - **Split medians:** *Add* → first photo 19.6 s, photos 12.0 s, last photo → saved 6.1 s.
    - **Typing was the largest block:** it came first on 4 of 6 products, and the first photo followed
      13–31 s later.
    - **Photos:** 5 per product (31 in all) rather than 3. No quality warning fired.
  - **Device attempt 4, B2 only (2026-09-15, 12:17–12:21, Infinix X6823, cleared fresh copy, same
    build, one process, airplane mode on): 3 of 5 within 30 s. FAIL as worded.**
    - **Times:** median 27.5 s, max 41.8 s. The two over 30 s were 31.6 s (from an Unknown card's
      *Add*, typing first) and 41.8 s (17.3 s before the first photo).
    - **Split medians:** 3 photos in 4.1 s, and last photo → saved in 5.0 s.
    - **First seen on device:** *Try scanning it* and *No* → *Not in my list*.
    - **Scan afterwards:** all 5 products locked and were confirmed with *Yes*.
- **P2-7: the Products tab becomes the Directory — done** (2026-09-15; `SR-30`–`SR-35`, `SR-14`,
  ADR-024). Tests went from 311 to **350**, and typecheck is clean. Every requirement was exercised on
  the Infinix side-by-side copy and survived force-stops. The exception is the 30-day purge, which
  cannot come due on a normal clock and is unit-tested only.
  - **Domain (pure, tested):**
    - `directory.ts`: name filter (every word, any order, case and accents ignored), three sorts that
      always end on name then id, `scannedProductIds` (only an ACCEPT names a product), photo storage
      and `formatBytes`.
    - `productEdit.ts`: `planProductEdit` parses like enrollment. An edit that changes nothing writes
      nothing, and a rename writes no price history.
    - `correction.ts`: `extraShotsToReplace`. Corrections and taught photos share the 3 extra slots,
      the oldest of either replaced first (ADR-024).
    - `trash.ts`: `trashDaysLeft`.
  - **Repositories (tested under `node:sqlite`):**
    - `listDirectory`, `updateProduct` (all fields in one transaction, prices through `price_history`),
      `markScanned`, `shotCounts`.
    - `purgeExpiredTrash`: rows first, then photos; a photo that fails to delete is left for the
      sweep.
    - `insertExtraShot`, with `insertTeachShot` and `insertCorrectionShot` as thin wrappers.
  - **Launch:** `openCatalog` purges trash older than 30 days before the orphan sweep. The gate
    panel's launch line reads `trash purged n`.
  - **Directory (Products tab):**
    - Search, sort by name / newest / last scanned, a thumbnail per row, and the photo count and size
      (`SR-35`).
    - Tapping a row opens a full-screen editor for every field and the *repacked* flag, with *Teach
      again* and delete.
    - The trash shows thumbnails and the days left.
    - *Not in my list* items show their photos and can be deleted; the index is rebuilt after.
  - ***Teach again* (`SR-33`):**
    - The Directory hands the product to the Scan tab, which opens a teach panel under the camera.
    - Each photo is shown first and saved only on *Save this photo*, or retaken.
    - The panel shows the photo count against the 3 shared extra slots.
  - **Scan tab:** `last_scanned_at` is stamped once per lock change that names a product and once per
    chip or tile tap, never per frame (`SR-34`).
  - **Copy:** Directory, trash, *Not in my list* and *Teach again* strings in `en` and `fil`. The
    Filipino is Claude's draft, for the operator's review before `/phase-gate`.
  - **Device run 1** (2026-09-15, 12:51–12:57, Infinix X6823, side-by-side copy, airplane mode on):
    - **Exercised:** *Teach again* (2 retakes, 1 saved, 3 → 4 photos); a *Not in my list* delete
      (index rebuild 2.6 ms); a delete from the Directory (1.5 ms), shown with 30 days left; storage
      384 → 376 KB.
    - **Survived a force-stop**, and the launch removed 0 orphan photos, so retaken photos were
      cleaned up.
    - **Not yet exercised:** edit, restore, sort by last scanned, search.
  - **Device run 2** (2026-09-15, 12:57–13:32, same copy, one process until a force-stop, airplane
    mode on):
    - **Exercised:** an edit renamed a product and raised its price ₱100.00 → ₱110.00, with one
      `price_history` row (was ₱100.00); a restore from the trash (index rebuild 4.8 ms, 16 rows);
      search ("clover", 1 of 5); two scans confirmed with *Yes*, then *Last scanned* ordered those two
      first and the unscanned three by name.
    - **Survived a force-stop:** the rename, the price, the restore, the scan order and the history
      row. Launch line `index 16 (negatives 0) · orphan photos removed 0`.
- **P2-8: time-to-lock proxy — built and calibrated on device** (2026-09-15; `NFR-04`, `TR-25`).
  Tests went from 350 to **360**, and typecheck is clean.
  - **Worklet:** `embedFrame` and `captureReference` stamp each frame with `Date.now()` when processing
    begins. No other per-frame work (`NFR-07`).
  - **Domain (pure, tested), `timeToLock.ts`:**
    - Frame log entries hold the resolved kind, the capture and arrival times, and the worklet time.
      `appendFrameLog` trims in chunks and keeps about 6,000 frames.
    - `lockEpisodes` joins frames to an episode by arrival and takes t_seen from the capture time.
      An episode with a reset inside counts as `interrupted`; t_seen after t_lock counts as
      `inconsistent`.
    - `clockCheck`: arrival − capture − worklet time per frame, with a count of impossible (negative)
      frames.
    - `confirmDelays`: ACCEPT lock → *Yes*, informational.
  - **Scanner:** `useScanner` appends every stamped frame and every reset to the frame log.
  - **Gate panel:**
    - Proxy n / median / p90 / max, the episodes left out, the clock check, and lock → *Yes*.
    - Each episode's seen and lock times to the millisecond, to match against
      `screenrecord --bugreport`'s clock overlay.
    - *Clear lock log* now clears the frame log too, relabelled in `en` and `fil`.
  - **Device:** release APK installed over the gate app at 13:51:32 (data kept).
  - **Calibration on the Infinix** (21:02–21:16, one process pid 4396, airplane mode on, 28.1–33.7 °C):
    - **Protocol:** recording 1 (10 gate products) · 20 plain episodes (all 20) · recording 2 (the
      other 10), with `screenrecord --bugreport`. Calibration episodes do not count toward gate A5
      (operator's call).
    - **Proxy (gate panel):** n = 41, median 1152 ms, p90 2007, max 3010; 0 left out; clock check 0
      impossible of 2,809 frames.
    - **t_enter read by eye** from frame sheets (every 2nd frame, median 101 ms apart), after a
      frame-difference rule failed on the handheld reticle.
    - **Bias** t_seen − t_enter, n = 19: median 496 ms, p90 849. **True time-to-lock**, n = 19:
      median **1690 ms**, p90 **2879 ms**, max 3288. **`NFR-04` (p90 ≤ 1.2 s) not met**: recorded, not
      blocking (E-2), and the quorum is unchanged (ADR-016).
    - **Recording did not slow scanning:** proxy p90 1661 ms recorded vs 2007 ms plain.
    - **Left out:** #34, which opened with the product already in view (9.8 s from entry to chips).
    - **Plain block, no video:** #20 LOCKed Argentina Corned Beef 100g, and the operator is not sure
      what was held. A possible wrong lock, unattributed, never confirmed with *Yes*. Reno Liver Spread
      and the Sponge were scanned but formed no episode.
    - **Against the protocol:** chip and *Yes* taps on many episodes (lock → *Yes* n = 12), all after
      the lock; 0 episodes interrupted.
    - **Evidence:** `C:\BantayNiMamaBackups\p2-8-calibration`, 71 files, SHA-256 checked against source.
  - **Laptop tooling:** ffmpeg 9.0.1 (`winget`, Gyan.FFmpeg) to read calibration video frames. It never
    ships in the APK (`TR-51` unaffected).
  - **Copy review:** the operator reviewed P2-6's and P2-7's Filipino copy and the relabelled clear
    button, with no corrections. All Phase 2 Filipino copy is now reviewed.
- **Gate A5 passed; P2-9 part A complete** (2026-09-15; `NFR-04`, `SR-40`, `TR-53`). Infinix X6823,
  release APK, gate app, one process, airplane mode on.
  - **Run:** 3 passes of all 20 gate products from an empty table, 22:40–22:53, screen-recorded in 5
    back-to-back segments (operator's call).
  - **62 episodes:** 60 presentations, plus a repeated Reno (#55) and a Spicy Labuyo re-lock (#100).
  - **0 wrong locks**, with every LOCK checked against video at its lock moment. The two brief
    Alaska 140ml locks in #83 were found by a frame-by-frame scan for the confirm card's *Yes* button,
    and the can held was the 140ml.
  - **Finding:** with Reno held, #54 and #77 passed through chips Alaska 140ml | Argentina 100g, a pair
    without the held product. Not a lock or a price. Carried to Phase 3 with the look-alike confusion.
  - **Time-to-lock proxy:** n = 62, median 951 ms, p90 2153. With P2-8's bias, an estimate: p90 ≈ 2649 ms.
  - **Gate check after A5: PASS.** 20 products, 116 shots, 2 negatives, photo rows 118, 0 missing,
    self-match 103/103. So the 3 orphan photos swept at the 21:02 launch were unreferenced.
  - **Evidence:** `C:\BantayNiMamaBackups\p2-9-gate-a5`, SHA-256 checked against source.
  - **Decided (operator's calls):** B1–B2 are re-run in part B on the cleared gate app; A5 is
    screen-recorded; the gate catalog is backed up before part B clears it; the P2-8 calibration
    videos and the A5 segments were deleted from the phone after archiving.

### Changed
- **Phase 1 gate PASSED, verified with `/phase-gate`** (2026-09-14). Phase 1 is closed; Phase 2
  (UI / UX) is in progress.
  - **Every §4 criterion has measured evidence** on the Infinix X6823, release APK, in airplane mode:
    - Setup: 20 products / 100 shots, with 4 same-brand variant pairs.
    - Force-stop confirmed by a new process, the same process throughout.
    - Step 3: products 20, shots 100, index 100, other-model 0; `app_meta` schema 1, 1280-d,
      τ 0.46, δ 0.075; 0 missing photos.
    - Step 4: self-match 100/100, own score min 1.000000.
    - Step 5: 20/20 locked or chipped, **0 wrong locks** in the full lock log (145 changes).
  - **The pass came on gate run 3.** Run 2 failed step 5 on one wrong lock, which led to the
    diagnosis and ADR-016's 4-of-5 quorum.
  - **Carried open, outside this gate:**
    - `NFR-07`, per-frame ~126 ms against 60 ms.
    - `NFR-01` and `NFR-03`, for Phase 3.
    - `NFR-04`, time-to-lock under 4-of-5, unmeasured.
    - GPU-vs-CPU vector agreement.
    - The Add → enroll tap, never exercised.
    - Look-alike confusion: Alaska / Argentina, Reno / Argentina.
  - **P1-4's owed item** (does JPEG-path enrollment change real decisions?) is marked addressed by
    the gate. It was not a controlled comparison.
- **Docs brought up to date with P1-2 to P1-4** (2026-09-14). No code or threshold changed.
  - **`TR-42` clarified:** 512 px is a cap and never upscales. The 396 px reticle crop is stored
    at 396 px (P1-4, `NFR-08`).
  - **`PHASE_1_PLAN.md`:**
    - The gate's persistence check (§4 step 3) counts `products` and `product_shots`. The
      `vec_shots` table left the schema in ADR-014; the check still counts every vector.
    - Readiness (§1) and risks (§8) now record the sqlite-vec failure, the latency split and the
      measured frame-vs-JPEG gap.
    - P1-4 has an amendment note: the 396 px size and the second, CPU-only model instance.
    - §7's negative-shot question is settled. Schema v1 has no `kind` column; a forward-only
      migration adds one in Phase 2 (`TR-39`, `TR-44`).
  - **`PROJECT_STATUS.md`:** `stillEmbedder` is ticked as verified on device, since P1-4's
    re-embeds ran through it. The test count is corrected to 93.
- **Small-catalog risk planned (ADR-013).** `PROJECT_SPECS.md` adds `SR-13` (confirm mode),
  `SR-14` ("Not in my list"), `TR-38` (`confirm_below` in `app_meta`) and `TR-39` (negative shots),
  and amends `SR-44`. `ARCHITECTURE.md` §6 corrects the framing: the risk is a sparse catalog, not a
  lone candidate. No code or threshold changed.
- `npm test` runs the domain tests instead of printing a placeholder:
  `node --test "src/domain/**/*.test.ts"`, with Node's `MODULE_TYPELESS_PACKAGE_JSON` warning
  silenced. Adding `"type": "module"` to `package.json` would break the CommonJS
  `babel.config.js` and `metro.config.js`. `npm run typecheck` now runs `tsc` twice: once on the
  app, once on `tsconfig.test.json`.
- `tsconfig.json`: `allowImportingTsExtensions` and `erasableSyntaxOnly` enabled, and
  `**/*.test.ts` excluded (ADR-012).
- Phase 0 gate **verified** with `/phase-gate` (2026-09-13). The result was reproduced from the
  raw phone backup `spike-dataset-20260913-233955.json` (SHA-256 `a9f9232c…`, matching the phone
  copy): `relabel.mjs` rebuilt the `.labeled.json` byte for byte, and `analyze.mjs` again gave
  top-1 94.5% (86/91) → PASS. Phase 1 is now in progress.
- Phase 0 catalog is now **25 products × 6 shots (150)**, down from 26 × 6:
  - Removed: `oil-pack-5p` / `-10p` / `-20p`. Added: `monggo-pack-10p` / `-20p` (repacks, still
    `L-01` + `L-02`, `ambiguous:`).
  - `nescafe-creamywhite-sugarfree-twin-pack-22.4g` was replaced by
    `nescafe-creamywhite-twin-pack-40g`, the true twin of the solo pack. That makes the pair
    size-only, so under the fixed size-family rule it is `ambiguous:`, not gated.
  - Gated products: 21 → 19. Runbook A-3 amended; the change was made before any analysis ran.
- `docs/PROJECT_STATUS.md`: A-3 recorded from the exported dataset — 26 products × 6 shots
  (156 shots, 1280-d, `mobilenet_v3_large_embedder_v1`), held in hand under store lighting.
  `L-01` moves from "unmeasured" to in the set (oil repacks).
- Phase 0 capture now runs from a **release-variant APK** rather than the debug build. A debug
  build streams its JS from the Metro dev server over USB, which pinned the phone to the laptop
  and would have forced A-3 to be shot at a desk — the one failure mode `PHASE_0_RUNBOOK.md`
  Part D calls the most likely way to produce a confidently wrong PASS. The release build embeds
  `index.android.bundle`, so the phone is standalone. No signing work was needed: the release
  build type is already signed with the debug keystore, so it installs as an upgrade and any
  captured dataset survives. Verified by inspecting the APK — bundle present, model asset
  present, zero dev-launcher classes. Consequence for `NFR-07`: the recorded 140–248 ms is a
  **debug** figure and the release number will differ; `analyze.mjs` reports in-worklet latency
  from the dataset, so the store run measures it directly.
- **TR-20 corrected:** the embedder's output is **1280-d, not 1024-d** — measured on device
  2026-09-13. Propagated to the `vec_shots` schema, the pipeline diagram and the worklet output
  rule in `ARCHITECTURE.md`, and to `DECISIONS.md` (ADR brute-force sizing). No code changed: the
  spike already read the model's reported `dim`, so this was a documentation error throughout.
- `docs/ARCHITECTURE.md` §8 performance budget now carries **measured** per-frame latency:
  140–248 ms (median ~148) on an Infinix X6823, debug build, against a 9–43 ms budget. `NFR-07`
  is **not met**; the three caveats and the first diagnostic are recorded alongside it.
- **TR-01 amended:** Expo SDK 55 / RN 0.83 → **SDK 57 / RN 0.86**. See ADR-009.
- **TR-11 amended:** `vision-camera-resize-plugin` → `react-native-nitro-image`. See ADR-010.
- **TR-21 clarified:** the model's own tensor description specifies input normalized to
  `[0.0, 1.0]` per channel; recorded so it is never re-derived by guesswork.

### Fixed
- **The release APK could not load the embedding model at all** — the spike stopped at "Model
  failed to load: `java.net.MalformedURLException: no protocol: assets_models_mobilenet_v3_large`",
  while the debug build had been loading the same model for a day. `react-native-fast-tflite` v3.0.1
  resolves a `require()`d model via `Image.resolveAssetSource()` and feeds the result to
  `java.net.URL` (`HybridAssetLoader.kt:14`). Under Metro that is `http://127.0.0.1:8081/...` and
  works; in a release build RN packages the asset as an Android resource and the call returns a bare
  name with no scheme, so the loader throws. The model was in the APK the whole time (`res/pW.tflite`,
  10,889,458 bytes, byte-identical to the source) — only its address was unusable. `App.tsx` now
  resolves the asset through `Asset.fromModule(...).downloadAsync()` and passes the resulting
  `file://` URI to `loadTensorflowModel({ url })` (`TR-29`, ADR-011). Confirmed on an Infinix X6823:
  model loads, 1280-d embeddings at ~140–144 ms. This affected **every** release build of the app,
  not only the spike.
- `scripts/analyze.mjs` counted `unknown:` negatives as top-1 ranking failures. The runbook (A-4)
  asks for un-enrolled products to be recorded as `unknown:<label>` so that rejection can be
  measured, but no enrolled label can ever match one — so every negative silently cost a point of
  top-1 accuracy. On a synthetic dataset where every enrolled frame ranks correctly, 15 negatives
  out of 95 scored frames dragged the gate to 84.2% and reported **FAIL on a perfect dataset**.
  Negatives are now partitioned out of the gate denominator and scored against `NFR-03` instead,
  which also means NFR-03 is measured at all for the first time. Accepting an un-enrolled product
  still counts as a false positive under `NFR-02`.
- `scripts/analyze.mjs` re-ranked every test frame inside the (τ, δ) sweep — ~4,200 pairs ×
  100 frames × 80 shots × 1280 dimensions. Frames are now ranked once up front; the sweep reads
  the cached ranking. Full analysis of a 20-product / 99-frame dataset runs in 0.19 s.
- Metro could not start: `babel-preset-expo` was installed nested under `node_modules/expo/`
  instead of hoisted, so Babel failed to resolve it from the project root and the transformer
  threw `Cannot find module 'babel-preset-expo'` while the dev server still claimed to be
  listening. Now declared as an explicit devDependency — a build-time preset only, so `TR-50`
  and `TR-51` are unaffected.

### Removed
- **`App.tsx` and `src/spike/`** (`config.ts`, `dataset.ts`, `vectors.ts`), deleted in P1-7
  (2026-09-14) as planned. The golden replay (P1-1) and `src/ml/` (P1-3) cover what they held.
  `scripts/analyze.mjs` and `relabel.mjs` never imported them. `index.ts` now registers
  `src/app/Root`. The GPU delegate toggle went with the dev host.
- **The temporary P1-2 and P1-4 device checks** (`src/db/devCheck.ts`, `src/dev/referenceCheck.ts`)
  and their buttons (2026-09-14, P1-5). Real enrollment replaces them, as both files said it would.
  Their measurements stay recorded above. The P1-4 sidecar `p1-4-reference-check.json` is left
  unread in the document directory.
- **The spike's enroll / collect modes in `App.tsx`** (2026-09-14, P1-5). The app no longer writes
  the spike JSON dataset. `src/spike/` stays until P1-7 deletes it. The labeled Phase 0 data is on
  the laptop and its backup, not on the phone.

---

<!--
Entry format:

## [0.1.0] — 2026-09-20

### Added
- Live scanner overlay showing name and price on a confident match (SR-02, SR-03)
- `src/domain/match.ts` — pure τ/δ matching policy with unit tests (TR-32, TR-37)

### Changed
- Frame rate throttled from 6 fps to 4 fps to meet the battery budget (NFR-06, TR-26)

### Fixed
- Photo paths stored relative to documentDirectory; absolute paths broke after iOS upgrades (TR-43)
-->
