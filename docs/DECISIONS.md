# Architecture Decision Records

Short records of decisions that were genuinely contested — what was chosen, what was rejected, and
why. A decision nobody would question does not need an ADR.

> **Claude: add an ADR when you make or change a choice that a future reader would otherwise
> reverse by accident.** Never delete an ADR; supersede it with a new one and mark the old one.

**Status values:** Accepted · Superseded by ADR-NNN · Revisit at Phase N

---

## ADR-001 — React Native + Expo over Flutter and native Android

**Status:** Accepted · 2026-09-12 · *SDK version amended by ADR-009; the platform choice stands.*

**Context.** The app needs camera frame access and on-device ML on both Android and iOS, built
largely solo.

**Decision.** React Native via Expo SDK 55 with `expo-dev-client`.

**Rejected.** *Flutter* — excellent TFLite bindings, but a smaller overlap with the developer's
existing skills. *Native Android (Kotlin)* — best performance and smallest APK on the budget phones
that are the real market, but Android-only and slowest to build.

**Consequence.** Expo Go is unusable from day one; every developer needs a custom dev build. This is
a real onboarding cost and is called out in `TR-03`.

---

## ADR-002 — `react-native-fast-tflite` over `react-native-executorch`

**Status:** Accepted · Revisit at Phase 3 · 2026-09-12

**Context.** Continuous live scanning at ~4 fps requires inference that does not block the JS thread.

**Decision.** `react-native-fast-tflite`, called with `runSync` **inside the VisionCamera frame
worklet**.

**Rejected.** `react-native-executorch` ships `useImageEmbeddings` with CLIP out of the box and
would likely win on raw accuracy — but it is a **React hook on the JS thread**, which is the wrong
shape for a frame-processor loop. It remains an excellent fit for enrollment and tap-to-scan.

**Consequence.** The MobileCLIP accuracy advantage is deferred, not abandoned. Phase 3 runs a
head-to-head bake-off on real labeled data; if MobileCLIP wins decisively, the architecture cost of
moving inference to the JS thread gets re-evaluated then.

---

## ADR-003 — sqlite-vec over a dedicated vector database

**Status:** Accepted · 2026-09-12 · *sqlite-vec half superseded by ADR-014 (it cannot load on 32-bit ARM); op-sqlite and the one-file layout stand*

**Context.** The app needs KNN over a few thousand embeddings, entirely offline.

**Decision.** `op-sqlite` with the sqlite-vec extension. Metadata and vectors live in one SQLite file.

**Rejected.** *ObjectBox* and *libSQL* vector search are both credible, but keep data in a
proprietary or less inspectable store. Plain SQLite is debuggable with any tool and trivially
exportable — which directly serves `L-03` / `SR-45`.

**Consequence.** One file plus one photos directory is the entire application state. Backup in
Phase 4 is a zip, not a migration.

---

## ADR-004 — No ANN index; brute-force KNN

**Status:** Accepted · Revisit above ~50,000 vectors · 2026-09-12 · *Where brute force runs amended by ADR-014 (JS for now; the "sub-millisecond" figure below was an estimate for native code — JS measured 234 ms at 2,500 shots)*

**Context.** Vector search must return in single-digit milliseconds.

**Decision.** Brute-force cosine via sqlite-vec, no HNSW or IVF index.

**Rationale.** A large sari-sari store holds ~500 SKUs × 5 shots = 2,500 vectors. SIMD brute force
over 2,500 × 1280 floats is sub-millisecond. An approximate index would add build time, tuning
parameters, recall loss and update complexity for no measurable gain.

---

## ADR-005 — Local-only, with export designed in from day one

**Status:** Accepted · 2026-09-12

**Context.** Sari-sari vendors are price- and data-sensitive; a backend adds cost, accounts and a
failure mode when connectivity drops.

**Decision.** 100% offline. No backend, no accounts, no sync (`TR-50`).

**Consequence.** **Losing the phone means losing the catalog** (`L-03`). This is an accepted cost,
not an oversight. It is mitigated by constraining the file layout now — one DB file, one photos
directory, relative paths only (`TR-46`, `TR-43`) — so export/import in Phase 4 is a small feature
rather than a data migration.

---

## ADR-006 — Fixed center reticle instead of object detection

**Status:** Accepted · Revisit at Phase 5 · 2026-09-12

**Context.** A sari-sari shelf is visually dense. Embedding a full frame produces a vector dominated
by clutter.

**Decision.** Embed only a fixed center square of the frame, and teach the framing in the UI
(*"isang item lang sa loob ng kahon"*).

**Rejected.** Running an object detector to propose crops — a second model in the frame budget, on
phones that barely afford the first one.

**Consequence.** Accuracy depends on user framing, making the reticle a UX problem as much as a
technical one. Cropping is a bigger accuracy lever than model choice; treat it that way when the
Phase 0 gate is close.

