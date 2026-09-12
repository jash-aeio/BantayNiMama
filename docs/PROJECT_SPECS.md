# BantayNiMama — Project Specification

> **Status:** Approved · **Version:** 1.0 · **Last updated:** 2026-09-12
> **Owner:** Jasper · **Phase:** 0 (Embedding Viability Spike)

Offline-first, AI-assisted visual product scanner for Philippine sari-sari stores.
Point the camera at a product; see its name and price. Teach it new products in seconds.

---

## 1. Problem Statement

A new store helper (*katulong*) is expected to quote prices for several hundred SKUs within days
of starting. A large share of sari-sari inventory — repacked sugar and rice, pandesal, *tingi*
shampoo sachets, single-stick candy — **carries no barcode at all**.

Existing POS apps assume a barcode and assume a connected backend. Both assumptions fail at a
neighbourhood counter in the Philippines.

**BantayNiMama replaces the barcode with the product's own appearance, and replaces the backend
with the phone.**

## 2. Product Thesis

Few-shot visual recognition via image embeddings + local vector search, with **no model retraining**.
The vendor captures a few photos of a product; the embedding is written to an on-device vector
database; the product is recognizable on the very next camera frame.

**This thesis is unproven and is the project's single largest risk.** Phase 0 exists to test it
before any production code is written. See [`PROJECT_STATUS.md`](./PROJECT_STATUS.md).

---

## 3. Users

| Role | Description | Design priority |
|---|---|---|
| **Tindera / Owner** | Owns the catalog, sets prices, enrolls products. Phone-literate, price-sensitive, budget-to-mid Android. | Enrollment & Directory |
| **Helper / Katulong** | Often a teenager or relative, possibly in their first week. Needs speed and zero ambiguity while a customer waits. | **The Scanner is designed for this person.** |

---

## 4. System Requirements

Requirement IDs are stable. Reference them in commits, PRs and test names.

### 4.1 Scanner (Tab 1)

| ID | Requirement | Priority |
|---|---|---|
| **SR-01** | Live camera preview with a fixed center reticle indicating the recognition region. | MUST |
| **SR-02** | On a confident match, overlay the product **name and price** in large, high-contrast type. | MUST |
| **SR-03** | Display a confidence indicator alongside every match. | MUST |
| **SR-04** | On no confident match, display **"Unknown Item"** with a prominent **Add** action. | MUST |
| **SR-05** | The Add form must be reachable in one tap and must not block the camera preview. | MUST |
| **SR-06** | Allow editing the price directly from the scan overlay. | MUST |
| **SR-07** | Allow correcting a wrong match in one tap (reassign the frame to the correct product). | MUST |
| **SR-08** | Allow deleting the matched product from the scan overlay. | SHOULD |
| **SR-09** | When top-1 and top-2 are within δ, present a **two-choice disambiguation chip** rather than guessing. | MUST |
| **SR-10** | Products flagged `is_ambiguous` bypass recognition and surface a pinned **quick-pick grid**. | MUST |
| **SR-11** | Torch toggle for dim store interiors. | SHOULD |
| **SR-12** | Recognition result must not flicker — a result locks only after temporal agreement. | MUST |

### 4.2 Enrollment

| ID | Requirement | Priority |
|---|---|---|
| **SR-20** | Guided capture of **3–5 reference photos** at different angles and lighting. | MUST |
| **SR-21** | Capture form collects: name, per-piece price, optional per-pack price, unit label, category. | MUST |
| **SR-22** | Warn the user when a captured frame is blown out, too dark, or out of focus. | SHOULD |
| **SR-23** | Before saving, check the new embedding against the catalog and warn on a likely duplicate. | MUST |
| **SR-24** | The product must be recognizable on the next camera frame — no restart, no rebuild. | MUST |
| **SR-25** | Complete enrollment of one product in **≤ 30 seconds**. | MUST |

### 4.3 Directory (Tab 2)

| ID | Requirement | Priority |
|---|---|---|
| **SR-30** | Searchable list of all products with thumbnail, name and price. | MUST |
| **SR-31** | Edit any field of any product, including both prices. | MUST |
| **SR-32** | Soft-delete with a 10-second undo, plus a 30-day trash. | MUST |
| **SR-33** | Add reference photos to an existing product — *"Turuan mo ulit"* / Teach again. | MUST |
| **SR-34** | Sort by name, recently added, and recently scanned. | SHOULD |
| **SR-35** | Show storage consumed by reference photos. | SHOULD |

### 4.4 System-wide

| ID | Requirement | Priority |
|---|---|---|
| **SR-40** | The app **must function fully in airplane mode, permanently**. | MUST |
| **SR-41** | **No network request may ever leave the device.** No telemetry, no analytics, no crash reporting upload. | MUST |
| **SR-42** | UI language switchable between **English** and **Filipino** without restart. | MUST |
| **SR-43** | Camera permission denial leads to a recovery screen with a route to system settings. | MUST |
| **SR-44** | First run with an empty catalog presents a guided "add your first five items" flow. | MUST |
| **SR-45** | Export and import the full catalog as a single portable archive. | SHOULD *(Phase 4)* |

