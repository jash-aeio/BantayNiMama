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
- `scripts/small-catalog.mjs` — simulates small catalogs on the Phase 0 dataset (2026-09-14). It
  enrolls a random N of the 25 products and scores everything else as un-enrolled, 500 catalogs
  per size, per frame, at τ 0.46 / δ 0.075. Deterministic.
  - Un-enrolled frames auto-accepted: 7.9% at 1, **15.1% at 5**, 9.7% at 15, 2.9% at 25
    (`NFR-02` ≤ 2%). The 25-product row matches the golden replay's 3/105.
  - At 5 products, 8.9% of false accepts are same-brand siblings.
  - Also measures three candidate fixes: a lone-candidate floor, τ scaled to catalog size, and a
    distractor bank. Results in ADR-013.

### Changed
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
- _nothing yet_

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