---

## ADR-007 — Money as integer centavos

**Status:** Accepted · 2026-09-12

**Decision.** All currency stored and computed as integer centavos. ₱12.50 is `1250`.

**Rationale.** Floating point makes prices that do not add up. In an app whose entire purpose is
quoting correct prices, that is a product-destroying bug class. Formatting to `₱12.50` happens only
at the render boundary.

---

## ADR-008 — Thresholds as data, not constants

**Status:** Accepted · 2026-09-12

**Decision.** `τ` and `δ` live in the `app_meta` table, read at runtime (`TR-35`).

**Rationale.** They are empirical values derived from a score distribution, and they will be retuned
repeatedly as the catalog grows. Hard-coded constants get tuned by guesswork in a commit; a
configuration row gets tuned by measurement and can be adjusted without a rebuild.

---

## ADR-009 — Expo SDK 57 instead of the specified SDK 55

**Status:** Accepted · 2026-09-12 · Amends `TR-01`

**Context.** `TR-01` specified Expo SDK 55 / RN 0.83 / React 19.2. By the time Phase 0 was
scaffolded, SDK 55 was two majors behind: current stable is SDK 57.0.22 on RN 0.86.3. More
importantly, the packages this project's architecture depends on — VisionCamera v5.2.3,
`react-native-fast-tflite` v3.0.1, and the Nitro modules underneath both — are developed and
tested against the current RN, not against 0.83.

**Decision.** Scaffold on Expo SDK 57 / RN 0.86.3.

**Rejected.** Honouring `TR-01` literally. It would have kept the spec tidy at the cost of
running the riskiest, least-documented part of the stack (a Nitro-based frame processor calling
TFLite synchronously) two majors away from where it is actually exercised. Phase 0 exists to
test the recognition thesis; spending its budget on version-skew bugs tests nothing.

**Consequence.** `TR-01` is amended rather than dropped. React is 19.2.3 and the New Architecture
is the only architecture, both of which `TR-01` already assumed. No requirement is weakened.

---

## ADR-010 — `react-native-nitro-image` instead of `vision-camera-resize-plugin`

**Status:** Accepted · 2026-09-12 · Amends `TR-11`

**Context.** `TR-11` specified `vision-camera-resize-plugin` for in-worklet crop, resize and
pixel-format conversion. That package targets VisionCamera **v4** and the `react-native-worklets-core`
runtime. VisionCamera v5 is a ground-up Nitro rewrite with a different threading model
(`react-native-vision-camera-worklets` over `react-native-worklets`), so the plugin no longer fits
the architecture chosen in `ADR-002`.

**Decision.** Use `react-native-nitro-image`, which VisionCamera v5 already depends on. The chain is
`HybridFrameConverter.convertFrameToImage(frame)` → `image.crop(...)` → `.resize(224, 224)` →
`.toRawPixelData()`. Every one of those has a synchronous variant, which is what makes it usable
inside the frame worklet.

**Rejected.** *Pinning VisionCamera v4* to keep the resize plugin — that would forgo the single
property that made v5 attractive: because v5 is itself a Nitro module, a `TfliteModel` HybridObject
crosses into the worklet without boxing. Under v4, `react-native-fast-tflite` requires
`NitroModules.box()` / `unbox()` gymnastics.

**Consequence.** Channel order must now be handled in application code: `toRawPixelData()` returns
one of eight RGB layouts depending on platform (Android bitmaps come back `RGBA`, iOS typically
`BGRA`). `channelLayout()` in `src/spike/embed.ts` maps all of them. This is a real new failure mode
— wrong channel order does not throw, it just quietly costs accuracy — and it is why the layout is
resolved from `raw.pixelFormat` at runtime rather than assumed per platform.

**Note.** `react-native-fast-tflite` v3's official VisionCamera v5 integration example is behind a
GitHub sponsorship. The library itself is MIT and its Nitro type definitions are complete, so the
glue was written from the types. It is **type-correct but not yet observed running on a device** —
tracked as a risk in `PHASE_0_RUNBOOK.md` Part D.

---

## ADR-011 — Resolve the model through `expo-asset` instead of patching `react-native-fast-tflite`

**Status:** Accepted · 2026-09-13 · Adds `TR-29`

**Context.** The first release-variant APK launched and then stopped at "Model failed to load:
`java.net.MalformedURLException: no protocol: assets_models_mobilenet_v3_large`". The debug build had
been loading the same model successfully for a day. `react-native-fast-tflite` v3.0.1 resolves a
`require()`d model with `Image.resolveAssetSource()` and passes the result straight to `java.net.URL`
(`HybridAssetLoader.kt:14`). Under Metro that value is `http://127.0.0.1:8081/assets/...`; in a release
build React Native packs the asset into the APK as an Android resource and the same call returns the
bare name `assets_models_mobilenet_v3_large`, which is not a URL. The model was in the APK throughout
(`res/pW.tflite`, 10,889,458 bytes, byte-identical to the source file) — only its address was unusable.

