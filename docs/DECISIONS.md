# Architecture Decision Records

Short records of decisions that were genuinely contested — what was chosen, what was rejected, and
why. A decision nobody would question does not need an ADR.

> **Claude: add an ADR when you make or change a choice that a future reader would otherwise
> reverse by accident.** Never delete an ADR; supersede it with a new one and mark the old one.

**Status values:** Accepted · Superseded by ADR-NNN · Revisit at Phase N

---

## ADR-001 — React Native + Expo over Flutter and native Android

**Status:** Accepted · 2026-09-12

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
over 2,500 × 1024 floats is sub-millisecond. An approximate index would add build time, tuning
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
