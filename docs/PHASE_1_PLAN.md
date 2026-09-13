# Phase 1 Plan — Proof of Concept, Real Data Path

> **Status:** Approved 2026-09-14 — decisions D-1 to D-4 settled (§3) · **Written:** 2026-09-14 ·
> **Implementation not started.**
>
> Phase 0 answered *"can the model tell products apart?"* Phase 1 answers *"does a product survive
> the trip camera → JPEG → SQLite → force-quit → relaunch → camera, and still come back as itself?"*
> It swaps the spike's JSON file and in-JS ranking for the real storage, the real domain layer and
> the real enrollment transaction. The UI stays plain; Phase 2 makes it usable.

---

## 1. Readiness verdict

**Ready — with three housekeeping items first (§2).** The four decisions in §3 were settled 2026-09-14.

| Check | Evidence | Verdict |
|---|---|---|
| Phase 0 gate measured | Top-1 94.5% (86/91) on 19 gated products, ≥ 85% target | ✅ |
| Gate reproducible, not a one-off | `/phase-gate` rebuilt it from the raw phone backup (SHA-256 `a9f9232c…`) | ✅ |
| τ / δ calibrated | τ 0.46, δ 0.075 from the score histogram (`ARCHITECTURE.md` §6) | ✅ |
| Release-build model loading solved | `TR-29` / ADR-011, verified in airplane mode | ✅ |
| Storage dependency fits the device | `@op-engineering/op-sqlite` 18.2.1 ships `libsqlite_vec.so` for **`armeabi-v7a`** (checked in the package tarball, 2026-09-14) — the Infinix is covered | ✅ (build not yet run) |
| `NFR-07` latency | Median 145.5 ms vs ≤ 60 ms — **not met** | ⚠ Carried, not blocking — see §8 |
| `NFR-01` / `NFR-03` at τ/δ | 74.7% accepts, 49.5% Unknown — **not met** | ⚠ Phase 3 by design — the Phase 1 gate does not test accuracy |

---

## 2. Before the first Phase 1 commit

1. **Merge the Phase 0 work into `main`.** `main` is 5 commits behind `docs/phase-0-toolchain-verified`
   (toolchain, release APK, TR-29 fix, undo/delete, gate record). Phase 1 should branch from a `main`
   that contains the evidence it builds on. Proposed: open a PR, merge, then branch `feat/phase-1-data-path`.
2. **Back up `spike/results/` off the laptop.** It is gitignored, so the ~46 MB of datasets there —
   the only labeled frame set this project has — exist in exactly one place. Phase 3 retuning and the
   golden replay test (§5, P1-1) both need them.
3. **Accept that the Phase 1 APK overwrites the spike on the phone.** Same package id
   (`com.jash.bantaynimama`), so it installs as an upgrade. The spike's dataset file stays in the
   document directory but nothing reads it anymore. The laptop copy is verified byte-identical, so this
   is safe — just deliberate.

---

## 3. Decisions — settled 2026-09-14

All four settled on the option below. D-2 and D-3 are recorded as ADR-012.