**Decision.** Resolve the asset with `Asset.fromModule(...).downloadAsync()` and pass the resulting
`localUri` to `loadTensorflowModel({ url })`. `expo-asset`'s native `AssetModule` copies an embedded
asset out of the APK into the cache directory and hands back a real `file://` path, which the library's
loader opens unmodified.

**Rejected.** *Patching `HybridAssetLoader.kt`* to resolve resource names natively — correct at the
source, but it puts a `patch-package` step and a fork of a native file between this project and every
future upgrade of the library, to fix a spike that is throwaway by design.
*Shipping the model in `android/app/src/main/assets/`* and loading `file:///android_asset/...` — that
prefix is a WebView convention, not a filesystem path, so `java.net.URL` cannot open it either.

**Consequence.** `expo-asset` ~57.0.17 becomes a direct dependency. It was already present
transitively under `node_modules/expo/` and its `AssetModule` was already autolinked into the APK, so
no new native code is compiled in — but a top-level import needs it hoisted, so it is now declared
explicitly. Against `TR-51`: `expo-asset` *can* fetch remote assets, and does so under Metro in
development, but for an embedded asset in a release build it reads from the APK. Verified rather than
assumed — with the device in airplane mode the release build loads the model and produces 1280-d
embeddings (`TR-53`; Infinix X6823, 2026-09-13).

**Note.** This is not a Phase 0 quirk. Every release build of this app hits it, so the resolution step
belongs in `src/ml/` when Phase 1 replaces the spike — hence a requirement (`TR-29`) rather than a
runbook footnote.

---

## ADR-012 — `node --test` for the domain layer; the Phase 0 golden replay stays local-only

**Status:** Accepted · 2026-09-14 · Phase 1 decisions D-2 and D-3 (`PHASE_1_PLAN.md` §3)

**Context.** `src/domain/` is where recognition correctness is proven (`TR-37`), so Phase 1 needs a
test runner. The Phase 0 labeled dataset is the only real ground truth the project has, and the new
matching policy should be held to it. It is 9.6 MB of JSON and gitignored.

**Decision.**
1. Run domain tests with **Node's built-in `node --test`** (Node 24 runs `.ts` files directly by
   stripping types).
2. The **golden replay** — the new `match.ts` over
   `spike-dataset-20260913-233955.labeled.json` at τ 0.46 / δ 0.075, asserting 86/91 top-1, 68/91
   accepts and 3/196 false accepts — reads the file from `spike/results/`. **When the file is
   absent, the test fails with a message naming the file.** It does not skip.

**Rejected.**
- *`jest-expo`* (~57.0.5) — the Expo default and better documented. But it adds hundreds of
  transitive packages, each of which `TR-51` says to audit. The domain layer is pure by rule and
  needs none of the React Native test environment.
- *Committing the dataset*, raw or packed to binary (~2.7 MB, estimate). Every clone would carry it
  forever.
- *Silently skipping when absent.* A skipped regression test reads as a passing one.

**Consequence.**
- Domain code is limited to syntax that type stripping can erase: no `enum`, no `namespace`, no
  constructor parameter properties.
- It imports siblings by relative path with the `.ts` extension, not through the `@/` alias.
  `tsconfig.json` enables the matching flags, `allowImportingTsExtensions` and
  `erasableSyntaxOnly` — *confirmed in P1-1, 2026-09-14*.
- *Found in P1-1:* TypeScript 6 no longer loads every installed `@types` package, so test files
  cannot see `node:test`. Declaring `node` types globally would leak Node's types into React
  Native code. Test files are therefore excluded from `tsconfig.json` and typechecked through
  `tsconfig.test.json`; `npm run typecheck` runs both.
- *Found in P1-1:* Node warns `MODULE_TYPELESS_PACKAGE_JSON` for each `.ts` test file. The fix
  it suggests, `"type": "module"`, would break the CommonJS `babel.config.js` and
  `metro.config.js`, so `npm test` disables that one warning instead.
- **A fresh clone's `npm test` fails until `spike/results/` is restored from backup.** That is
  deliberate. It is also why backing up that folder is a Phase 1 prerequisite (`PHASE_1_PLAN.md`
  §2). `TR-53` is unaffected: the test reads a local file and needs no network.

---

## ADR-013 — On a small catalog, ask instead of quoting; learn negatives from the store's shelf

**Status:** Accepted · Revisit at Phase 3 · 2026-09-14 · Adds `SR-13`, `SR-14`, `TR-38`, `TR-39`;
amends `SR-44`

