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

**Status:** Accepted · 2026-09-12

**Context.** The app needs KNN over a few thousand embeddings, entirely offline.

**Decision.** `op-sqlite` with the sqlite-vec extension. Metadata and vectors live in one SQLite file.

**Rejected.** *ObjectBox* and *libSQL* vector search are both credible, but keep data in a
proprietary or less inspectable store. Plain SQLite is debuggable with any tool and trivially
exportable — which directly serves `L-03` / `SR-45`.

**Consequence.** One file plus one photos directory is the entire application state. Backup in
Phase 4 is a zip, not a migration.

---

## ADR-004 — No ANN index; brute-force KNN

**Status:** Accepted · Revisit above ~50,000 vectors · 2026-09-12

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
