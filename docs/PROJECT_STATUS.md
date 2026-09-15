# Project Status

> **Claude: update this file at the end of any session that changes what is built, blocked, or
> decided.** Keep it short — it is a dashboard, not a journal. The journal is `CHANGELOG.md`.

**Last updated:** 2026-09-15
**Current phase:** Phase 2 — UI / UX *(Phase 1 gate passed and verified with `/phase-gate` 2026-09-14; Phase 0 gate 2026-09-13)*
**Overall health:** 🟢 The real data path holds: 20 products survive a force-stop and scan with zero wrong locks. Latency (`NFR-07`), un-enrolled handling (`NFR-03`) and look-alike confusion are open.

---

## Right now

| | |
|---|---|
| **Working on** | **Phase 2, on `feat/phase-2-ui`. P2-1 to P2-5 done** (P2-4's gate A2–A4 and P2-5's early gate B5 passed on the Infinix). P2-5: a *repacked* toggle at enrollment, an offer to mark look-alikes, and a grid (lock or pinned *Repacked* button) of photo + name tiles with a price only after a tap. Tests **277**, typecheck clean. **The gate catalog now holds 20 live products, 2 negatives, 1 correction shot (Knorr Chicken), 2 price edits (Clover) and 3 trashed repacked bags (15 shots, 15 photos)** until P2-7's purge (backup of the pre-migration catalog: `C:\BantayNiMamaBackups\gate-catalog-v1`). |
| **Next action** | **P2-6** — first run, permission recovery, guided enrollment. Filipino copy for P2-3 to P2-5 reviewed, no corrections (2026-09-15). **Gate check after B5 PASS** in airplane mode on a fresh process: self-match 103/103, 0 missing of **118 photo rows** (the trashed bags count until P2-7). |
| **Blocked on** | Nothing. |
| **Owed — native search** | sqlite-vec cannot load on 32-bit ARM ([op-sqlite#456](https://github.com/OP-Engineering/op-sqlite/issues/456)). JS search measured **9.2 ms at 100 shots but 234 ms at 2,500** on the Infinix, so `NFR-09` (500 products) needs native search before Phase 4. Tracked for Phase 3 (ADR-014). |
| **Watch out for** | **Per-frame latency is over budget** (`NFR-07` ≤ 60 ms).<br>• **P1-3 split on the Infinix:** `runSync` 62.8 ms on CPU, 43.2 ms with the GPU delegate; crop + resize ~37 ms.<br>• **Since P1-6:** crop + resize reads **~60 ms**, **unplugged too**, and the gate-run total is ~126 ms at 100 shots. The cause is unconfirmed; a 6-frame cold reading of 35.9 ms hints at sustained-use heat.<br>• **Look-alike confusion:** Alaska 360ml ↔ Argentina 260g produced accept-grade votes above δ (ADR-016). The 4-of-5 quorum makes a lock harder, but the confusion remains. See `ARCHITECTURE.md` §8. |
| **Known soft spot** | **Un-enrolled products.** At τ/δ, 50 of 105 un-enrolled frames land in *disambiguate* (two wrong chips), so only 49.5% return Unknown (`NFR-03` ≥ 85%, not met). `analyze.mjs`'s 97.1% counts "not auto-accepted". All 3 false accepts are Zonrox bottles → Datu Puti vinegar. **A deleted product is un-enrolled too:** gate A4 logged a possible wrong LOCK Knorr Pork 6 s after deleting the sponge (unattributed, shown as a question). |
| **New risk — small catalogs** | δ rejects un-enrolled items only when an enrolled product is close. Simulated on Phase 0 data, **15.1%** of un-enrolled frames are auto-accepted at 5 products (SR-44's first five), and 9.7% still at 15. Plan (ADR-013): confirm mode + store-local negatives (`SR-13`, `SR-14`), built in Phase 2 (P2-3). Until Phase 3 calibrates `confirm_below`, **every ACCEPT is a question** (ADR-017). |
| **Biggest risk** | Correct accepts are **74.7%** at τ/δ vs `NFR-01` ≥ 90%. Ranking is strong (top-3 100%) but margins are thin, so many correct matches fall to disambiguate. A Phase 3 problem — the Phase 0 gate measures ranking only. |

---

## Phase progress

| Phase | Name | Status | Gate |
|---|---|---|---|
| **0** | Embedding viability spike | 🟢 Passed gate — 94.5% (2026-09-13) | ≥ 85% top-1 on non-ambiguous items |
| **1** | Proof of concept — real data path | 🟢 Passed gate — run 3: 20/20, 0 wrong locks, self-match 100/100 (2026-09-14; run 2 failed first, ADR-016) | Enroll 20 → force-quit → relaunch → persistence + self-match checks → scan all 20: correct lock **or** chip for every product, **zero wrong locks** (`PHASE_1_PLAN.md` §4) |
| 2 | UI / UX | 🔵 In progress — plan approved 2026-09-14; P2-1 to P2-5 done (schema v2, confirm mode, negatives, edit / correct / delete, quick-pick grid on device; gate B5 early run passed); P2-6 next | Two runs, upgrade (20 products) + fresh install (5): **zero confident wrong prices**; confirm mode, negatives, edit / correct / delete, quick pick, first run ≤ 30 s per product; time-to-lock recorded, not blocking (`PHASE_2_PLAN.md` §4) |
| 3 | ML integration & accuracy | ⚪ Not started | NFR-01 ≥ 90%, NFR-02 ≤ 2% |
| 4 | Polish & ship | ⚪ Not started | All NFRs met on a real device |
| 5 | Post-MVP | ⚪ Deferred | — |

Legend: ⚪ not started · 🔵 in progress · 🟢 passed gate · 🔴 gate failed

---

## Phase 2 checklist

Detail and "done when" for each step: [`PHASE_2_PLAN.md`](PHASE_2_PLAN.md) §5. All device steps on the
**release** APK.

- [x] Plan written; D-1 to D-4 settled, E-1 to E-5 adopted (ADR-017 to ADR-020) *(2026-09-14)*
- [x] P2-1 Domain — display resolution, `confirm_below`, correction slots, price edit, trash, first run, time-to-lock; golden replay unchanged *(2026-09-14)*
  - [x] `scanDisplay`, `correction`, `priceEdit`, `trash`, `firstRun` and `timeToLock` added. `knn` gains negatives, `stability` and `lockLog` learn the grid, and enrollment shares `parsePrices`. Tests 147 → 210, typecheck clean, golden replay unchanged.
  - [x] KNN exactness proven at 9 shots per product with 0, 5 and 200 negatives, and shown to break at 10 shots (ADR-019)
  - [ ] **Not yet exercised in the app:** nothing calls these until P2-2 to P2-8
- [x] P2-2 Schema v2 — `negative_shots`, `product_shots.source`; migration tested under `node:sqlite`; device checkpoint on the 20-product catalog *(2026-09-14)*
  - [x] Migration 2 and the repositories. The three `negative_shots` readers are tested, and the SQL runs under `node:sqlite` in `npm test`. Tests 210 → 231.
  - [x] Catalog backed up before migrating (operator's call): debug APK + `run-as`, 101/101 SHA-256 match, `integrity_check` ok. A rehearsal on a copy found 0 gate problems.
  - [x] **Checkpoint on the Infinix, release APK** (14:15): launch `schema 1 → 2`, sweep 0, index 100. **Gate check PASS:** 20 products, 100 shots, 0 missing, self-match 100/100, own min 1.000000, nearest other 0.7512 / 0.8254 / 0.8954, 13.6 s. **Gate A1 met early.**
- [x] P2-3 Scan card — confirm mode, *Not in my list*, torch (`SR-13`, `SR-14`, `SR-11`) *(2026-09-14; verified on the 20-product catalog, done-when amended)*
  - [x] Built: confirm / quote / chips / interim quick pick; reject flow as a reducer with the capture guard; torch; interaction log. Tests 231 → 245.
  - [x] **On the Infinix, release APK:** 3 Yes taps on locks; 2 negatives saved via the flow; after a relaunch, chip votes with a negative locked **UNKNOWN** ×3; after a force-stop, **gate check PASS** (negatives 2, self-match 102/102, 0 missing); Kalamansi, Chilimansi and Lucky Me Beef still **LOCK** with both negatives loaded; torch lit.
  - [x] Capture guard's refusal seen on device *(P2-4 gate A3, 20:07:27)*: a correction's capture frame no longer showed the Knorr pair → `correctMismatch`, nothing saved; the retry saved. The P2-3 negatives' items were not named.
  - [x] Filipino copy for the card and sheet: reviewed by the operator, **no corrections** *(2026-09-15)*
- [x] P2-4 Edit / correct / delete from the scan card, with undo (`SR-06`–`SR-08`, `SR-32`) *(2026-09-14; gate A2–A4 passed on the Infinix)*
  - [x] Built *(2026-09-14)*: price editor bound at tap time (settled cards only); *Wrong?* sheet with likely products, search and *Not in my list*; correction shots through the capture guard; soft delete, 10 s undo and index rebuild; trash list with Restore (pulled forward from P2-7); gate panel shows rebuild timings and `price_history`. Tests 245 → 264.
  - [x] **Gate A2 on the Infinix, release APK** *(2026-09-14, not in airplane mode)*: Clover Chips 24g repriced from the scan card at 19:36:13 and 19:42:16; the second edit was the binding check (opened on Clover 19:41:44, phone moved to another product before Save — operator-reported, since voting pauses while the editor is open), and it landed on Clover with no other product's `price_history` row. After `am force-stop` → new pid 16551 (launch `schema 2 -> 2`, index 102, negatives 2): Clover shows the new price on Yes (operator-reported, 19:45:44) and the gate panel still reads `price_history rows 2` (was ₱12.00, was ₱20.00).
  - [x] **Gate A3 first attempt found a gap** *(~19:50)*: the Knorr pair only chipped, and the sheet refused both chip products, so nothing could be corrected. **Fixed by ADR-022** (operator's call): the chip card's *Wrong?* sheet offers both products of the pair. Rebuild and re-run.
  - [x] **Gate A3 passed on the ADR-022 build** *(20:07–20:13, not in airplane mode)*: *Wrong?* on CHIPS Knorr Chicken | Pork (20:07:09) → Chicken → **`correctMismatch`** at 20:07:27 (the capture guard refusing, first seen on device) → retry → `correctSaved` at 20:07:45; the pair then **LOCKed Chicken** (Yes at 20:08:04). Products tab: Chicken 6 photos, Pork 5. After `am force-stop` → pid 21337 (launch index 103, negatives 2): **gate check PASS** — products 20, shots 101 (corrections 1), negatives 2, photo rows 103, **missing 0**, self-match **103/103**, own min 1.000000, nearest other max 0.8954 (unchanged), 13.9 s.
  - [x] **Gate A4, delete and undo** *(pid 21337, 20:16–20:17)*: Sponge Scouring Pad deleted from the editor at 20:16:58, undo lapsed 20:17:08, listed in *Deleted products (1)*. Kopiko: LOCK 20:17:35 → delete → **Undo** (20:17:46, inside the window) → LOCK Kopiko 20:17:47. Index rebuilds **n = 3, median 9.2 ms, max 17.0** (103 → 98 → 93 → 98 rows); 58 frames then searched 98 shots. The sponge never locked while deleted.
  - [ ] **Possible wrong lock, unattributed:** at 20:17:04, 6 s after deleting the sponge, **LOCK Knorr Broth Cube Pork** (s 0.536, m 0.088, 4 accept votes 0.51–0.55), then CHIPS Knorr Pork \| Clover to 20:17:17. The operator is not sure what was in the box. If it was the sponge, a deleted product fell through to its neighbour (the un-enrolled soft spot below). Confirm mode showed it as a question, not a price.
  - [x] **Gate A4, after force-stop** *(pid 23604, 20:25–20:29)*: launch `index 98 (negatives 2)`, so the sponge stayed out of the index; restored from the trash at 20:29:03 (rebuild **23.2 ms**, 103 rows); **LOCK Sponge Scouring Pad** at 20:29:25, Yes at 20:29:27. Lock log since the relaunch: 1 LOCK (the sponge, after restore), 0 CHIPS. **Gate A4 passed.**
  - [x] Filipino copy for the editor, sheet, undo bar and trash: reviewed by the operator, **no corrections** *(2026-09-15)*
- [x] P2-5 Quick-pick grid (`SR-10`) *(2026-09-15; gate B5 early run passed on the 20-product catalog)*
  - [x] Built *(2026-09-14)*:
    - **Domain:** `quickPickTiles` gives a fixed name order; operator's call: tiles show photo and name, and a price only after a tap. `repackedPlan` decides what the toggle and the offer write.
    - **Enrollment:** the *repacked* toggle; the look-alike offer on the duplicate warning, written in the enrollment transaction.
    - **Scan tab:** the grid on a `quickPick` lock; the pinned *Repacked* button; no reject on the grid.
    - **Products tab:** the repacked label.
    - Tests 264 → 277.
  - [x] **Gate B5 early run on the Infinix, release APK** *(2026-09-15, APK built 09:58 from `b875d1f`, installed over the gate catalog)*:
    - **Enrolled with the toggle on:** Sugar White 5g, Sugar Brown 10g, Sili 20p (5 shots each, 10:39–10:42).
    - **Scan (operator-reported, all 3 bags):** the grid opened and named nothing; a tile tap showed that product's price; the pinned *Repacked* button opened the same grid.
    - **Database, read off the phone afterwards** (debug APK + `run-as`, SHA-256 match, release APK reinstalled): all 3 `is_ambiguous = 1`, deleted 10:43:18–10:43:40. **20 live products, 0 of the 20 gate products flagged repacked, 0 deleted**; no negatives and no `price_history` rows written that day; 118 photos on disk = 118 referenced rows, 0 missing, 0 orphans; all paths relative, all vectors `mobilenet_v3_large_embedder_v1`.
    - **Not recorded:** whether the look-alike offer appeared or was accepted between bags; airplane mode during the scan.
    - [x] **Gate check after B5, airplane mode on** *(10:55:35, pid 27266 after `am force-stop` from 24308, cold start)*: **PASS** — products 20, shots 116 (corrections 1), negatives 2, index 103, trashed 3 (15 shots), other-model 0; schema 2, 1280-d, τ 0.46, δ 0.075; photo rows 118, **0 missing**; self-match **103/103**, own min 1.000000; nearest other median 0.7512 · p90 0.8254 · max 0.8954 (unchanged since Phase 1 run 3); 14.3 s. No *Repacked* button on Scan.
    - Gate part B runs B5 again on the fresh install.
  - [x] Filipino copy for the toggle, offer and grid: reviewed by the operator, **no corrections** *(2026-09-15)*
- [ ] P2-6 First run, permission recovery, guided enrollment (`SR-44`, `SR-43`, `SR-20`, `SR-22`, `SR-25`)
- [ ] P2-7 Directory (`SR-30`–`SR-35`) and the negatives list
- [ ] P2-8 Time-to-lock measured and calibrated (`NFR-04`)
- [ ] P2-9 Gate run — §4 parts A and B, then `/phase-gate`

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
  - [x] Owed before the P1-8 gate: effect of JPEG-path enrollment on real decisions. Phase 0's τ/δ came from live-frame vectors; a 0.984 dot can move a score by up to 0.18 (δ = 0.075). **Addressed by the gate (2026-09-14):** all gate runs enrolled through JPEG-path vectors, and run 3 locked or chipped all 20 with 0 wrong locks. Not a controlled frame-vs-JPEG comparison; Phase 3's retune uses JPEG-path vectors.
- [x] P1-5 Enrollment — one transaction, photos first (`SR-20`, `SR-21`, `SR-23`, `SR-24`, `TR-45`) *(2026-09-14)*
  - [x] `domain/enrollment.ts` (form → centavos, duplicates ≥ τ), `features/enrollment/` (JPEG-path vectors, rollback deletes photos, index extended after COMMIT), `db/catalog.ts` (model_id check, launch orphan sweep); tests 93 → 107 *(2026-09-14)*
  - [x] i18next + react-i18next pulled forward from P1-7, network-audited (`TR-51`); enrollment copy in `en` + `fil` (fil is a draft for the operator); keys typed *(2026-09-14)*
  - [x] Release APK installed and launched on the Infinix *(2026-09-14, 4m 23s build)*: `bantay.db` schema 1 → 1, τ 0.46 / δ 0.075 read from `app_meta`, 0 products, **orphan sweep removed 10** (the P1-4 check photos), other-model shots 0; English form renders
  - [x] **On the Infinix, release APK** *(2026-09-14)*: enrolled Reno Liver Spread, Argentina Corned Beef 260g and 100g (5 shots each). The duplicate warning fired on the second Argentina (`SR-23`). After a relaunch: 3 products / 15 shots, index 15, sweep 0. Scan (19 screenshots, 5 s apart): **LOCK Reno** ₱20.00 at 0.750 / 0.746 (margin 0.237 / 0.254); **LOCK 260g** ₱35.00 at 0.881 (margin 0.160); the 260g/100g pair gave **CHIPS** (margins 0.012–0.042) and 100g never locked; empty and in-between frames were UNKNOWN. **Zero wrong locks.** Frames were matched to products by scan order (operator-reported).
  - [x] Frame-vs-JPEG agreement on real products *(2026-09-14, two enrollment sessions, 92 shots)*: dot **min 0.9882 / 0.9804, median 0.9960 / 0.9963**; JPEG **max 34.1 KB** per shot (≤ 170.5 KB per 5-shot product, `NFR-08` ≤ 200 KB)
  - [x] Filipino copy reviewed by the operator before `/phase-gate` (D-4, amended 2026-09-14): **no corrections**; `fil.json` stands as drafted *(2026-09-14)*
- [x] P1-6 Scanner — lock / chips / Unknown; KNN and policy latency timed (`SR-02`–`SR-04`, `SR-09`, `SR-12`) *(2026-09-14)*
  - [x] `domain/confidence.ts` (Sure / Likely / Not sure from δ — operator's choice), `features/scanner/` (`useScanner`: renders only on lock change, clears on lost quorum, times KNN and policy separately; `ScanOverlay`: LOCK / CHIPS / Unknown + Add), `scan` strings in `en` + `fil`; tests 107 → 114 *(2026-09-14)*
  - [x] **On the Infinix, release APK** *(2026-09-14, 18 screenshots 5 s apart, each checked against the product actually in the reticle)*:
    - **Locks:** 100g ₱25.00 and 260g ₱35.00 ×2, all **correct**, all read *Likely*. **Zero wrong locks.**
    - **Chips:** 260g | 100g on the size pair; tapping 100g showed ₱25.00. Reno held sideways gave chips 100g | Reno, and tapping Reno showed ₱20.00.
    - **Unknown:** the un-enrolled ascorbic acid blister pack, motion blur and empty frames all read **Unknown**.
  - [x] Timed on the Infinix *(2026-09-14, n = 200 frames, 15 shots)*: KNN **1.31 / 4.23 ms**, policy + stability **0.07 / 0.11 ms** median/p90 → `ARCHITECTURE.md` §8
  - [ ] Not exercised: tapping **Add** on Unknown → enroll mode
  - [ ] **Near miss to carry into Phase 3:** with Reno held sideways, **Argentina 100g ranked top-1** and only the δ margin turned it into chips instead of a wrong lock. In P1-5, Reno held upright locked at 0.750.
- [x] P1-7 App shell — two tabs, `en` + `fil` (Claude drafts, operator corrects); spike code deleted (`TR-14`, `TR-16`, `SR-42`) *(2026-09-14)*
  - [x] React Navigation tabs (ADR-015, `TR-14` amended), `expo-localization` + saved `ui_language`, gate check on the Products tab (`domain/gateCheck.ts`), `App.tsx` and `src/spike/` deleted; 25 packages network-audited; tests 114 → 131 *(2026-09-14)*
  - [x] **On the Infinix, release APK** *(2026-09-14)*:
    - Both tabs work; the tab labels were clipped by the navigation bar and are fixed.
    - A 4th product (Clover Chips 24g) was enrolled from the Scan tab.
    - Filipino survived a force-stop.
    - **Gate check dry run PASS** on 4 products / 20 shots: 0 missing photos, self-match 20/20, own score min 1.000000, nearest other shot max 0.8679, in 2.4 s.
    - The camera pausing on Products is operator-reported.
  - [ ] The gate readout does not reach logcat in release (neither does `[catalog]`), so record P1-8 from screenshots
- [x] P1-8 **Gate run** — 20 products, force stop, airplane mode, then `/phase-gate` *(2026-09-14, **PASS** on run 3)*
  - [x] **Steps 1–4, first run** *(2026-09-14, Infinix X6823, release APK, CPU)*:
    - Setup: 20 products / 100 shots, with 4 same-brand pairs plus Knorr Chicken/Pork and Datu Puti Soy Sauce/Vinegar. Force-stop confirmed (new process, 4 min old); `airplane_mode_on` 1.
    - **Gate check PASS:** index 100, other-model 0, schema 1, 1280-d, τ 0.46, δ 0.075; photo rows 100, **0 missing**; self-match **100/100**, own score min **1.000000**; nearest other shot median 0.7512, p90 0.8254, max 0.8954; 11.7 s.
    - The check ran after the scan step, in the same process. Scanning does not write data.
  - [ ] **Step 5, first run: not yet passable.**
    - **Coverage:** 57 screenshots about 6 s apart, each checked against the reticle. 19/20 products observed correct: **13 LOCK**, 6 chips containing the right product. **0 wrong locks observed.**
    - **Piattos Cheese 18g not observed:** one screenshot, still settling on Unknown.
    - **Sampling gap:** a wrong lock lasting under ~6 s could be missed.
    - **Near misses:** Datu Puti Soy Sauce ranked Vinegar top-1 (chips), and Lucky Me Beef was once chipped with Pancit Canton Chilimansi.
  - [x] Lock log added (`domain/lockLog.ts`, every lock change time-stamped and segmented at Unknown; tests 131 → 139) so step 5 is judged on the whole run, not on samples *(2026-09-14)*
  - [ ] **Gate run 2, step 5: FAILED — 1 wrong lock** *(2026-09-14, 11:42:38–11:49:12, Infinix X6823, release APK, CPU)*:
    - **Conditions:** force-stop confirmed (new process), airplane mode on. Lock log: 98 changes, 20 LOCK, 26 CHIPS, 25 segments.
    - **The wrong lock:** at **11:43:56** (segment #2), with a **motion-blurred Alaska Evaporada 360ml** in the reticle (backup shot 012), the app **locked Argentina Corned Beef 260g** and showed ₱35.00 (true price ₱50.00). By §4, any wrong lock fails the gate.
    - **Every product was otherwise correct:** 14 locked (including Piattos this time), and 6 were chips containing the product.
    - **Likely cause, not measured:** motion blur. The sharpness gate (`TR-27`) is deferred and its floor is 0; the log has no scores.
    - **Steps 3–4 PASS, same process** (pid 19300, airplane mode, run after the scan): index 100, other-model 0, schema 1, 1280-d, τ 0.46, δ 0.075; photo rows 100, **0 missing**; self-match **100/100**, own score min **1.000000**; nearest other shot median 0.7512, max 0.8954; 13.3 s.
    - **Run 2 overall: FAIL.** Steps 3 and 4 pass; step 5 fails on one wrong lock.
  - [x] **Diagnosis** *(2026-09-14, operator's call; lock log now carries score, margin, 5 voting frames and sharpness)*:
    - **The wrong lock did not reproduce** in about 2 minutes: 7 LOCK, all correct.
    - **Confusion in both directions:** with Argentina 260g held, Alaska 360ml ranked top-1 at 0.63–0.76, including accept-grade votes above δ (margins 0.09 and 0.12). At most 1 such vote per window was seen; the failure needed 3.
    - **Blur does not explain it:** wrong-can votes had sharpness ×1000 of 1.7–12.6, against a frame median of 8.6 (p10 0.3, p90 20.9).
    - **Measuring sharpness costs 20.9 ms/frame.**
    - **Limits:** votes attributed by protocol timing, no screenshots.
  - [x] **Fix (ADR-016, operator's call):** lock quorum 3 → 4 of 5 (`TR-36` amended); τ/δ unchanged; sharpness measurement removed from the worklet *(2026-09-14)*
  - [x] **Gate run 3: meets §4** *(2026-09-14, Infinix X6823, release APK, CPU, airplane mode, 4-of-5 quorum)*: force-stop, steps 3–4, all 20 scanned with the lock log and backup screenshots
    - [x] **Steps 3–4 PASS** *(2026-09-14, 12:19, new process pid 27320 after force-stop, airplane mode, 4-of-5 build)*: products 20, shots 100, index 100, other-model 0; schema 1, 1280-d, τ 0.46, δ 0.075; photo rows 100, **0 missing**; self-match **100/100**, own score min **1.000000**; nearest other shot median 0.7512, max 0.8954; 13.3 s
    - [x] **Step 5 PASS** *(same process pid 27320 throughout, 12:20:48–12:27:16)*:
      - **20/20 products** locked correctly or offered as chips containing the product: **15 LOCK**, 5 chips only (Alaska 360ml, Datu Puti Soy Sauce, Knorr Chicken, Knorr Pork, Pancit Canton Chilimansi).
      - **0 wrong locks** in the full lock log: 145 changes, 24 LOCK, 26 CHIPS, 21 segments.
      - **Attribution checked against 63 backup screenshots.** #8 was a Clover lock with the Clover bag in view. #3 was LOCK Argentina 100g with the squat 100 g can (shot 012). "260", "SPICY LABUYO", "CHILIMANSI" and "KALAMANSI" are readable where they matter.
      - **Alaska 140/360 ml** attributed by list order plus the operator's chip taps.
      - **Caveats:** one clean run is consistent with ADR-016 but does not prove it fixed the rare wrong lock. Chips were tapped ~10 times (a tap only shows a price). Time-to-lock under 4-of-5 is unmeasured.
  - [x] **`/phase-gate` verdict: PASS** *(2026-09-14)*. Every §4 criterion has measured evidence meeting its target:
    - Setup: 20 products, 4 variant pairs.
    - Force-stop: new process, same process throughout.
    - Airplane mode on.
    - Step 3: counts, `app_meta`, 0 missing photos.
    - Step 4: self-match 100/100.
    - Step 5: 20/20, 0 wrong locks.

    **Carried open, outside the gate:** `NFR-07` (~126 ms), `NFR-01` / `NFR-03` (Phase 3), `NFR-04` under 4-of-5 (unmeasured), GPU vector agreement, the Add → enroll tap, and look-alike confusion.

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
| Enroll → relaunch → scan (P1-5) | lock or chip, zero wrong locks | 3 products: Reno **LOCK** 0.750, Argentina 260g **LOCK** 0.881, 260g/100g size pair **CHIPS** (margins 0.012–0.042); **0 wrong locks** in 19 screenshots — Infinix X6823, release APK, CPU, JPEG-path vectors | 2026-09-14 |
| Scan overlay on device (P1-6) | lock or chip, zero wrong locks | 18 screenshots, each checked against the product in the reticle: **3 correct locks** (100g, 260g ×2, all *Likely*), chips on the size pair and on Reno held sideways (100g ranked top-1 there — a near miss), un-enrolled blister pack → **Unknown**; **0 wrong locks** — Infinix X6823, release APK, CPU | 2026-09-14 |
| JS KNN / policy + stability per frame (P1-6) | part of `NFR-07` | KNN **1.31 / 4.23 ms** · policy + stability **0.07 / 0.11 ms** median/p90, n = 200 live frames, 15 shots — Infinix X6823, release APK | 2026-09-14 |
| Worklet stages, CPU, while charging (P1-6) | ≤ 60 ms total (`NFR-07`) | crop+resize **60.4** / 61.5 · `runSync` 63.5 / 76.3 · normalize 0.9 · total **124.7** / 142.9 ms, n = 40. **crop+resize is up from P1-3's 36.9, cause unconfirmed** (heat while charging, or the P1-4 refactor); re-measure unplugged — Infinix X6823, release APK | 2026-09-14 |
| Gate check dry run (P1-7) — `PHASE_1_PLAN` §4 steps 3–4 | 0 missing photos; every shot self-matches | **PASS** on 4 products / 20 shots: index 20, other-model 0, schema 1, 1280-d; photo rows 20, **0 missing**; self-match **20/20**, own score min **1.000000**; nearest other shot median 0.7186, max 0.8679; 2.4 s — Infinix X6823, release APK, CPU. **A dry run, not the gate** (20 products needed) | 2026-09-14 |
| Frame-vs-JPEG agreement, real products (P1-8 prep) | no target; must not move decisions | Session 1: dot **min 0.9882 · median 0.9960** (n = 40). Session 2: **min 0.9804 · median 0.9963** (n = 52). **Worst of 92 shots: 0.9804**, about P1-4's one static scene (0.9803), and it bounds a score shift at ≈ 0.20; typical ≈ 0.09 — Infinix X6823, release APK, CPU | 2026-09-14 |
| Reference photo size, real products (`NFR-08`) | ≤ 200 KB per 5-shot product | Session 1: **21.9 KB median · 32.5 KB max** per shot (n = 40). Session 2: **24.2 KB median · 34.1 KB max** (n = 52). Five worst-case shots ≤ **170.5 KB** ✅ — Infinix X6823 | 2026-09-14 |
| Worklet stages, CPU, **unplugged** (P1-8 prep) | ≤ 60 ms total (`NFR-07`) | Session 1: crop+resize **59.7** / 60.6 · `runSync` 71.6 / 82.2 · normalize 0.9 · total **132.0** / 144.2 ms. Session 2: crop+resize **59.6** / 61.2 · `runSync` 72.5 / 75.9 · total **133.2** / 138.0 ms. n = 40 each, during enrollment, unplugged (operator-reported). **Not charging heat.** A post-relaunch 6-frame reading of 35.9 ms hints at sustained-use heat; unproven — Infinix X6823, release APK | 2026-09-14 |
| Gate §4 steps 3–4 (P1-8, first run) | 0 missing photos; every shot self-matches | **PASS** on 20 products / 100 shots after a force-stop, in airplane mode: 0 missing, self-match **100/100**, own score min **1.000000**, nearest other shot max 0.8954, 11.7 s — Infinix X6823, release APK, CPU | 2026-09-14 |
| Gate §4 step 5 (P1-8, first run, sampled) | correct lock or chip for all 20; zero wrong locks | **19/20 observed** (13 LOCK · 6 chips), **0 wrong locks in 57 screenshots about 6 s apart**; Piattos not observed. **Not a pass:** sampled, and one product missing — Infinix X6823, release APK, CPU | 2026-09-14 |
| JS KNN / policy per frame at 100 shots (P1-8) | part of `NFR-07` | KNN **8.52 / 13.78 ms** · policy + stability **0.08 / 0.10 ms** median/p90, n = 200 live frames (P1-2 synthetic: 9.2 ms at 100 shots) — Infinix X6823, release APK | 2026-09-14 |
| **Gate §4 step 5 (P1-8, run 2, full lock log)** | correct lock or chip for all 20; **zero wrong locks** | **FAIL — 1 wrong lock.** A motion-blurred Alaska Evaporada 360ml locked as Argentina Corned Beef 260g (₱35.00 shown, true ₱50.00) at 11:43:56. All 20 products were otherwise locked (14) or chipped (6) correctly. 98 lock changes, 20 LOCK, 26 CHIPS — Infinix X6823, release APK, CPU, airplane mode | 2026-09-14 |
| Alaska 360ml ↔ Argentina 260g confusion (P1-8 diagnosis) | a wrong lock needs 3 of 5 frames to rank the wrong product first by at least δ | **Not reproduced as a lock** in about 2 min (7 LOCK, all correct). Wrong-can top-1 votes at 0.63–0.76, with accept-grade margins up to **0.12** (δ 0.075); at most 1 per window. Attributed by protocol timing — Infinix X6823, release APK, CPU | 2026-09-14 |
| Frame sharpness, ×1000 (P1-8 diagnosis, `TR-27`) | floor not yet calibrated | n = 300: **p10 0.3 · median 8.6 · p90 20.9**. Wrong-can votes 1.7–12.6, so it **does not separate** them. **Cost 20.9 / 21.3 ms per frame** (n = 40) — Infinix X6823, release APK | 2026-09-14 |
| **Gate §4 step 5 (P1-8, run 3, full lock log, 4-of-5)** | correct lock or chip for all 20; **zero wrong locks** | **PASS — 20/20** (15 LOCK, 5 chips only), **0 wrong locks** in 145 lock changes (24 LOCK, 26 CHIPS); attribution checked against 63 backup screenshots. Steps 3–4 PASS in the same process after a force-stop — Infinix X6823, release APK, CPU, airplane mode | 2026-09-14 |
| Reference photo size (`NFR-08`) | ≤ 200 KB per 5-shot product | **17.5 KB median, 17.6 KB max per shot** → ~88 KB per product (one scene); 396 px crop of a 1280×720 frame, JPEG q80 | 2026-09-14 |
| **Migration 1 → 2 on the real catalog (P2-2, gate A1 early)** | rows survive; Phase 1 gate check still passes | **PASS.** Launch `schema 1 → 2`, orphan sweep 0, index 100 (negatives 0). Gate check: 20 products, 100 shots, 0 corrections, 0 negatives, 0 missing photos, self-match **100/100**, own min **1.000000**; nearest other shot median 0.7512 · p90 0.8254 · max 0.8954, identical to Phase 1 run 3; 13.6 s — Infinix X6823, release APK, CPU. Not in airplane mode. | 2026-09-14 |
| **Scan card on device (P2-3)** | every ACCEPT a question; a negative reads Unknown after relaunch; neighbours still lock | **Met.** 3 Yes taps on locks (Clover, Lucky Me Beef, Piattos). After a relaunch (launch `negatives 1`), chip votes with the negative locked **UNKNOWN ×3**. After a force-stop (`index 102, negatives 2`): gate check PASS, self-match **102/102**, 0 missing photos. With both negatives loaded: Kalamansi LOCK ×4 (0.740–0.812), Chilimansi LOCK (0.818), Lucky Me Beef LOCK ×3 (0.700–0.840), no vote hitting a negative. **Not seen:** the capture guard's refusal. 20-product gate catalog, not 5 (amended) — Infinix X6823, release APK, CPU, not in airplane mode | 2026-09-14 |
| JS KNN / policy per frame, 102 rows (P2-3) | part of `NFR-07` | KNN **8.94 / 12.30 ms** · policy + stability, now including `resolveFrame`, **0.09 / 0.12 ms** median/p90, n = 60 live frames, 100 shots + 2 negatives — Infinix X6823, release APK | 2026-09-14 |
| Crop + resize swing within one session (P2-3) | ≤ 60 ms total (`NFR-07`) | n = 40 each, CPU: **35.8** / 36.6 (14:47) · 59.7 / 62.6 (14:55) · 59.4 / 60.5 (14:58) · 43.6 / 61.3 (15:01) ms median/p90. The heat explanation is still unproven: temperature was not recorded — Infinix X6823, release APK | 2026-09-14 |
| **Correction on a chip pair (P2-4, gate A3)** | saved on the right product; survives a force-stop; 0 missing photos | **Met.** CHIPS Knorr Chicken \| Pork → *Wrong?* → Chicken: guard refused once (`correctMismatch`), saved on retry; the pair then locked Chicken. After force-stop: gate check PASS, shots 101 (corrections 1), photo rows 103, missing 0, self-match **103/103**, nearest other max 0.8954 (unchanged), 13.9 s — Infinix X6823, release APK, CPU, not in airplane mode | 2026-09-14 |
| **Price edit, delete, undo, restore (P2-4, gates A2 and A4)** | price lands on the tapped product and survives a force-stop; a deleted product never locks; undo inside 10 s; trash survives a force-stop; restore locks | **Met.** A2: Clover repriced twice, binding check landed on Clover, `price_history rows 2` after force-stop. A4: sponge deleted, undo lapsed, out of the index after force-stop (index 98), restored (23.2 ms rebuild), LOCK sponge; Kopiko delete → Undo → LOCK. Index rebuilds: delete/undo **median 9.2 ms, max 17.0** (n = 3), restore **23.2 ms** (n = 1). **One unattributed possible wrong lock:** LOCK Knorr Pork 6 s after deleting the sponge (shown as a question) — Infinix X6823, release APK, CPU, not in airplane mode | 2026-09-14 |
| **Quick-pick grid on clear bags (P2-5, gate B5 early run)** | the grid names nothing; a tile tap shows that product's price; the *Repacked* button opens the same grid | **Met for 3/3 bags** (Sugar White 5g, Sugar Brown 10g, Sili 20p; operator-reported). Database afterwards: 20 live products, 0 gate products flagged repacked or deleted, 0 new negatives or price edits, 118 photos = 118 rows, 0 missing. Look-alike offer and airplane mode not recorded — Infinix X6823, release APK, CPU, 20-product gate catalog | 2026-09-15 |
| **Gate check after B5 (`PHASE_1_PLAN` §4 steps 3–4)** | 0 missing photos; every live shot and negative self-matches | **PASS** after `am force-stop` (cold start, pid 27266), **airplane mode on**: products 20, shots 116 (15 of them trashed), index 103 (negatives 2); photo rows 118, **0 missing**; self-match **103/103**, own min 1.000000; nearest other median 0.7512 · p90 0.8254 · max 0.8954, unchanged since Phase 1 run 3; 14.3 s — Infinix X6823, release APK, CPU | 2026-09-15 |

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
| D-1–D-4 (Phase 2) | ~~`confirm_below` default, quick-pick design, what a correction teaches, `SR-07` taps~~ **Settled**, all as recommended — `PHASE_2_PLAN.md` §3, ADR-017 to ADR-020 | Operator | Resolved 2026-09-14 |

---

## Known limitations accepted

These are **not bugs**. See `PROJECT_SPECS.md` §8.

- **L-01** Repacked clear-bag goods are indistinguishable → quick-pick grid
- **L-02** Same product, different size → disambiguation chip
- **L-03** Device loss = catalog loss → export ships Phase 4
- **L-04** Deformable packaging recognizes less reliably
