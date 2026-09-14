# Project Status

> **Claude: update this file at the end of any session that changes what is built, blocked, or
> decided.** Keep it short — it is a dashboard, not a journal. The journal is `CHANGELOG.md`.

**Last updated:** 2026-09-14
**Current phase:** Phase 1 — Proof of concept, real data path *(Phase 0 gate passed and verified 2026-09-13)*
**Overall health:** 🟢 Core thesis holds at the Phase 0 gate — latency (`NFR-07`) and un-enrolled handling are open

---

## Right now

| | |
|---|---|
| **Working on** | **Phase 1 — real data path**, branch `feat/phase-1-data-path` ([`PHASE_1_PLAN.md`](PHASE_1_PLAN.md)). **P1-1 to P1-4 done** on the Infinix, release APK. **P1-5 enrollment: code done, device check pending.** It has the form, 3–5 JPEG shots, a duplicate warning at τ, one transaction, and the index extended after COMMIT. i18next was pulled forward from P1-7. Domain tests **107**, typecheck clean. |
| **Next action** | P1-5 on the Infinix, release APK: enroll 2–3 real products (one same-brand pair) → switch to scan → each locks. Also check: the duplicate warning fires on the sibling; the counts survive a force-stop; `orphan photos removed` shows 10 on first launch (the P1-4 photos) and 0 after. Record frame-vs-JPEG agreement on real products. |
| **Blocked on** | Nothing. |
| **Owed — native search** | sqlite-vec cannot load on 32-bit ARM ([op-sqlite#456](https://github.com/OP-Engineering/op-sqlite/issues/456)). JS search measured **9.2 ms at 100 shots but 234 ms at 2,500** on the Infinix, so `NFR-09` (500 products) needs native search before Phase 4. Tracked for Phase 3 (ADR-014). |
| **Watch out for** | **Per-frame latency is over budget** (`NFR-07` ≤ 60 ms). Split on the Infinix (P1-3): `runSync` 62.8 ms on CPU, 43.2 ms with the GPU delegate; crop + resize ~37 ms either way. Totals: 100.7 ms CPU, 81.2 ms GPU. The GPU helps but is not enough, and crop + resize is the next lever. See `ARCHITECTURE.md` §8. |
| **Known soft spot** | **Un-enrolled products.** At τ/δ, 50 of 105 un-enrolled frames land in *disambiguate* (two wrong chips), so only 49.5% return Unknown (`NFR-03` ≥ 85%, not met). `analyze.mjs`'s 97.1% counts "not auto-accepted". All 3 false accepts are Zonrox bottles → Datu Puti vinegar. |
| **New risk — small catalogs** | δ rejects un-enrolled items only when an enrolled product is close. Simulated on Phase 0 data, **15.1%** of un-enrolled frames are auto-accepted at 5 products (SR-44's first five), and 9.7% still at 15. Plan (ADR-013): confirm mode + store-local negatives (`SR-13`, `SR-14`), built in Phase 2. **No Phase 1 change** — the gate scans only enrolled items. |
| **Biggest risk** | Correct accepts are **74.7%** at τ/δ vs `NFR-01` ≥ 90%. Ranking is strong (top-3 100%) but margins are thin, so many correct matches fall to disambiguate. A Phase 3 problem — the Phase 0 gate measures ranking only. |

---

## Phase progress

| Phase | Name | Status | Gate |
|---|---|---|---|
| **0** | Embedding viability spike | 🟢 Passed gate — 94.5% (2026-09-13) | ≥ 85% top-1 on non-ambiguous items |
| **1** | Proof of concept — real data path | 🔵 In progress | Enroll 20 → force-quit → relaunch → persistence + self-match checks → scan all 20: correct lock **or** chip for every product, **zero wrong locks** (`PHASE_1_PLAN.md` §4) |
| 2 | UI / UX | ⚪ Not started | — |
| 3 | ML integration & accuracy | ⚪ Not started | NFR-01 ≥ 90%, NFR-02 ≤ 2% |
| 4 | Polish & ship | ⚪ Not started | All NFRs met on a real device |
| 5 | Post-MVP | ⚪ Deferred | — |

Legend: ⚪ not started · 🔵 in progress · 🟢 passed gate · 🔴 gate failed

---

## Phase 1 checklist

Detail and "done when" for each step: [`PHASE_1_PLAN.md`](PHASE_1_PLAN.md) §5. All device steps on the
**release** APK.

- [x] Plan written and decisions D-1 to D-4 settled *(2026-09-14)*
- [x] Housekeeping (§2): Phase 0 merged into `main` (PR #1, `1d21f27`); `spike/results/` copied to
      `C:\BantayNiMamaBackups`, all 6 SHA-256 checksums match *(2026-09-14)*. C: is a **different
      physical SSD** from the repo's D:, so one disk failing is covered — losing the laptop is not.
- [x] P1-1 Domain layer — `match`, `stability`, `money`, `vector` under `node --test`; golden replay
      reproduces Phase 0 (86/91 top-1, 68/91 accepts, 3/196 false accepts) (`TR-30`–`TR-37`, `TR-41`)
      *(2026-09-14, 40 tests)*
- [x] P1-2 Storage — day-one device checkpoint; schema v1 + `app_meta` seed (`TR-13`, `TR-35`, `TR-44`, ADR-014) *(2026-09-14)*
  - [x] op-sqlite ~18.2.1 added, `sqliteVec` on, network-audited (`TR-51`); `openDatabase()` + checkpoint probe written *(2026-09-14)*
  - [x] **Checkpoint on the Infinix, release APK** *(2026-09-14)* — sqlite-vec **failed** to load (op-sqlite#456). The second build passed: plain SQLite opens `bantay.db`, BLOB vectors are bit-exact, JS KNN takes 9.2 ms at 100 shots and 234 ms at 2,500 → ADR-014
  - [x] Pure inline KNN, BLOB codec, `app_meta` parsing and migration planning in `src/domain` — tests 40 → 74 *(2026-09-14)*
  - [x] Schema v1 (`product_shots.embedding` BLOB), forward-only migration, `app_meta` seed, `insertProductWithShots` (one transaction), `loadVectorIndex` *(2026-09-14)*
  - [x] **On the Infinix** *(2026-09-14)*: `bantay.db` migrated 0 → 1 with `app_meta` intact. Enroll, close, reopen and search found each shot's own vector top-1 at 1.000000, with the price back as 1250 centavos (3 shots reloaded in 0.6 ms). A failed transaction left no row.
- [x] P1-3 ML module — frame + still embedders; crop/resize vs `runSync` split timed; GPU delegate tried (`TR-25`, `TR-29`) *(2026-09-14)*
  - [x] `src/ml/` (`loadModel`, `frameEmbedder`, `stillEmbedder`, shared `model.ts`) plus `src/domain/pixels.ts` and `stats.ts`; spike embedder deleted; tests 74 → 88 *(2026-09-14)*
  - [x] **On the Infinix** *(2026-09-14)*: live frames give 1280-d vectors at length 1.00000. Per-frame total median **100.7 ms on CPU, 81.2 ms with `android-gpu`**; `runSync` 62.8 → 43.2 ms; crop+resize ~37 ms either way (n = 40 each; `ARCHITECTURE.md` §8)
  - [ ] Before adopting the GPU delegate: check its vectors agree with CPU's (τ/δ were calibrated on CPU)
  - [x] `stillEmbedder` on device *(2026-09-14, in P1-4)*: 10 saved JPEGs embedded on the JS thread, and each re-embed after a force-stop matched its saved vector at dot 1.000000
- [x] P1-4 Photo store — relative paths; frame-vs-JPEG agreement and bytes/shot measured (`TR-42`, `TR-43`, `NFR-08`) *(2026-09-14)*
  - [x] `referencePhoto.ts` (path, size cap without upscaling), `db/photos.ts` (save / list / delete), `captureReference` (one crop, two uses), second CPU model instance for JPEGs; tests 88 → 93 *(2026-09-14)*
  - [x] **On the Infinix** *(2026-09-14, 10 captures, one static scene, CPU)*: frame-vs-JPEG dot min 0.9803 / median 0.9843; JPEG 17.5 KB median per shot (~88 KB per 5-shot product, `NFR-08` ≤ 200 KB); 396 px crop of a 1280×720 frame, not upscaled
  - [x] Photos survive a force-stop *(2026-09-14)*: after `am force-stop` and relaunch, all 10 photos were on disk (175.5 KB), and each re-embedded to dot 1.000000 with its saved vector (`TR-24`)
  - [ ] Owed before the P1-8 gate: effect of JPEG-path enrollment on real decisions. Phase 0's τ/δ came from live-frame vectors; a 0.984 dot can move a score by up to 0.18 (δ = 0.075)
- [ ] P1-5 Enrollment — one transaction, photos first (`SR-20`, `SR-21`, `SR-23`, `SR-24`, `TR-45`)
  - [x] `domain/enrollment.ts` (form → centavos, duplicates ≥ τ), `features/enrollment/` (JPEG-path vectors, rollback deletes photos, index extended after COMMIT), `db/catalog.ts` (model_id check, launch orphan sweep); tests 93 → 107 *(2026-09-14)*
  - [x] i18next + react-i18next pulled forward from P1-7, network-audited (`TR-51`); enrollment copy in `en` + `fil` (fil is a draft for the operator); keys typed *(2026-09-14)*
  - [x] Release APK installed and launched on the Infinix *(2026-09-14, 4m 23s build)*: `bantay.db` schema 1 → 1, τ 0.46 / δ 0.075 read from `app_meta`, 0 products, **orphan sweep removed 10** (the P1-4 check photos), other-model shots 0; English form renders
  - [ ] **On the Infinix, release APK:** enroll → scan → locks; duplicate warning on a sibling; counts after force-stop; sweep reads 0 on relaunch
  - [ ] Frame-vs-JPEG agreement on real products (P1-4 measured one static scene only)
- [ ] P1-6 Scanner — lock / chips / Unknown; KNN and policy latency timed (`SR-02`–`SR-04`, `SR-09`, `SR-12`)
- [ ] P1-7 App shell — two tabs, `en` + `fil` (Claude drafts, operator corrects); spike code deleted (`TR-14`, `TR-16`, `SR-42`)
- [ ] P1-8 **Gate run** — 20 products, force stop, airplane mode, then `/phase-gate`

---

## Phase 0 checklist

- [x] Expo SDK 57 dev-client project created *(SDK bumped from 55 — ADR-009)*
- [x] Android build toolchain verified — JDK 17.0.20.1 (Microsoft), `ANDROID_HOME` set, `adb` on
      PATH, SDK platform `android-36` present *(2026-09-12; see `TOOLING.md` → "Verified local toolchain")*
- [x] `npx expo prebuild` generates a native `android/` project (Gradle 9.3.1) — gitignored and
      regenerable, not committed
- [x] Development build compiled and installed — 66 MB debug APK on Infinix X6823 (armeabi-v7a),
      NDK 27.1.12297006 *(2026-09-13)*
- [x] VisionCamera preview with a center reticle
- [x] `react-native-fast-tflite` loading the MobileNetV3 embedder — **confirmed on device**
      (`Model loaded!`, 2026-09-13)
- [x] Vector dimensionality confirmed from a live frame: **1280-d, not 1024** — the 1024 figure was
      an assumption and has been corrected in `ARCHITECTURE.md`, `PROJECT_SPECS.md` (TR-20) and
      `DECISIONS.md`
- [x] Release-variant APK built and installed — **phone runs untethered from Metro** *(2026-09-13)*. 142 MiB APK (all four ABIs; debug built only `armeabi-v7a`), `assets/index.android.bundle` embedded, zero dev-launcher classes, model packaged. Cold build 31m 21s; incremental rebuild 1m 11s.
- [x] Model loads **in the release build** — the first release APK failed at startup with
      `MalformedURLException` because `react-native-fast-tflite` cannot address a `require()`d asset
      outside Metro. Fixed by resolving through `expo-asset` (`TR-29`, ADR-011). Re-verified on the
      Infinix X6823, including **in airplane mode** (`TR-53`) *(2026-09-13)*.
- [x] ~20 reference products captured — **25 products × 6 shots (150 shots)**, 2026-09-13
      (first 26 × 6; oil repacks swapped for monggo, Nescafe twin swapped — see CHANGELOG).
      Capture setting: **held in hand under store lighting** (operator-reported). Test frames must
      span shelf / in hand / counter so the gate is not measured on the enrollment setting alone.
  - [x] Two Nissin ramen variants (same brand, different variant)
  - [x] Creamy white solo 20g vs true twin pack 40g — size-only, so `ambiguous:` (L-02). Runbook A-3.
  - [x] Size families (L-02): `dishwashing-liquid-green-500ml` / `-1liter`, `monggo-pack-10p` / `-20p`,
        Nescafe solo / twin — all `ambiguous:`. **19 of 25 products gated.**
  - [x] Repacked clear bags (L-01) — the `monggo-pack-*` repacks
- [x] In-JS cosine match, top-3 printed on screen with scores
- [x] ~100 labeled test frames collected — **230 recorded, 226 after `scripts/relabel.mjs`** (91 gated ·
      30 `ambiguous:` · 105 `unknown:`), 2026-09-13, release APK. Setting split **2 shelf / 2 in hand /
      1 counter per product** (operator-reported; frames do not record it, so per-setting accuracy
      cannot be computed). `happy-absorbent-cotton-10g` has only 1 frame.
- [x] Top-1 / top-3 accuracy computed — top-1 **94.5%** (86/91), top-3 **100%**
- [x] Score histogram produced; **τ = 0.46, δ = 0.075** read off it — `ARCHITECTURE.md` §6
- [x] **GATE PASSED:** ≥ 85% top-1 on non-ambiguous items → **94.5%** (86/91; 95% CI 87.8–97.6%)

### If the gate fails

Do **not** proceed to Phase 1. In order:
1. Tighten reticle guidance and re-shoot — framing is a bigger lever than model choice.
2. Try MobileCLIP via `react-native-executorch` (accepts a JS-thread architecture cost).
3. Reconsider the product thesis.

---

## Measured results

Accuracy rows stay empty until the store data exists. **Claude: record real numbers here, never estimates.**

| Metric | Target | Measured | Date |
|---|---|---|---|
| Top-1 accuracy (non-ambiguous) | ≥ 85% | **94.5%** (86/91; 95% CI 87.8–97.6%) — 19 gated products | 2026-09-13 |
| Top-1 accuracy, all enrolled incl. `ambiguous:` | — | **92.6%** (112/121); all 30 ambiguous frames land in the right size family | 2026-09-13 |
| Top-3 accuracy (non-ambiguous) | — | **100%** (91/91) | 2026-09-13 |
| τ (tau) | — | **0.46** — admits 95% of correct top-1s (p05 0.465) | 2026-09-13 |
| δ (delta) | — | **0.075** — wrong enrolled matches all had margin ≤ 0.039; set higher to hold un-enrolled FP under 2% | 2026-09-13 |
| Correct accepts at τ/δ (`NFR-01`) | ≥ 90% | **74.7%** (68/91) — not met; 19 go to disambiguate, 4 to unknown | 2026-09-13 |
| False positives at τ/δ (`NFR-02`) | ≤ 2% | **1.5%** (3/196; 95% CI 0.5–4.4%) — all three are Zonrox bottles → Datu Puti vinegar | 2026-09-13 |
| Unknown rejection (`NFR-03`) | ≥ 85% | **49.5%** (52/105) return Unknown — not met. 97.1% (102/105) are not auto-accepted; the other 50 land in disambiguate | 2026-09-13 |
| Un-enrolled accepts on a small catalog (**simulated**) | ≤ 2% | **7.9%** at 1 product · **15.1%** at 5 · 9.7% at 15 · 2.9% at 25 — per frame, Phase 0 data (Infinix X6823) resampled by `scripts/small-catalog.mjs`, not a store measurement (ADR-013) | 2026-09-14 |
| Embedding dimensionality | assumed 1024 | **1280** | 2026-09-13 |
| Per-frame worklet latency, budget Android | 25–40 ms | **140–248 ms, median ~148** — Infinix X6823 (Unisoc T616, armeabi-v7a), **debug build**; covers crop+resize+inference+L2 as one | 2026-09-13 |
| Same, release build | 25–40 ms | **median 145.5 ms · p90 160.1 · range 126.5–339.5** — Infinix X6823, release APK, n = 226 test frames. Earlier spot readings (140.7 / 144.0 ms) agree. | 2026-09-13 |
| Inference latency, iOS | 8–15 ms | — | — |
| JS brute-force KNN, no sqlite-vec | must fit `NFR-07` / `NFR-09` | **100 shots: median 9.2 ms · 2,500 shots: median 234.0 ms** (inline loop, n = 10 each; 831.1 ms via `dot()` per shot) — Infinix X6823, release APK | 2026-09-14 |
| Read 2,500 × 1280-d vector BLOBs | — | **56.3 ms**, bit-exact round trip — Infinix X6823, release APK | 2026-09-14 |
| Per-frame worklet stages, CPU (P1-3) | ≤ 60 ms total (`NFR-07`) | crop+resize **36.9** · `runSync` **62.8** · normalize **0.9** · total **100.7** ms median (total p90 109.1), n = 40 — Infinix X6823, release APK. Not met. | 2026-09-14 |
| Per-frame worklet stages, `android-gpu` delegate (P1-3) | ≤ 60 ms total (`NFR-07`) | crop+resize **36.6** · `runSync` **43.2** · normalize **0.9** · total **81.2** ms median (total p90 83.0), n = 40 — Infinix X6823, release APK. Not met. **Not adopted:** GPU-vs-CPU vector agreement unmeasured. | 2026-09-14 |
| Frame-vs-JPEG vector agreement (P1-4) | no target yet; must not move decisions | dot **min 0.9803 · median 0.9843**, n = 10 captures of **one static scene** — Infinix X6823, release APK, CPU | 2026-09-14 |
| Reference photo size (`NFR-08`) | ≤ 200 KB per 5-shot product | **17.5 KB median, 17.6 KB max per shot** → ~88 KB per product (one scene); 396 px crop of a 1280×720 frame, JPEG q80 | 2026-09-14 |

---

## Decisions pending

| # | Question | Owner | Needed by |
|---|---|---|---|
| Q-1 | ~~Does MobileNetV3 clear the 85% gate?~~ **Yes — 94.5%** | Phase 0 measurement | Resolved 2026-09-13 |
| Q-2 | ~~Empirical τ and δ~~ **τ 0.46, δ 0.075** (Phase 0; retune in Phase 3) | Phase 0 measurement | Resolved 2026-09-13 |
| Q-3 | MobileCLIP vs MobileNetV3 | Phase 3 bake-off | Phase 3 |
| Q-4 | INT8 accuracy cost | Phase 3 | Phase 3 |
| Q-5 | `confirm_below` — catalog size at which confirm mode ends (`TR-38`, ADR-013) | Phase 3 store data | Phase 3 |
| D-1–D-4 | ~~Phase 1 gate wording, test runner, golden fixture, Filipino copy~~ **Settled** — `PHASE_1_PLAN.md` §3, ADR-012 | Operator | Resolved 2026-09-14 |

---

## Known limitations accepted

These are **not bugs**. See `PROJECT_SPECS.md` §8.

- **L-01** Repacked clear-bag goods are indistinguishable → quick-pick grid
- **L-02** Same product, different size → disambiguation chip
- **L-03** Device loss = catalog loss → export ships Phase 4
- **L-04** Deformable packaging recognizes less reliably