---

## 5. Non-Functional Requirements

| ID | Requirement | Target |
|---|---|---|
| **NFR-01** | Top-1 recognition accuracy, enrolled items, normal store lighting | ≥ 90% |
| **NFR-02** | **False-positive rate** — confidently names the wrong product | **≤ 2%** |
| **NFR-03** | Unknown rejection — correctly returns "Unknown" for un-enrolled items | ≥ 85% |
| **NFR-04** | Camera pointed → result locked, p90 | ≤ 1.2 s |
| **NFR-05** | Cold start → usable camera | ≤ 2.0 s |
| **NFR-06** | Battery drain, scanner open continuously, budget Android | ≤ 12% / hour |
| **NFR-07** | Per-processed-frame budget, budget Android | ≤ 60 ms |
| **NFR-08** | Storage per product (5 reference photos) | ≤ 200 KB |
| **NFR-09** | Catalog capacity without perceptible slowdown | ≥ 500 products |

> ### ⚠ The cardinal rule
> **NFR-02 outranks NFR-01.** A wrong price quoted confidently costs the store money and trust.
> Every threshold is tuned toward **precision, not recall**. The system must always prefer
> "Unknown" over a guess.

---

## 6. Out of Scope (MVP)

Deferred to Phase 5+, deliberately and with no partial implementation in the meantime:

Basket / running total · change computation · stock levels · *utang* (credit) ledger ·
barcode scanning · multi-device sync · cloud backup · sales reporting · multi-store ·
object proposal replacing the fixed reticle.

---

## 7. Technical Requirements

### 7.1 Platform

| ID | Requirement |
|---|---|
| **TR-01** | React Native via **Expo SDK 57** (RN 0.86.3, React 19.2.3, New Architecture only). *Amended from SDK 55 / RN 0.83 — see ADR-009.* |
| **TR-02** | **Android and iOS.** Android is the primary target; design to budget Android constraints. |
| **TR-03** | **`expo-dev-client` is required.** Expo Go cannot load the native modules this app depends on. |
| **TR-04** | Minimum Android 10 (API 29); minimum iOS 16. |
| **TR-05** | TypeScript, `strict: true`. |

### 7.2 Core dependencies

| ID | Package | Role |
|---|---|---|
| **TR-10** | `react-native-vision-camera` v5 + `react-native-vision-camera-worklets` | Camera + frame processors. The only RN camera with real frame processors; v5 is Nitro/worklets-based so a TFLite model is callable directly inside the worklet. v5 uses an outputs-based API (`usePreviewOutput`, `useFrameOutput`) and ships **no config plugin** — camera permissions are declared directly in `app.json`. |
| **TR-11** | `react-native-nitro-image` | Native in-worklet crop, resize and raw-pixel access, via `HybridFrameConverter.convertFrameToImage()`. *Amended from `vision-camera-resize-plugin`, which targets VisionCamera v4 — see ADR-010.* Float32 conversion and channel-order mapping are done in application code. |
| **TR-12** | `react-native-fast-tflite` | TFLite runtime. Runs synchronously inside worklets; GPU delegate on Android, CoreML on iOS. |
| **TR-13** | `@op-engineering/op-sqlite` with **sqlite-vec** enabled | Metadata + vector storage in one SQLite file. |
| **TR-14** | `expo-router` | File-based tab navigation. |
| **TR-15** | `zustand` | UI/session state only. SQLite remains the source of truth. |
| **TR-16** | `i18next`, `react-i18next`, `expo-localization` | `en` + `fil` from the first commit. |
| **TR-17** | `expo-file-system` | Reference photo storage in the document directory. |
| **TR-18** | `react-native-reanimated` | Overlay rendering via shared values, off the React render path. |

### 7.3 Machine learning

| ID | Requirement |
|---|---|
| **TR-20** | Embedding model: **MediaPipe Image Embedder, MobileNetV3-Large**, `.tflite`, **1280-d output** — measured on device 2026-09-13; the 1024-d figure this requirement previously carried was an unverified assumption. |
| **TR-21** | Model input: 224×224 RGB, Float32, normalized to **`[0.0, 1.0]` per channel** (i.e. byte ÷ 255). Confirmed from the model file's own tensor description, not assumed — a `[-1, 1]` assumption degrades every score without throwing. |
| **TR-22** | All embeddings **L2-normalized at write time** so cosine similarity is a plain dot product. |
| **TR-23** | Every stored vector is stamped with the `model_id` that produced it. |
| **TR-24** | Model swap requires regenerating all vectors from stored reference JPEGs. **Never discard the JPEGs.** |
| **TR-25** | Inference runs **inside the VisionCamera frame worklet**, never on the JS thread. |
| **TR-26** | Frame rate throttled to **4 fps** via `runAtTargetFps`, dropping adaptively under thermal load. |
| **TR-27** | Frames below a Laplacian-variance sharpness floor are discarded before inference. |
| **TR-28** | INT8 quantization evaluated in Phase 3, adopted only if the accuracy cost is measured and acceptable. |
| **TR-29** | The `.tflite` model is loaded by resolving the bundled asset to a **`file://` path** (`expo-asset`) before it reaches the TFLite loader. A bare `require()` works only under Metro — in a release build React Native packages the asset as an Android resource and `Image.resolveAssetSource()` returns a name with no URL scheme, which `react-native-fast-tflite` cannot open. See ADR-011. |

