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

### Changed
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
