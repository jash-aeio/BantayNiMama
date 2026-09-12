# Phase 0 Runbook — Embedding Viability Spike

> **Purpose.** Answer Q-1: does a generic embedding model separate real sari-sari SKUs well
> enough to build on? Everything else in this project is blocked behind that answer.
>
> **This is throwaway code by design** (`CLAUDE.md`). Do not polish it. Its only job is to
> produce one number: top-1 accuracy on non-ambiguous items.

---

## What the spike app does

Three modes, one screen, no navigation library. Deliberately crude.

| Mode | What you do | What it records |
|---|---|---|
| **enroll** | Type a product label, point at the product, tap *Capture reference shot*. Repeat 3–5× per product from different angles. | A 1280-d L2-normalized vector per shot |
| **scan** | Just point. Live top-3 with cosine scores and the top1−top2 margin. | Nothing — this is the "does it feel right" mode |
| **collect** | Type the **true** label of what you're pointing at, tap *Record test frame*. | A labeled vector + in-worklet latency |

**Fixing mistakes.** Every capture is saved immediately, so there are three ways to take one back:

- *Undo last shot (label)* in **enroll** — removes the most recent reference shot. Use it for a
  blurry shot, a shot outside the reticle, or a shot under the wrong label.
- *Undo last test frame (label)* in **collect** — removes the most recent test frame.
- Tap a product in the **Enrolled** list — after a confirmation, deletes every shot for that label.
  Use it for a typo'd label, or to re-enroll a product from scratch. Its test frames are **not**
  deleted; the prompt warns you if any exist, because frames with no enrolled shots score as misses.

Undo works only on the latest capture. Shots carry no id, timestamp or photo, so an older one
cannot be picked out — delete the product and re-shoot it instead.

*Export dataset JSON* hands `spike-dataset.json` to the Android share sheet. Get it onto the
laptop any way you like — USB, SD card, a file manager. **No network path is used or needed.**

Then, on the laptop:

```bash
npm run analyze -- path/to/spike-dataset.json
```

which prints top-1 / top-3 accuracy, the score histograms τ and δ are read off, the worst
confusions, a (τ, δ) sweep constrained to the NFR-02 false-positive ceiling, and a PASS/FAIL
on the gate. It exits non-zero on FAIL.

---

## Part A — What only you can do

These are blocking. Nothing else in Phase 0 matters until A-3 is done.

### A-1. Install JDK 17 and put the Android SDK on PATH — ✅ **DONE (2026-09-12)**

Verified on this machine:

| Check | Value |
|---|---|
| `java -version` | `17.0.20.1` (Microsoft OpenJDK) |
| `JAVA_HOME` | `C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot` |
| `ANDROID_HOME` | `C:\Users\Jasper\AppData\Local\Android\Sdk` |
| `adb` | on PATH, runs (lists no devices — that is A-2) |
| SDK platform | `android-36`; build-tools 35.0.0 / 36.0.0 |

`npx expo prebuild` has since generated `android/` with Gradle 9.3.1.

> **One gap remains.** `$ANDROID_HOME/ndk` is empty. The first `npm run android` compiles native
> C++ for `react-native-fast-tflite` and `react-native-nitro-modules`; Gradle will either
> auto-download the NDK it wants or stop with "NDK not configured". If it stops, install the
> version it names via Android Studio's SDK Manager. Budget time for this — it is a long download.

The original instructions are kept below for reproducibility on a fresh machine.

**Expo SDK 57 / RN 0.86 needs JDK 17** — 20 is not a supported AGP toolchain and 11 is too old.

```powershell
winget install Microsoft.OpenJDK.17
```

Then set the environment variables permanently (new terminal afterwards):

```powershell
[Environment]::SetEnvironmentVariable('ANDROID_HOME', "$env:LOCALAPPDATA\Android\Sdk", 'User')
[Environment]::SetEnvironmentVariable('JAVA_HOME', 'C:\Program Files\Microsoft\jdk-17.0.16.8-hotspot', 'User')
$p = [Environment]::GetEnvironmentVariable('Path','User')
[Environment]::SetEnvironmentVariable('Path', "$p;$env:LOCALAPPDATA\Android\Sdk\platform-tools", 'User')
```

Adjust the `JAVA_HOME` path to whatever `winget` actually installed — check
`ls 'C:\Program Files\Microsoft'`.

Verify:

```powershell
java -version   # must say 17
adb version
```

### A-2. A physical Android phone