| # | Question | Decided | Why |
|---|---|---|---|
| **D-1** | **Exact gate wording** — what does "scan all 20" pass on? | See §4: correct product **locked or offered as a chip** for all 20, **zero wrong locks**, plus a deterministic self-match check. | Requiring 20/20 ACCEPT would fail on thresholds, not persistence — at Phase 0's τ/δ only 74.7% of correct frames auto-accept, and that is Phase 3's problem. A gate should fail only for the thing the phase is about. |
| **D-2** | Test runner for `src/domain/` | **`node --test`** (Node 24's built-in runner, runs `.ts` directly) | Zero new dependencies to audit against `TR-51`, and domain code is pure by rule, so it needs nothing React-shaped. The alternative is `jest-expo` ~57.0.5 — more familiar, a few hundred transitive packages. Needs relative imports inside `src/domain/` (no `@/` alias). |
| **D-3** | Golden replay fixture — the Phase 0 dataset as a regression test | **Local-only test that fails loudly if the file is absent**, not committed | The labeled file is 9.6 MB of JSON. Committing it bloats every clone forever; the alternative is packing vectors to binary (~2.7 MB, estimate) and committing that. Accepted consequence: a fresh clone cannot run it until the file is restored from backup (§2). |
| **D-4** | Who writes the Filipino copy | **I draft `fil.json`, you correct it** before the gate run | `SR-42` requires `en` + `fil` from the first string. Phase 1 has maybe 30 strings; a native speaker's pass matters more than my draft. |

---

## 4. The gate

Agreed 2026-09-14 (D-1). Run on the **Infinix X6823, release APK, airplane mode** (`TR-53`, `SR-40`).

1. **Enroll 20 products** through the app — 3–5 shots each (`SR-20`), name + price in centavos.
   At least two same-brand variant pairs, so the scan step can actually fail.
2. **Force-quit** (Settings → Apps → Force stop, not just swipe away) and relaunch.
3. **Persistence check** — a debug readout, shown on screen:
   - row counts of `products`, `product_shots`, `vec_shots` match what was enrolled;
   - `app_meta` reports `schema_version 1`, `model_id`, `embedding_dim 1280`, τ, δ;
   - every `photo_path` resolves to an existing file under `documentDirectory` (`TR-43`).
4. **Self-match check** — deterministic, no camera variance: re-embed every stored JPEG and query
   KNN. **Each shot's nearest neighbour must be its own vector.** This proves the stored vectors, the
   stored photos and `TR-24`'s re-embed path agree. Record the score distribution.
5. **Scan all 20.** Pass when, for every product, the app either **locks the correct product**
   (`TR-32`, `TR-36`) or **shows it as one of the two disambiguation chips** (`TR-33`).
   **Any lock on a wrong product fails the gate** (`NFR-02` — the cardinal rule does not wait for Phase 3).
6. Record ACCEPT vs chip counts anyway — informational, feeds Phase 3.

**Gate:** steps 3, 4 and 5 all pass, recorded in `PROJECT_STATUS.md` with the date and device.

---

## 5. Work breakdown

Ordered so the riskiest native unknown is hit on day one and pure code is proven before it touches a
device. Each step has a *done when*.

### P1-1 · Domain layer, test-first — no device needed

`src/domain/` — pure TS, no I/O (`CLAUDE.md`).

| File | Does | Requirements |
|---|---|---|
| `match.ts` | Aggregate KNN rows → products by **best** shot; pick top-1 / best *different* top-2; ACCEPT / DISAMBIGUATE / UNKNOWN | `TR-30`–`TR-34`, `TR-37` |
| `stability.ts` | 5-slot ring buffer, lock on 3-of-5 agreement on the same `product_id` | `TR-36`, `SR-12` |
| `money.ts` | Parse `"12.50"` → `1250` **by string, never via a float**; format `1250` → `₱12.50` at the render boundary | `TR-41`, ADR-007 |
| `vector.ts` | L2-normalize, dot | `TR-22` |

- Port `decide()` from `src/spike/vectors.ts` — it is the only spike code already the right shape.
- **Golden replay test** (D-3): run `match.ts` over `spike-dataset-20260913-233955.labeled.json` at
  τ 0.46 / δ 0.075 and assert it reproduces Phase 0 exactly — 86/91 top-1, 68/91 accepts, 3/196 false
  accepts. If the new policy disagrees with the one that passed the gate, the new one is wrong.
- Replace the placeholder `npm test` script.

*Done when:* `npm test` and `npm run typecheck` pass; golden replay matches to the frame.

### P1-2 · Storage — first device checkpoint

> **Amended 2026-09-14 (ADR-014).** The checkpoint did its job: op-sqlite's bundled sqlite-vec
> cannot load on 32-bit ARM (op-sqlite#456). Vectors are now BLOBs in `product_shots`, searched by a
> pure inline JS loop over an in-memory matrix (9.2 ms at 100 shots, 234 ms at 2,500, measured on
> the Infinix). The sqlite-vec and `vec0` bullets below are kept as the original plan.

- Add `@op-engineering/op-sqlite` with `"op-sqlite": { "sqliteVec": true }` in `package.json`
  (`TR-13`). **Never enable `libsql` / `turso`** — those are the only paths in the library that open a
  socket (`openSync`, `openRemote`); plain `open()` is local (`TR-51`, source checked 2026-09-14).
- **Checkpoint before writing anything else:** release APK on the Infinix prints
  `select vec_version()`. This is Phase 1's equivalent of Phase 0's "Model loaded!" — a native-build
  failure here is cheap on day one and expensive on day five.
- `src/db/`: migration keyed on `app_meta.schema_version` (`TR-44`), schema v1 as in
  `ARCHITECTURE.md` §5, seed `app_meta` with `model_id`, `embedding_dim`, `tau`, `delta` (`TR-35`).
- Repository functions: `insertProductWithShots` (one transaction, `TR-45`), `knn(vector, 10)`,
  `getProduct`, `listProducts`, `getMeta`.
- **Verify, don't assume:** which sqlite-vec version op-sqlite bundles, and whether `vec0` in it
  supports the text primary key + `product_id` column the schema declares. If not, the schema changes
  before any code depends on it.

*Done when:* the checkpoint prints on device; a scripted enroll-then-read round trip passes on device.

### P1-3 · ML module

`src/ml/` replaces `src/spike/embed.ts`.

- `loadModel.ts` — `expo-asset` → `file://` → `loadTensorflowModel` (`TR-29`). Port as-is.
- `frameEmbedder.ts` — the worklet: throttle to 4 fps (`TR-26`), crop reticle, resize, `runSync`,
  L2-normalize, post a **`Float32Array(1280)`** — the spike posts `number[]`, which the architecture's
  boundary rule forbids (`ARCHITECTURE.md` §2).
- `stillEmbedder.ts` — enrollment and re-embed: load JPEG → resize 224 → `runSync` **on the JS thread**
  (enrollment is exempt from `TR-25`).
- One shared `RETICLE_FRACTION` (0.55) for both paths. Enroll and scan must crop identically, or
  every score shifts.
- **Latency diagnostic** (§8): time crop+resize and `runSync` separately, then try `['android-gpu']`.
  Record both in `ARCHITECTURE.md` §8. No redesign in Phase 1.

*Done when:* live frames produce 1280-d unit vectors on device; split timings recorded.

### P1-4 · Photo store

- Reticle crop → 512 px → JPEG q80 → `documentDirectory/photos/<shot_id>.jpg`; store the **relative**
  path (`TR-42`, `TR-43`, `TR-17`) via nitro-image `saveToFileAsync(path, 'jpg', 80)`.
- **Measure the enrollment domain gap.** Phase 0 enrolled from *live frames*; the spec enrolls from a
  *saved JPEG* (re-encoded, resized twice). Log `dot(frameVector, jpegVector)` for every shot captured.
  If it is materially below 1, Phase 0's τ/δ were calibrated on a different input than production
  uses — raise it before the gate, not after.
- Record bytes per shot against `NFR-08` (≤ 200 KB per 5-shot product).

*Done when:* photos survive a force-quit; gap and size measured and recorded.

### P1-5 · Enrollment, minimal

- Form: name, per-piece price, optional per-pack price, unit label, category (`SR-21`); 3–5 shots
  (`SR-20`).
- Duplicate check: KNN each new shot against the catalog; warn if a product clears τ (`SR-23`).
- **Write order matters.** JPEGs are written first, then **one** SQL transaction inserts product +
  shots + vectors (`TR-45`); if the transaction throws, delete the JPEGs. An orphan photo wastes
  storage; an orphan vector produces confident matches against nothing — so files go first, rows last.
- Live on the next frame (`SR-24`) — free, because the scanner queries SQLite per frame.

*Done when:* enroll → immediately scan → locks, on device.

### P1-6 · Scanner, minimal

Worklet vector → JS → `knn` (`TR-30`) → `match` → `stability` → `getProduct` → overlay.

- Locked: name + price (`SR-02`) + confidence (`SR-03`). Unknown: "Unknown Item" + Add (`SR-04`).
  Near tie: two chips (`SR-09`).
- Plain RN views. React state changes **only when the locked result changes**, so React never
  re-renders at frame rate — which is why Reanimated (`TR-18`) can wait for Phase 2.
- Time KNN and policy+stability per frame → fills the two `pending Phase 1` rows of `ARCHITECTURE.md` §8.

### P1-7 · App shell and cleanup

- `expo-router` ~57.0.21 with two tabs: **Scan** and **Products** (a plain list read from SQLite —
  it is how you check the catalog, not `SR-30`'s search) (`TR-14`).
- i18n: `i18next` + `react-i18next` + `expo-localization`, `en.json` + `fil.json`, every string through
  it (`TR-16`, `SR-42`, D-4). Audit each against `TR-51` before install.
- Debug readout for the gate (§4 step 3–4), behind a dev toggle.
- **Delete `App.tsx` and `src/spike/`** once P1-1's golden test and P1-3 cover what they held.
  `scripts/analyze.mjs` and `relabel.mjs` stay — both checked: they import only `node:fs`/`node:path`,
  nothing from `src/spike/`.

### P1-8 · Gate run

§4, on device, in airplane mode. Then `/phase-gate`.

---

## 6. Explicitly not in Phase 1

Deferred, not dropped. The schema carries the columns so no migration is needed later.

| Deferred | To | Why wait |
|---|---|---|
| Edit price / correct match / delete from overlay (`SR-06`–`SR-08`) | Phase 2 | UX, not data path |
| Quick-pick grid for `is_ambiguous` (`SR-10`) | Phase 2 | Column exists in v1; open question whether ambiguous products get vectors at all |
| Torch, capture quality warnings, ≤ 30 s enrollment (`SR-11`, `SR-22`, `SR-25`) | Phase 2 | |
| Directory search, edit, soft-delete + trash, teach again, sort, storage (`SR-30`–`SR-35`) | Phase 2 | See the note under §7 |
| Permission recovery screen, first-run flow (`SR-43`, `SR-44`) | Phase 2 | |
| Reanimated overlay (`TR-18`), `zustand` (`TR-15`) | Phase 2 | Not needed yet; one less thing to audit |
| Sharpness gate (`TR-27`) | Phase 3 | Floor is an uncalibrated placeholder (`SHARPNESS_FLOOR = 0`) |
| τ/δ retune, `NFR-01`–`NFR-03`, MobileCLIP (Q-3), INT8 (Q-4) | Phase 3 | |
| Export/import (`SR-45`) | Phase 4 | |

---

## 7. Design questions P1-2 must settle (not decisions for you — engineering)

- **KNN starvation.** *Resolved by ADR-014: with search in JS, soft-deleted shots and other
  `model_id`s are simply left out of the in-memory matrix.* Original note: `TR-30` takes `LIMIT 10` from `vec_shots`, then joins products. Once soft delete
  (`SR-32`) or a second `model_id` exists, stale vectors can fill those 10 slots and hide live
  products. Phase 1 has neither, but schema v1 should not paint Phase 2 into a corner — either filter
  inside the `vec0` query (metadata column, if the bundled version supports it) or delete vectors on
  soft delete and re-embed from JPEGs on restore (`TR-24` makes that possible).
- **Negative shots (ADR-013, `TR-39`).** Phase 2 will store frames the tindera marks "Not in my
  list" in `vec_shots`, as shots that must never be named. Phase 1 builds none, but schema v1
  should leave a way to tell a negative apart without re-embedding. For example, a `kind`
  column on `products`, which the KNN already joins. A forward-only migration (`TR-44`) could also
  add it later; decide which.
- **Shot count vs calibration.** Phase 0 calibrated τ/δ on **6** shots per product; `TR-42` caps at
  **5**. Best-of-5 scores are slightly lower than best-of-6 — expect it, note it, retune in Phase 3.

---

## 8. Risks carried into Phase 1

| Risk | Status | Phase 1 action |
|---|---|---|
| **`NFR-07` latency, 145.5 ms median** | Not met. At 4 fps (250 ms interval) it fits, with no headroom; the worst frame (339.5 ms) overruns. | Split stages and try the GPU delegate (P1-3). Record. Do not redesign — the numbers decide that. |
| 32-bit test phone | The only device; `armeabi-v7a` gives up TFLite's arm64 kernels | Note every number as 32-bit. A 64-bit budget phone is the more representative target and remains unmeasured. |
| **Enrollment domain gap** (frame vs JPEG) | New — Phase 0 never exercised the JPEG path | Measure in P1-4 before the gate. |
| op-sqlite native build | Untested in this project | Day-one checkpoint (P1-2). |
| Release-only failures | Already bit once (ADR-011) | Every checkpoint runs on the **release** APK. |
| Un-enrolled items land in disambiguate (`NFR-03` 49.5%) | Known | Nothing — Phase 3. The gate's zero-wrong-lock rule still applies. |
| **Small catalogs accept un-enrolled items** (ADR-013) | New — simulated **15.1%** of un-enrolled frames at 5 products | Nothing in the policy. The gate enrolls 20 and scans only enrolled items, so it cannot surface this. Leave room for negative shots in schema v1 (§7). |

---

## 9. Measurements Phase 1 records

| What | Where it goes |
|---|---|
| Crop+resize vs `runSync` split, CPU vs GPU delegate | `ARCHITECTURE.md` §8 |
| KNN latency (JS brute force, ADR-014); policy + stability latency | `ARCHITECTURE.md` §8 (`pending Phase 1` rows) |
| Frame-vs-JPEG embedding agreement | `ARCHITECTURE.md` §4, `PROJECT_STATUS.md` |
| Bytes per shot / per product (`NFR-08`) | `PROJECT_STATUS.md` measured table |
| Gate result: counts, self-match scores, ACCEPT vs chip split | `PROJECT_STATUS.md`, `CHANGELOG.md` |

All on the Infinix X6823, release APK, named in every row.

---

## 10. Docs updated on approval

- [x] `PROJECT_STATUS.md` — Phase 1 checklist, next action, and §4's gate wording *(2026-09-14)*
- [x] `CLAUDE.md` — this plan added to the *Read first* table *(2026-09-14)*
- [x] `PROJECT_SPECS.md` — header moved to Phase 1 *(2026-09-14)*
- [x] `DECISIONS.md` — ADR-012 for D-2 / D-3 *(2026-09-14)*
- [ ] `ARCHITECTURE.md` §7 — remove `src/spike/` and `App.tsx` from the layout **when P1-7 deletes them**, not before
