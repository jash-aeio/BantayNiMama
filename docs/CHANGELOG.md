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

### Changed
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