`TR-03`: Expo Go cannot load these native modules. You need a dev build on real hardware.
An emulator is not good enough — it has no real camera, and Phase 0 is *entirely* about what a
real camera sees under real store lighting.

- Enable **Developer options** → **USB debugging** on the phone.
- Plug it in, accept the RSA prompt, confirm `adb devices` lists it.
- **Write down the exact model.** Every latency number in `PROJECT_STATUS.md` must name the
  device it was measured on.

> If the phone is a budget Android (the real target market per `TR-02`), that is the *better*
> device to measure on, not the worse one.

#### Taking the phone off the laptop — build the release variant

A debug build loads its JavaScript from the Metro dev server over the USB cable, so unplugging
the phone kills the app. That makes the store trip impossible, which is the wrong reason to shoot
desk photos. The fix is a release build: Gradle embeds the JS bundle into the APK, and the phone
becomes standalone.

```bash
npx expo run:android --variant release
```

No signing setup is needed — `android/app/build.gradle` signs the release build type with the
debug keystore. Because the signature matches the debug build, this installs as an upgrade and any
dataset already captured survives.

Two things follow from this, both worth having:

- The phone leaves the desk, so A-3 can be shot where `TR-02` says it matters.
- The **140–248 ms** latency in `PROJECT_STATUS.md` was measured on a *debug* build — unoptimised
  JS, dev-mode bridge assertions. The release figure is the honest one. Record it as a separate
  row; do not overwrite the debug measurement.

### A-3. Reference photos of ~20 real products, shot in an actual store

**This is the single blocking input and no amount of code substitutes for it.** The thesis is
about real packaging under real lighting on real shelves. Photos of products on your desk will
give an optimistic number that collapses in Phase 3.

The set must include near-identical pairs — they are what the spike actually tests. The specific
brands do not matter; the *shape* of the confusion does. Two classes are required:

| Class | Why it matters | Example on hand (2026-09-13) |
|---|---|---|
| **Same brand, different variant** | Near-identical artwork, different product and price. This is the sharpest test of whether the embedder separates SKUs at all. | Two Nissin ramen variants |
| **Same product, different pack size** | Tests `L-02`. Solo and twin-pack share the artwork; only the count differs. | Creamy white solo vs twin pack |

Plus ~18 ordinary SKUs to fill out the catalog.

> **Not covered by the current set:** two repacked clear bags (`L-01`). `L-01` is already an
> accepted limitation with a quick-pick-grid workaround, so leaving it unmeasured costs nothing —
> but do not later read a passing gate as evidence that clear-bag repacks work. They were not tested.

**Labelling convention that the analysis script depends on:** prefix the known-unsolvable items
with `ambiguous:` — for example `ambiguous:repack-sugar-1kg`. The script excludes those from the
gate calculation, because `L-01` says no embedding model can separate identical images and
counting them as failures would measure the wrong thing.

Use lowercase-hyphenated labels: `palmolive-green-sachet`, `kopiko-3in1`, `coke-250ml`.

### A-4. ~100 labeled test frames

In **collect** mode, in the store, pointing at products you have already enrolled. Vary angle,
distance and lighting — that variation is the measurement. Roughly 5 frames per product across
20 products gets you to 100.

Record some frames of **un-enrolled** products too, labelled `unknown:<whatever>` — roughly 15 of
the 100. `NFR-03` wants ≥85% correct rejection and you cannot measure rejection without negatives.

These are scored separately from the gate: `analyze.mjs` keeps `unknown:` frames out of the top-1
denominator (they can never match an enrolled label) and reports them as an NFR-03 rejection rate.
Accepting one still counts as a false positive under `NFR-02` — a confident price for a product
that is not in the catalog is the worst failure the app has.

> **Undo a test frame only for an operator mistake** — wrong label typed, product not in the
> reticle, lens covered. **Never undo one because the top-3 showed the wrong product.** Wrong
> matches are exactly what this step measures; removing them inflates top-1 and hides false
> positives, which is how the gate produces a confidently wrong PASS (`NFR-02`).

### A-5. Decisions only you can make

- Whether the gate result is good enough to proceed, if it lands near 85%.
- Whether a confusion pair is a real product-identity problem or a framing problem.

---

## Part B — What is already done