**Context.** In Phase 0, δ did the un-enrolled rejection, not τ (`ARCHITECTURE.md` §6). δ can only
reject an item when an enrolled product sits close to it. Every Phase 0 number came from a
25-product catalog, but a new store starts with five (`SR-44`). `scripts/small-catalog.mjs`
resamples the Phase 0 data into smaller catalogs. Per frame, at τ 0.46 / δ 0.075, un-enrolled frames
auto-accepted as a wrong product are 7.9% at 1 product, **15.1% at 5**, 9.7% at 15, and 2.9% at 25.
`NFR-02` allows ≤ 2%. At 5 products, 8.9% of those false accepts are same-brand siblings; the rest
are unrelated items (Ajinomoto salt → Colgate sachet). This is a simulation on one counter's data,
not a store measurement.

**Decision.**
1. **Confirm mode (`SR-13`).** Below `app_meta.confirm_below` enrolled products (`TR-38`), an ACCEPT
   becomes *"Is this {name}? ₱{price} — Yes / No"*. A wrong price then cannot be quoted
   confidently. The system does not have to reject correctly for that to hold, and the cost is one
   tap per scan while the catalog is small.
2. **Store-local negatives (`SR-14`, `TR-39`).** *No*, or rejecting a wrong result, saves the frame as a
   hidden negative. The items most likely to be confused are the ones on that store's shelf, and
   only the tindera can photograph them.
3. **No change to `match.ts`, τ or δ in Phase 1.** The golden replay stays as it is.

**Rejected.**
- *A floor for a lone candidate* (accept only ≥ 0.60 when nothing else is enrolled). N=1 falls to
  0.4%, but correct accepts fall to 65.9%, and N ≥ 2 is unchanged — the problem is sparsity, not
  the missing top-2.
- *τ scaled to catalog size.* Holding ≤ 2% takes τ 0.58–0.61 between 3 and 15 products, where
  correct accepts fall to 59.7–71.0%. The problem becomes "nothing is recognised".
- *An enrollment prompt for sibling SKUs* ("do you also sell other flavours?"). Considered and not
  adopted: siblings are under 9% of false accepts at 5 products.

**Deferred to Phase 3, not rejected — a bundled distractor bank.** Ship embeddings of common products
that no store enrolls, as hidden items. Simulated with half the un-enrolled brand families as the
bank: 15.1% → 4.7% at 5 products, correct accepts 88.8% → 79.1%. That number is flattered, because
the bank and the test frames share a counter and lighting. A fair test needs a bank photographed
elsewhere. Shipping one also means shipping its JPEGs, so it can be re-embedded on a model swap (`TR-24`).

**Consequence.**
- `confirm_below` needs a calibration Phase 0 cannot give. On Phase 0 data even 25 products leave
  2.9% of un-enrolled frames accepted, so the value must come from store data in Phase 3.
- Negatives change the schema: a shot must be distinguishable as a negative. Phase 1 builds none,
  but schema v1 should not block one (`PHASE_1_PLAN.md` §7).
- The 3-of-5 stability gate (`TR-36`) is not modelled. How much it removes is unmeasured.

---

## ADR-014 — Vectors as BLOBs, searched in JavaScript, until native search works on 32-bit ARM

**Status:** Accepted · Revisit at Phase 3 · 2026-09-14 · Partly supersedes ADR-003 (its sqlite-vec
half; op-sqlite stays) · Amends `TR-13`, `TR-30`, `TR-40`

**Context.** P1-2's day-one checkpoint (Infinix X6823, release APK, 2026-09-14) found two things:

- **op-sqlite's bundled sqlite-vec does not load on 32-bit ARM.** Its prebuilt `armeabi-v7a`
  `libsqlite_vec.so` calls `ceil` but does not declare `libm.so`, so `open()` throws
  `dlopen failed: cannot locate symbol "ceil"`. 18.2.1 is the latest release. Reported as
  [op-sqlite#456](https://github.com/OP-Engineering/op-sqlite/issues/456).
- **32-bit matters.** The test phone is 32-bit only, and the budget phones this app targets
  (`TR-02`) often are too.

A second checkpoint build, with sqlite-vec switched off, measured on the same phone:

| Measurement | Result |
|---|---|
| Plain SQLite | opens `bantay.db` in the document directory |
| 1280-d `Float32Array` stored as a BLOB and read back | bit-exact |
| Read 2,500 vector BLOBs | 56.3 ms |
| JS brute-force search, 100 shots | median 9.2 ms |
| JS brute-force search, 2,500 shots, inline loop | median 234.0 ms |
| JS brute-force search, 2,500 shots, `dot()` per shot | median 831.1 ms |

**Decision** (operator's call, after the measurement):

1. Each shot's vector is stored as a **BLOB in `product_shots.embedding`**: little-endian Float32
   × `embedding_dim`, L2-normalized (`TR-22`), stamped with its `model_id` (`TR-23`). The `vec0`
   table leaves the schema.
2. **Search is a pure inline brute-force loop** in `src/domain`. It runs over one contiguous
   `Float32Array` matrix held in memory, rebuilt from SQLite at startup and extended after each
   enrollment commits. It keeps the top 10 (`TR-30`) and hands them to `rankProducts` (`TR-31`).
3. op-sqlite stays, as plain SQLite with `"sqliteVec": false`.

**Rejected.**

- *Building sqlite-vec ourselves now.* It keeps `vec0` and targets `NFR-09` from the start, but
  puts a native build step, maintained across upgrades, ahead of a phase whose job is the data
  path. Its speed on 32-bit ARM is also unmeasured.
- *Waiting for op-sqlite#456.* That blocks Phase 1 for an unknown time.

**Consequences.**

- **`NFR-09` is not met by this search on the test phone.** At 500 products (2,500 shots), 234 ms
  is nearly the whole 250 ms frame interval at 4 fps (`TR-26`). Native search is **owed before
  Phase 4**: our own sqlite-vec build, a fixed op-sqlite, or another native path. It is tracked in
  `PROJECT_STATUS.md` and revisited in Phase 3, where it must be measured on the same phone.
- **Switching later needs no data migration.** A native index is rebuilt from the BLOBs, the same
  way `TR-24` re-embeds from JPEGs.
- **The per-frame loop must be written inline over the contiguous matrix.** Calling `dot()` per shot
  allocates a `subarray` each time, which measured 3.5× slower on Hermes (no JIT).
- **The matrix is a derived index, never the source of truth.** It only changes after a commit
  succeeds, so a rolled-back enrollment is never searchable (`TR-45`).
- **"KNN starvation" goes away** (`PHASE_1_PLAN.md` §7). Soft-deleted shots and vectors from
  another `model_id` are simply left out when the matrix is built.
- **Memory:** 2,500 × 1280 × 4 bytes ≈ 12.8 MB for the matrix at 500 products. That figure is
  computed, not measured.
- **ADR-004 stands.** There is still no approximate index; brute force is still the algorithm.
  Only where it runs changed.

---

## ADR-015 — React Navigation bottom tabs instead of `expo-router`

**Status:** Accepted · 2026-09-14 · Amends `TR-14`

**Context.** P1-7 builds the app shell: two tabs, Scan and Products. `TR-14` named `expo-router`.
Before installing, P1-7 measured what each option would add (dry-run installs, and source read
2026-09-14):

| | `expo-router` 57.0.21 | `@react-navigation/bottom-tabs` 7.18 |
|---|---|---|
| Packages added | **73** | **23** |
| Native modules added | 11: reanimated 4.6, gesture-handler 3.3, screens, safe-area, expo-font, expo-symbols, expo-glass-effect, `@expo/ui`, `@expo/dom-webview`, expo-linking, masked-view | 2: screens, safe-area |
| Network code in its source (`TR-51`) | Present but inert unless enabled. Data-loader `fetch`, React Server Components `fetch`, and a dev-server ping in the onboarding tutorial. | None found, in JS or native |

- **Worklets conflict.** `expo-router` requires `react-native-reanimated`, and reanimated 4.x ties
  itself to a particular `react-native-worklets` version. That library carries the camera frame
  processor, pinned at 0.10.1 for VisionCamera (`TR-25`). It is the most fragile native piece in
  the app, and every native change costs a rebuild cycle on the 32-bit test phone.
- **File-based routing is the only thing lost.** `expo-router` is a file-based layer over this same
  React Navigation. The app has two tabs and no deep links (`TR-50`), so file-based routing buys
  nothing yet.

**Decision** (operator's call, 2026-09-14): use `@react-navigation/native` +
`@react-navigation/bottom-tabs`, with `react-native-screens` and `react-native-safe-area-context`
at Expo SDK 57's pinned versions. `TR-14` is amended to match.

**Rejected.**

- *`expo-router`, as specced.* It passes `TR-51` on the source read, but 73 packages to audit and
  keep audited, and a possible worklets clash, for routing two screens.
- *No library, a hand-rolled two-button switcher.* Zero dependencies, but no Android back-button
  handling or screen lifecycle (`useIsFocused` is what pauses the camera on the Products tab).
  Phase 2 would add a navigation library anyway.

**Consequences.**

- **Screens are plain components registered in `src/app/Root.tsx`**, not files under `app/`.
  `ARCHITECTURE.md` §7 is updated.
- **Moving to `expo-router` later stays cheap.** The screens are already React Navigation screens;
  only the registration would change. Revisit if deep links or many routes ever arrive.
- **Every new native module is still audited before install.** The 25 packages installed here
  (the 23, plus `expo-localization` and its `rtl-detect`) had zero network-call hits.

---

## ADR-016 — Lock on 4 of 5 frames instead of 3

**Status:** Accepted · 2026-09-14 · Amends `TR-36` · Revisit in Phase 3 alongside the τ/δ retune

**Context.**

- **Gate run 2 failed step 5** (P1-8, Infinix X6823, release APK, airplane mode). With a
  motion-blurred **Alaska Evaporada 360ml** in the reticle, the app locked **Argentina Corned Beef
  260g** and showed ₱35.00; the true price is ₱50.00. Under `PHASE_1_PLAN.md` §4, any wrong lock fails.
- **Diagnosis** (lock log with each lock's 5 voting frames, a ~2-minute reproduction, votes
  attributed to cans by protocol timing):
  - The two cans rank as each other at similarities 0.63–0.76.
  - **Accept-grade votes for the wrong can do occur** (margins 0.09 and 0.12, above δ = 0.075),
    but **at most one per stability window** was seen. The failure needed three.
  - The wrong lock itself did not reproduce: 7 LOCK, all correct.
- **Sharpness does not explain it.** Laplacian variance on wrong-can votes ranged 1.7–12.6 (×1000),
  against a frame median of 8.6. Measuring it cost **20.9 ms per frame**.

**Decision** (operator's call):

1. **`STABILITY_QUORUM` goes from 3 to 4**, in the same 5-frame window. τ and δ are unchanged.
2. **The sharpness measurement leaves the worklet.** `laplacianVariance` and its tests stay in
   `src/domain` for `TR-27`'s Phase 3 calibration.
3. **The Phase 1 gate is re-run in full** (run 3). This change counts only if that run passes.

**Rejected.**

- *Raise δ to ~0.13 in `app_meta`.* It would have blocked every wrong accept vote seen, but it is
  tuned on one pair in one short run. It also pushes correct locks to chips, where correct accepts
  are already 74.7% against `NFR-01`'s 90%. τ/δ are retuned in Phase 3 on labeled data (`TR-35`).
- *A sharpness gate now (`TR-27`).* It did not separate wrong votes, and cost 20.9 ms per frame.
- *4-of-5 plus re-enrolling both cans.* Two changes at once, so a pass could not be credited to
  either.
- *Repeat the reproduction first, with screenshots.* More certain attribution, at the cost of one
  more cycle before the gate.

**Consequences.**

- **A wrong lock now needs 4 of 5 frames to agree on the wrong product.** Lone or paired
  accept-grade confusions cannot lock. **The confusion itself remains:** chips can still pair
  Alaska with Argentina, and a sustained run of 4 wrong votes would still lock.
- **Locks take longer and drop sooner.** Nominal time-to-lock rises from ~750 ms to ~1 s at 4 fps,
  with less headroom against `NFR-04`'s p90 of 1.2 s. Two disagreeing frames now release a lock, so
  expect more "point the box" moments. Neither is measured yet.
- **Phase 3:** Alaska Evaporada 360ml / Argentina Corned Beef 260g joins the look-alike cases for
  the τ/δ retune and the model bake-off (Q-3).

---

## ADR-017 — Small-catalog safety as built: confirm until calibrated, negatives with no name

**Status:** Accepted · Revisit at Phase 3 · 2026-09-14 · Refines ADR-013 · Amends `TR-38`, `TR-39`

**Context.** ADR-013 adopted confirm mode below `app_meta.confirm_below`, plus store-local
negatives. It left two things open, and Phase 2 builds both (`PHASE_2_PLAN.md` D-1, E-1, E-5):

- **What the app does before `confirm_below` has a value.** No value is known to be safe. In the
  simulation on Phase 0 data, 25 products still leave **2.9%** of un-enrolled frames accepted, above
  `NFR-02`'s 2%, and nothing above 25 was simulated.
- **How a negative is stored.** As a hidden `products` row, it would have to be filtered out of
  every query that names a product: `getProduct`, `listProducts`, `catalogCounts` and the `SR-23`
  duplicate warning. One missed filter names a negative.

**Decision.**

1. **No `confirm_below` row means confirm every ACCEPT** (operator's call, D-1). A malformed row is
   refused, as a malformed τ is. The cutoff logic is built and unit-tested with numbers, and Phase 3
   writes the row.
2. **Negatives live in their own table, `negative_shots`, which has no name or price column**
   (E-1, adopted at plan approval). Each row keeps its JPEG and `model_id` (`TR-23`, `TR-24`). Its
   vector is the JPEG's, as at enrollment.
3. **Negatives and ambiguity are resolved per frame, after `match()` and before stability. Confirm
   or quote is decided after the lock** (E-5). `match.ts` does not change, so the Phase 0 golden
   replay stays a valid regression test (ADR-012).

**Rejected.**

- *Seed a provisional cutoff of 15 or 25.* Simulated false accepts: 9.7% and 2.9%.
- *Negatives as `products` rows with a kind column*, which was `TR-39` as first written. Safe only
  while every naming query remembers the filter.
- *Negatives as `product_shots` rows with no product.* SQLite cannot drop `product_id`'s `NOT NULL`
  without rebuilding the table.

**Consequences.**

- **Every ACCEPT costs a tap until Phase 3.** Acceptable before ship, not at ship.
- **Three places must read `negative_shots`:** the index loader, the launch orphan sweep, and the
  gate check. **If the sweep misses it, every negative's JPEG is deleted at the next launch.** Each
  gets a test.
- **A negative that captures a real product silences that product.** The guards are a capture check
  (the next frame must still show the rejected lock) and a negatives list with delete
  (`PHASE_2_PLAN.md` P2-3, P2-7).

---

## ADR-018 — Ambiguous products are recognised only to open the quick-pick grid

**Status:** Accepted · 2026-09-14 · Amends `SR-10`

**Context.** Repacked clear-bag goods look identical (`L-01`). `SR-10` said `is_ambiguous`
products "bypass recognition", and `PHASE_1_PLAN.md` §6 left open whether they get vectors at all.

**Decision** (operator's call, `PHASE_2_PLAN.md` D-2):

1. **Ambiguous products keep their 3–5 shots.** A frame whose decision involves an ambiguous
   product, whether as an ACCEPT or in a chip pair, becomes `quickPick` and opens the grid.
2. **The scanner never names or prices an ambiguous product on its own.** A price appears only when
   a tile is tapped.
3. **The grid is also a pinned button** on the Scan tab whenever an ambiguous product exists.

**Rejected.** *No vectors, grid button only.* A clear bag in the reticle would then have only other
products to match, so it could lock as one of them and show a wrong price (`NFR-02`).

**Consequences.**

- `SR-10`'s "bypass recognition" now reads "bypass naming".
- **The flag has to be right.** A product wrongly flagged costs the helper a tap. A clear-bag product
  left unflagged can lock as its twin. The `SR-23` duplicate warning suggests flagging when a new
  product clears τ against an existing one.

---

## ADR-019 — Corrections teach up to three extra shots, in two taps

**Status:** Accepted · Revisit at Phase 3 · 2026-09-14 · Amends `SR-07`, `TR-42` · Amended by ADR-022 (chip pairs)

**Context.** `SR-07` asks that a wrong match be corrected by reassigning the frame to the right
product. `TR-42` capped a product at 5 shots, and enrollment normally uses all 5, so a correction
had nowhere to go. In Phase 1 a chip tap shows a price and teaches nothing.

**Decision** (operator's calls, `PHASE_2_PLAN.md` D-3 and D-4):

1. **A correction saves a `correction` shot on the chosen product.** The shot comes from the next
   frame, which must still show the rejected lock.
   - **At most 3 per product.** The oldest correction is replaced: its row is removed in the same
     transaction, and its JPEG is deleted after COMMIT.
   - **Enrollment shots are never replaced.** A product can hold 8 shots.
2. **Correcting takes two taps:** *Wrong?*, then the right product.
3. **A chip tap still teaches nothing.**

**Rejected.**

- *Log the correction, learn nothing.* The same wrong lock recurs.
- *Replace the product's weakest enrollment shot.* It deletes an enrollment JPEG, and "weakest" is
  a guess.
- *Literal one tap.* It needs a second product's name on every confident card, which the helper
  reads at arm's length.

**Consequences.**

- **`KNN_LIMIT` = 10 stays exact while a product has ≤ 9 shots.** The best shot of the second-best
  product ranks at most shots(top-1) + 1. A domain test proves it. A cap above 9 must raise the
  limit with it.
- **Storage.** 8 shots take **193.6 KB** at the higher session median (24.2 KB per shot) and
  **272.8 KB** at the largest measured shot (34.1 KB), on the Infinix X6823. `NFR-08` is worded for
  5 reference photos, so it is not formally broken, but the worst case exceeds its intent.
- **Calibration.** More shots raise a corrected product's best-shot score. Phase 0 calibrated τ/δ
  at 6 shots per product, so the Phase 3 retune must include corrected products.
- **Corrections are not a fix for true look-alikes.** Alaska 360ml and Argentina 260g already score
  each other 0.63–0.76 (ADR-016).

---

## ADR-020 — Reanimated and zustand stay out until a measured need

**Status:** Accepted · Revisit on measured overlay jank or state sprawl · 2026-09-14 · Defers
`TR-15`, `TR-18`

**Context.**

- **The specs.** `TR-18` specified Reanimated shared values for the overlay, and `TR-15` specified
  zustand for UI state. Phase 1 deferred both to Phase 2.
- **What exists now.** Since P1-6 the overlay re-renders only when the locked decision changes,
  never per frame. App-wide state is one React context, `AppServicesContext`.

**Decision** (`PHASE_2_PLAN.md` E-3, adopted at plan approval): add neither in Phase 2.

**Rejected.** *Adding them as specced.*

- **Reanimated** has no hot path to take over. Reanimated 4 also ties itself to a
  `react-native-worklets` version, and that library carries the camera frame processor, pinned at
  0.10.1 for VisionCamera (ADR-015).
- **zustand** would replace a context that works. SQLite stays the source of truth either way.

**Consequences.**

- `TR-15` and `TR-18` are marked deferred, not dropped.
- Card animation, if wanted, uses React Native's built-in `Animated` with the native driver. That
  adds no dependency.

---

## ADR-021 — A `price_history` row holds the prices it replaced

**Status:** Accepted · 2026-09-14 · Refines `SR-06`, `SR-31`

**Context.** Schema v1 created `price_history (product_id, price_piece, price_pack, changed_at)`
without saying whose prices a row holds. P2-2 had to decide when it built `updatePrice`:

- **The Phase 1 products have no history.** The 20 gate products were enrolled before any history
  was written, and enrollment writes no row.
- **The audit is the only safeguard against price edits.** Anyone holding the phone can change a
  price (`PHASE_2_PLAN.md` §8), so the history must keep every earlier price.

**Decision.** Each price edit inserts one row with the prices **in force before** `changed_at`. The
current prices live only in `products`. An edit that changes nothing writes no row. It is tested in
`src/db/repositories.test.ts`.

**Rejected.**

- ***Rows hold the new prices.*** Each product's enrollment price would be lost at its first edit
  unless enrollment also wrote a row and a data migration backfilled the 20 existing products. That
  is a migration for a record nothing reads yet.
- ***Both old and new columns.*** A schema change to store what the previous row already implies.

**Consequences.**

- **Reading the full history:** the rows oldest first, then the current prices in `products`.
- **A row is not "the price set at `changed_at`".** Code that reads it that way shows every change one
  step late.
- **Changing this meaning later needs a migration that rewrites every existing row.** Switching
  semantics without one silently mixes the two meanings in one table and corrupts the audit.

---

## ADR-022 — A chip pair can be corrected to one of its own two products

**Status:** Accepted · Revisit at Phase 3 · 2026-09-14 · Amends ADR-019

**Context.** Gate A3 (`PHASE_2_PLAN.md` §4) corrects a chip pair: Knorr Chicken/Pork or Datu Puti
Soy Sauce/Vinegar. As first built in P2-4, that could not be done on the Infinix (2026-09-14,
~19:50):

- **The Knorr pair only ever showed chips**, never a single name, so there was no quote or question
  to reject.
- **A chip tap shows a price and teaches nothing** (ADR-019, point 3).
- ***Neither* opened the sheet**, but the sheet left both chip products out of the likely list and the
  search, and the reducer refused a correction to either.

So the pairs `SR-07` most needs to teach apart were the ones it could not teach.

**Decision** (operator's call):

1. **The chip card's link is *Wrong?*, as on a quote.** Its sheet lists both chip products first,
   then the likely products, search and *Not in my list*.
2. **Picking one of the two saves a correction shot on it**, through the same capture guard: the next
   frame must still show the same chip pair.
3. **A question or a quote still refuses a correction to the product it named.** No on "Is this X?"
   followed by X contradicts the tap.
4. **A chip tap still teaches nothing.** Teaching stays a deliberate act on the sheet.

**Rejected.**

- ***Allow it only on pairs that are not size pairs.*** Safer for `L-02`, but no column marks a size
  pair, so it needs a schema change or a name heuristic.
- ***Keep chips unteachable and amend A3 to a wrong lock.*** Under the 4-of-5 quorum these variant
  pairs chip rather than lock, so A3 could not be run on demand, and a store would have no way to
  teach the pairs it confuses.

**Consequences.**

- **Risk on `L-02` size pairs.** A correction on Argentina 260g/100g adds a shot of a frame that is
  nearly identical to the other size. It can turn future chips into a lock: an `NFR-02` exposure.
  It is bounded. It is never automatic, a product holds at most 3 correction shots (ADR-019), and
  the Phase 2 gate's zero-wrong-locks rule still judges it. The Phase 3 retune must include corrected
  products.
- **The interaction log kind `neither` is renamed `wrongChip`.** Earlier logs were never persisted.
- *Not in my list* from chips is unchanged: it still saves a negative.
