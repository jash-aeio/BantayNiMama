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

### Changed
- **TR-01 amended:** Expo SDK 55 / RN 0.83 → **SDK 57 / RN 0.86**. See ADR-009.
- **TR-11 amended:** `vision-camera-resize-plugin` → `react-native-nitro-image`. See ADR-010.
- **TR-21 clarified:** the model's own tensor description specifies input normalized to
  `[0.0, 1.0]` per channel; recorded so it is never re-derived by guesswork.

### Fixed
- _nothing yet_

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