- [x] Expo SDK 57 dev-client project, TypeScript `strict` + `noUncheckedIndexedAccess`
- [x] VisionCamera v5 preview with a centre reticle at `RETICLE_FRACTION`
- [x] `react-native-fast-tflite` v3 wired to the MobileNetV3-Large embedder
- [x] In-worklet crop → resize → float32 → `runSync` → L2-normalize (`src/spike/embed.ts`)
- [x] 4 fps throttle inside the worklet (`TR-26`)
- [x] In-JS cosine ranking, best-shot-per-product aggregation, live top-3 (`src/spike/vectors.ts`)
- [x] Dataset capture, persistence and share-sheet export (`src/spike/dataset.ts`)
- [x] Offline analysis, τ/δ sweep and gate evaluation (`scripts/analyze.mjs`) — verified against
      synthetic data on both the PASS and FAIL paths
- [x] Model fetch script (`npm run fetch-model`), model gitignored

---

## Part C — The run, step by step

```bash
npm run fetch-model          # already done once; idempotent
npm run android              # first build is slow: Gradle downloads a lot
```

`npm run android` runs `expo run:android`, which prebuilds `android/` and installs the dev build.
After the first build, `npm start` is enough for JS changes.

**First launch happened on 2026-09-13, and both checks fired.** Recorded here rather than left as
instructions, because both assumptions turned out to be wrong:

- `dim` reads **1280**, not 1024. `TR-20`, the `vec_shots` schema and the pipeline diagram have
  been corrected. No code hard-coded 1024 — the spike reads the model's reported `dim` — so this
  was a documentation error only.
- Latency reads **140–248 ms (median ~148)**, against a ~40 ms expectation. Noted, not hidden:
  see the `NFR-07` note in `ARCHITECTURE.md` §8 for the three caveats and the first diagnostic.

Neither blocks enrollment. The Phase 0 gate is accuracy, and accuracy is unaffected by how long
each frame takes.

Then:

1. **enroll** — 20 products × 3–5 shots, in the store.
2. **scan** — sanity-check that the live top-3 is not nonsense before investing in collection.
3. **collect** — ~100 labeled frames.
4. **Export dataset JSON**, move it to the laptop.
5. `npm run analyze -- spike-dataset.json`
6. `/spike-report` to write the measured numbers into the docs.

---

## Part D — Known risks in this spike

Flagging these honestly now rather than discovering them at 11pm in a store.

| Risk | Why | If it bites |
|---|---|---|
| **Frame → Image → crop → resize chain is unproven on device** | `react-native-fast-tflite`'s official VisionCamera **v5** integration example is behind a GitHub sponsorship; the glue in `src/spike/embed.ts` is written from the published Nitro type definitions, not from a working reference. The types are right; the runtime behaviour is not yet observed. **Retired 2026-09-13** — observed working end to end on an Infinix X6823 in both debug and release: 1280-d embeddings, plausible top-3 ranking. | Most likely failure is a pixel-format or disposal issue. `channelLayout()` already handles all eight RGB layouts, and `dim` printing in the header is the canary. |
| **Channel order** | Android hands back RGBA, iOS usually BGRA. Swapped channels do not throw — they just quietly cost accuracy. | If top-1 is implausibly bad, log `raw.pixelFormat` before blaming the model. |
| **Input range** | The model's own tensor description says `[0.0, 1.0]` per channel, so `INPUT_SCALE = 1/255`. A `[-1, 1]` assumption would silently degrade every score. | Confirmed from the model file, not assumed. |
| **GPU delegate is off** | `loadTensorflowModel(..., [])` loads on CPU. Latency is therefore a pessimistic number. | Pass `['android-gpu']` once correctness is established, and re-measure. Record both. |
| **Desk photos** | Enrolling at a desk and testing at a desk produces a number that means nothing. | See A-3. This is the most likely way Phase 0 produces a confidently wrong PASS. |
| **Debug-only code paths** | The release build is a different animal: the JS is bundled and assets are packed as Android resources. This already bit once — the model loaded fine under Metro for a day and then failed on the first release APK (ADR-011, `TR-29`). | Capture from the **release** APK, and re-verify anything asset- or path-shaped there rather than trusting the debug run. |

---

## Part E — If the gate fails

Per `PROJECT_STATUS.md`, **do not start Phase 1.** In order:

1. Tighten reticle guidance and re-shoot. Framing is a bigger lever than model choice (`ADR-006`).
2. Try MobileCLIP via `react-native-executorch`, accepting the JS-thread architecture cost
   (`ADR-002` — this is exactly the Phase 3 bake-off, pulled forward).
3. Reconsider the product thesis.