### 7.4 Matching policy

| ID | Requirement |
|---|---|
| **TR-30** | KNN over `vec_shots` with `LIMIT 10`. |
| **TR-31** | Aggregate shots to products; a product's score is its **best** shot similarity. |
| **TR-32** | **ACCEPT** when `top1 ≥ τ` **and** `(top1 − top2) ≥ δ`, top2 being the best *different* product. |
| **TR-33** | **DISAMBIGUATE** when `top1 ≥ τ` but the margin is `< δ`. |
| **TR-34** | **REJECT → "Unknown Item"** otherwise. |
| **TR-35** | τ and δ are stored in `app_meta` as configuration, calibrated empirically. **Never hard-coded.** |
| **TR-36** | Temporal stability gate: lock a result only when **3 of the last 5** frame decisions agree. |
| **TR-37** | The matching policy must be a **pure function** over `(candidates, τ, δ, buffer)` so it is unit-testable without a camera. |

### 7.5 Data

| ID | Requirement |
|---|---|
| **TR-40** | Single SQLite database file holding both product metadata and the `vec0` virtual table. |
| **TR-41** | **Money stored as integer centavos.** Floats are forbidden for currency anywhere in the codebase. |
| **TR-42** | Reference photos: 512 px longest edge, JPEG q80, max 5 per product. |
| **TR-43** | Photo paths stored **relative** to the document directory, never absolute. |
| **TR-44** | Schema migrations keyed on `app_meta.schema_version`, forward-only. |
| **TR-45** | Enrollment writes product + shots + vectors in **one transaction**. |
| **TR-46** | File layout must stay export-friendly: one DB file + one photos directory. |

### 7.6 Constraints

| ID | Constraint |
|---|---|
| **TR-50** | **No backend. No API keys. No authentication. No cloud service of any kind.** |
| **TR-51** | No dependency that performs network I/O at runtime. Audit before adding any package. |
| **TR-52** | No PII collected or stored beyond product names the vendor types themselves. |
| **TR-53** | The full test suite must pass in airplane mode. |

---

## 8. Known Limitations

These ship as documented limitations, not bugs. Do not open issues to "fix" them.

| # | Limitation | Why it cannot be solved | Mitigation |
|---|---|---|---|
| **L-01** | **Repacked goods in clear bags** — sugar, salt and rice are visually identical. | No embedding model can distinguish identical images. | Explicit `is_ambiguous` class → pinned quick-pick grid (SR-10). |
| **L-02** | **Same product, different size** — 250 ml vs 1 L Coke. | Embeddings are largely scale-invariant; there is no size reference in frame. | Size is part of product identity at enrollment; collisions fall through to disambiguation (SR-09). |
| **L-03** | **Device loss = catalog loss.** | Accepted cost of the local-only decision (TR-50). | Export/import shipped in Phase 4 (SR-45); file layout kept export-friendly from day one (TR-46). |
| **L-04** | Deformable packaging (pandesal, banana cue) recognizes less reliably. | Shape varies per unit. | Multi-angle enrollment; set expectations in UI copy. |

---

## 9. Glossary

| Term | Meaning |
|---|---|
| **Sari-sari store** | A small neighbourhood convenience store, typically operated from the front of a home. |
| **Tindera** | The store owner/seller. |
| **Katulong** | Helper or assistant; the primary scanner user. |
| **Tingi** | Sold per piece / in small retail quantities. The per-piece price. |
| **Buo** | Sold whole / by the pack. The per-pack price. |
| **Utang** | Store credit extended to a regular customer. Out of MVP scope. |
| **Pandesal** | Filipino bread roll, typically sold loose in bags. |
| **Reticle** | The fixed center region of the camera frame that is actually embedded. |
| **Shot** | One enrolled reference photo. A product owns 3–5 shots, each with its own vector. |
| **τ (tau)** | Minimum similarity for a match to be considered at all. |
| **δ (delta)** | Minimum margin between top-1 and top-2 for a match to be accepted without disambiguation. |

---

## 10. Related Documents

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — system design, data flow, schema
- [`PHASE_0_RUNBOOK.md`](./PHASE_0_RUNBOOK.md) — how to run the Phase 0 spike and what it needs from you
- [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) — current phase, gates, what's next
- [`CHANGELOG.md`](./CHANGELOG.md) — what shipped, when
- [`DECISIONS.md`](./DECISIONS.md) — architecture decision records
- [`TOOLING.md`](./TOOLING.md) — Claude Code setup, commands, recommended MCP servers
