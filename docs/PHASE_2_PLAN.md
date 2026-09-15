# Phase 2 Plan — UI / UX

> **Status:** Approved 2026-09-14 — D-1 to D-4 settled by the operator, all as recommended; E-1 to
> E-5 adopted as proposed (§3; ADR-017 to ADR-020) · **Written:** 2026-09-14 ·
> Progress lives in [`PROJECT_STATUS.md`](PROJECT_STATUS.md). When a device result changes this
> plan, the step gets an *Amended* note and the original text stays, as in `PHASE_1_PLAN.md`.
>
> Phase 1 answered *"does a product survive camera → JPEG → SQLite → force-quit → camera?"* Phase 2
> answers *"can a tindera set up her store, and a helper quote prices from it, without the app ever
> showing a wrong price as if it were sure?"* The Phase 1 app was run by an operator who knows what τ
> and δ are. Phase 2 makes it usable by someone who does not. It also closes the small-catalog hole
> (ADR-013) that the Phase 1 gate could not surface, because that gate scanned only enrolled items.

---

## 1. Readiness verdict

**Ready once §2 is done and D-1 to D-4 are settled.**

| Check | Evidence | Verdict |
|---|---|---|
| Phase 1 gate measured | Run 3 PASS, verified with `/phase-gate` 2026-09-14: 20/20, 0 wrong locks, self-match 100/100 | ✅ |
| Phase 1 work on `main` | Merged: PR #2, `53cc7a7` | ✅ |
| Schema v1 leaves room | `is_ambiguous`, `deleted_at`, `last_scanned_at` and `price_history` already exist. Negatives need migration 2, as `PHASE_1_PLAN.md` §7 planned. | ✅ |
| Small-catalog false accepts | **Simulated** 15.1% of un-enrolled frames accepted at 5 products (ADR-013). Mitigation designed, not built. **This phase builds it.** | ⚠ P2-3 |
| `confirm_below` value | None exists (`TR-38`, Q-5): store data arrives in Phase 3 | ⚠ D-1 |
| `NFR-04` time-to-lock under 4-of-5 | ~1 s nominal is **computed, not measured** (ADR-016) | ⚠ P2-8 measures it |
| `NFR-07` latency | ~126–135 ms per frame against ≤ 60 ms. Not this phase's subject, but **Phase 2 must add no per-frame work to the worklet** | ⚠ Carried |
| Look-alike confusion | Alaska 360ml ↔ Argentina 260g score each other 0.63–0.76 (P1-8 diagnosis). Corrections and negatives do not fix this, and the plan must not claim they do. | ⚠ Carried to Phase 3 |
| Phase 1 loose ends | The Add → enroll tap was never exercised; P2-6 and gate B2 exercise it. The gate readout does not reach logcat in release, so screenshots stay the backup evidence. | ⚠ Covered |

---

## 2. Before the first Phase 2 commit

1. ~~Merge `feat/phase-1-data-path` into `main`~~ **Done** (PR #2, `53cc7a7`). Branch
   `feat/phase-2-ui` from `main`.
2. **Accept that migration 2 runs on the only copy of the 20-product gate catalog.** The release APK
   is not debuggable, so `adb run-as` normally cannot copy `bantay.db` off the phone, and export is
   `SR-45`, in Phase 4. The 20 products are physically at hand and can be re-enrolled. Gate part B
   (§4) **deliberately clears app data**, which deletes that catalog.

   *Amended 2026-09-14 (P2-2, operator's call):* the catalog was backed up before migration 2 after
   all.
   - **Method:** the Phase 0 debug APK has the same signing key. It was installed over the release app
     without being launched, and `bantay.db` plus `photos/` were copied off with `run-as`
     (`PHASE_0_RUNBOOK.md`).
   - **Checks:** 101/101 SHA-256 hashes match the phone, at `C:\BantayNiMamaBackups\gate-catalog-v1`.
   - **Why it works:** `adb install -r` keeps app data, and the debug build never ran. Google Play
     Protect showed a dialog on each install, and each needed a tap on the phone.
   - **Still true:** gate part B clears app data.
3. Nothing new to back up: `spike/results/` is already copied and checksummed (Phase 1 §2).

---

## 3. Decisions

### For the operator — settled 2026-09-14, all as recommended

| # | Question | Recommended | Why |
|---|---|---|---|
| **D-1** | **What `confirm_below` does until Phase 3 calibrates it** (`SR-13`, `TR-38`) | **No row in `app_meta` means confirm every ACCEPT**, whatever the catalog size. The cutoff logic is still built and unit-tested with numbers. | Every value we could seed is either known to be unsafe or unmeasured. On Phase 0 data, even 25 products leave **2.9%** of un-enrolled frames accepted (`NFR-02` ≤ 2%), and nothing above 25 has been simulated. A missing row that fails *safe* follows `TR-35`'s rule that a bad threshold must never mean "accept everything". The cost is one tap per scan until Phase 3, which is acceptable before ship but not at ship. |
| **D-2** | **What the quick-pick grid is** (`SR-10`, `L-01`) | **Ambiguous products keep 3–5 shots, and a frame that resolves to one opens the grid instead of naming it.** The grid is also pinned as a button on the Scan tab. | With no vectors at all, a clear bag of sugar in the reticle can still lock as some other enrolled product, which is a wrong price. With vectors, the bag is caught and turned into "pick which one". `SR-10`'s "bypass recognition" is then read as "bypass *naming*", and the spec wording is amended to say that. |
| **D-3** | **What a correction teaches** (`SR-07`) | **Save the frame as a correction shot on the right product: up to 3 per product, the oldest correction replaced first.** Enrollment shots are never touched. | A correction that learns nothing lets the same wrong lock recur. The cost is a product of up to **8 shots**, which amends `TR-42`'s cap of 5. Top-10 search stays exact while a product has ≤ 9 shots (the second-best product's best shot ranks at most shots(top-1) + 1), and P2-1 proves that with a test. Storage at the measured shot sizes is **193.6 KB median and 272.8 KB worst case** for 8 shots. `NFR-08` is worded for 5 reference photos, so it is not formally broken, but the storage intent is exceeded in the worst case. |
| **D-4** | **What "one tap" means in `SR-07`** | **Two taps: *Wrong?*, then the right product** from the likely candidates, with search and *Not in my list* on the same sheet. Amend `SR-07`'s wording. | Literal one tap means printing a second product name on every confident card. The helper reads that card at arm's length while a customer waits, and a second name is one more thing to misread. Corrections are rare; quoting is constant. |

### Engineering choices — adopted at plan approval (reopen any with a superseding ADR)

| # | Choice | Why |
|---|---|---|
| **E-1** | **Negatives get their own table, `negative_shots`**, with no name or price columns. This amends `TR-39`'s "stored in `product_shots`". Recorded as an ADR. | A negative stored as a hidden `products` row must be filtered out of every query that names a product: `getProduct`, `listProducts`, `catalogCounts`, and the `SR-23` duplicate warning. Any one filter missed names a negative, which is an `NFR-02`-class bug. A row with no name column *cannot* be named. The cost is three places that must learn about the new table: the index loader, the launch orphan sweep, and the gate check. P2-2 tests each one. If the sweep is missed, every negative's JPEG is deleted at the next launch. |
| **E-2** | **`NFR-04` is measured and recorded in Phase 2, not gate-blocking.** | This follows Phase 1's handling of `NFR-07`. ADR-016 ties any quorum change to the Phase 3 retune, so a failing p90 here should become a recorded Phase 3 input, not a mid-phase change to the stability gate. |
| **E-3** | **Defer Reanimated (`TR-18`) and zustand (`TR-15`) again**, and mark both deferred in the spec. | The overlay renders only when the lock changes, never per frame (P1-6), so Reanimated has no hot path to take over. Reanimated 4 also pins the `react-native-worklets` version that carries the camera frame processor at 0.10.1 (ADR-015). zustand would replace one React context that works. Revisit either one on a measured need. |
| **E-4** | **Delete and restore rebuild the index from SQLite.** Enrollment, corrections and negatives keep appending. | Rebuilding keeps invariant 6 ("the index is derived") trivially true with no splice code. The measured cost is 56.3 ms to read 2,500 BLOBs on the Infinix, and delete/restore are rare taps. |
| **E-5** | **Negatives and ambiguity are resolved per frame, before stability. Confirm mode is decided after the lock. `match.ts` does not change.** | Per frame, a mix of *accept(negative)* and *chips(negative, product)* votes becomes a run of Unknowns, which locks. Confirm mode depends only on catalog size, so it belongs at display time. Leaving `match()` untouched keeps the Phase 0 golden replay a valid regression test (ADR-012). |

---

## 4. The gate

Run on the **Infinix X6823, release APK, airplane mode** (`TR-53`, `SR-40`).

**Evidence:**
- **Lock log** (Phase 1).
- **Frame log** (P2-8).
- **Interaction log**, new: every Yes, No, *Not in my list*, correction, price edit, delete, undo
  and enrollment, with a time.
- **Backup screenshots**, because none of this reaches logcat in release.

All logs are held in memory for the session. None is persisted.

**A confident price** is a price shown without a question, other than one the user chose: a chip
tap, a grid tile, or *Yes*.

### Part A — upgrade, on the existing 20-product catalog

1. **Install over the Phase 1 APK.** The app reports schema 1 → 2. The Phase 1 gate check still
   passes: 20 products, 100 shots, 0 missing photos, self-match 100/100.
2. **Edit a price from the scan card** (`SR-06`), force-stop and relaunch. The scan shows the new
   price, and `price_history` holds the change.
   **Binding check:** open the editor on product X, move the phone to product Y, then save. The
   price must land on X.
3. **Correct a chip pair** (`SR-07`) — Knorr Chicken/Pork or Datu Puti Soy Sauce/Vinegar: *Wrong?*
   → the right product. After a relaunch, the gate check counts the correction shot, and its photo
   exists.
4. **Delete from the scan card** (`SR-08`). The product never locks again, and undo within 10 s
   brings it back (`SR-32`). Delete it again and let the undo lapse, then force-stop. It stays gone
   and is listed in the trash. Restore it from the trash, and it locks.
5. **Time-to-lock** (`NFR-04`, P2-8). Scan all 20 products three times each from an empty table: 60
   lock episodes. Record the median and p90. **Zero wrong locks** in the lock log, the Phase 1
   rule, which continues.

### Part B — fresh install (clear app data; this deletes the gate catalog, §2)

1. **First run** (`SR-44`, `SR-42`, `SR-43`). The language choice comes first. Deny the camera once
   with "don't ask again". The recovery screen appears, opens system settings, and after the grant
   the app returns to the flow.
2. **Enroll 5 products through the guided flow.** Each takes **≤ 30 s** from *Add* to saved,
   measured by the interaction log (`SR-25`). At least one is started from an Unknown card's Add,
   the tap Phase 1 never exercised.
3. **Confirm mode** (`SR-13`). Scan the 5 products and **at least 15 un-enrolled shelf items**.
   Pass: **zero confident prices**, because every ACCEPT is a question. Record how many un-enrolled
   items drew a question: the first store measurement of ADR-013's risk.
4. **Negatives** (`SR-14`). Every un-enrolled item that drew a question gets No → *Not in my list*.
   Then force-stop and relaunch.
   Pass when:
   - no negative is ever named, priced, or shown as a chip;
   - the negative count survives the relaunch;
   - each of the 5 products still locks or chips correctly.

   Record how many of those items now read Unknown.
5. **Quick pick** (`SR-10`). Enroll 3 repacked clear-bag products as ambiguous. Scanning any of them
   opens the grid and never names one. A tile tap shows that product's price.

**Gate:** A1–A5 and B1–B5 pass, with **zero confident wrong prices** across the whole run. Record
the result in `PROJECT_STATUS.md` with the date and device. Time-to-lock is recorded against
`NFR-04` but does not block the gate (E-2). Before `/phase-gate`, the operator reviews the new
Filipino copy, as for Phase 1 D-4.

*Amended 2026-09-15 (P2-6, ADR-023, operator's call): B2's time per product is recorded, not
gate-blocking.*
- **Measured on four runs of the guided add** (Infinix X6823, side-by-side copy). The median went
  42.6 s, 40.8 s, then 27.5 s once the form was trimmed and 3 photos were taken. The best run had 3
  of 5 products within 30 s.
- **B2 passes on its other checks:** products saved through the guided flow, at least one started
  from an Unknown card's *Add*, and each locking afterwards. The time is recorded against `SR-25`,
  as time-to-lock is recorded against `NFR-04` (E-2).
- **`SR-25` is not dropped.** It stays a MUST, marked not met in Phase 2, and the keyboard
  speed-ups are queued for Phase 4.

---

## 5. Work breakdown

Ordered so pure code is proven first, the schema change hits the real catalog early, and the
Scan tab's safety features land before the conveniences. Each step has a *done when*.

### P2-1 · Domain, test-first — no device needed

| File | Does | Requirements |
|---|---|---|
| `scanDisplay.ts` | `resolveFrame(decision, facts)`, per frame: a negative at top-1, or in a chip pair → UNKNOWN; an ambiguous product involved → `quickPick`. `displayFor(locked, liveProductCount, confirmBelow)`, after the lock: an ACCEPT becomes `quote` or `confirm`. | `SR-10`, `SR-13`, `TR-38`, `TR-39` |
| `appMeta.ts` | Parse `confirm_below`: a missing row means "always confirm" (D-1); a malformed row is refused, as τ is | `TR-38` |
| `correction.ts` | Correction-shot slots and which one is replaced (D-3). `captureStillMatches(lockedKey, captureDecision)`: the guard that stops saving a frame the phone has already moved away from. | `SR-07`, `SR-14` |
| `priceEdit.ts` | Typed text → centavos via `parsePesos`; a no-op edit writes nothing | `SR-06`, `TR-41` |
| `trash.ts` | The 10 s undo window; 30-day purge eligibility | `SR-32` |
| `firstRun.ts` | Progress from product count and the saved dismissal | `SR-44` |
| `timeToLock.ts` | Episodes from the frame log and lock log; nearest-rank median / p90 through `stats.ts` | `NFR-04` |
| `knn.ts` | A negative flag per index row. A new test: top-1 / top-2 from the 10 nearest shots equal the full ranking while a product has ≤ 9 shots, whatever the number of negatives. | `TR-30`, `TR-39`, D-3 |

- **`match.ts` does not change** (E-5). The golden replay must still reproduce Phase 0 exactly.

*Done when:* `npm test` and `npm run typecheck` pass, and the golden replay is unchanged.

### P2-2 · Schema v2 and repositories — first device checkpoint

- **Migration 2** (`TR-44`):
  - `negative_shots` (id, `photo_path`, `model_id`, `embedding` BLOB, `source`, `created_at`),
    where `source` is `confirm_no`, `wrong_lock` or `wrong_chip` (E-1).
  - `product_shots.source`, `NOT NULL DEFAULT 'enroll'`, one of `enroll`, `correction` or `teach`.
  - No `confirm_below` row (D-1).
- **Repositories.** Each write is one transaction, with photos first and rows last, as in P1-5:
  - `updatePrice`: UPDATE plus a `price_history` row.
  - `softDelete` and `restore`.
  - `purgeTrash`: rows in a transaction, then files. A kill between them leaves orphan files, which
    the launch sweep already removes.
  - `insertNegativeShot`.
  - `insertCorrectionShot`: removes the replaced correction row in the same transaction, and deletes
    its JPEG after COMMIT.
  - `setAmbiguous`, `listTrash`, `listNegatives`, `deleteNegative`.
- **The three places that must learn about `negative_shots`** (E-1), each with a test:
  - `loadVectorIndex`, with negative rows flagged;
  - `referencedPhotoPaths`, or the launch sweep deletes every negative's photo;
  - the gate check, which counts negatives and correction shots and self-matches them.
- **Test the migration SQL under `node:sqlite`.** It is built into Node: checked present on
  v24.13.1 with SQLite 3.51.2, and it prints an experimental warning. So no new dependency to audit
  (`TR-51`). The test applies v1, inserts rows, applies v2 and checks the rows survive. `npm test`'s
  glob is widened to reach it.
- **Device checkpoint:** install over the 20-product catalog. The app reports schema 1 → 2, and the
  Phase 1 gate check passes unchanged. This is gate step A1, taken early, because the real catalog
  is the migration's first real input.

*Done when:* the migration test passes locally, and the checkpoint passes on the Infinix.

### P2-3 · Scan card — confirm mode and "Not in my list" (`SR-13`, `SR-14`, `SR-03`, `SR-11`)

- **Card states:** `quote`, `confirm`, `chips`, `quickPick`, `unknown`, `scanning`.
- **The confirm card** shows the product's first enrollment photo beside *"Is this {name}?
  ₱{price}"* with **Yes / No**. The photo turns Yes into a comparison rather than a reflex (§8).
  Confidence bars stay on the card (`SR-03`).
- **Tapping freezes the card.** Any action pins the card to the product ids it showed at tap time
  and stops feeding votes, as enrollment already does. Resuming resets the stability buffer. A lock
  that changes under the tindera's finger must never redirect her tap to another product.
- ***Not in my list*** is reachable from No on a question, *Wrong?* on a quote, and *Neither* on
  chips.
  - It asks the worklet for the next frame's crop through the existing capture request, saves the
    JPEG, embeds it with the still model, inserts one row, and appends to the index after COMMIT.
  - **Guard:** if that frame no longer resolves to the lock the tindera rejected, nothing is saved,
    and the card says to hold still and try again. A negative silences whatever the frame actually
    shows, so saving the wrong frame is how a real product goes quiet.
  - The stored vector is the JPEG's, as at enrollment, so a model swap can re-embed it (`TR-24`).
- **Torch toggle** (`SR-11`) through VisionCamera's torch control. It is small and belongs on this
  screen.
- **No new per-frame work in the worklet** (`NFR-07`).

*Done when, on the Infinix:*
- a 5-product catalog asks a question for every ACCEPT;
- an un-enrolled item that draws a question → No → *Not in my list* → relaunch → reads Unknown;
- the 5 products still lock.

*Amended 2026-09-14 (operator's call): verified on the 20-product gate catalog instead of a
5-product one.*
- **Why size does not matter here:** until Phase 3 writes `confirm_below`, every ACCEPT is a question
  at any catalog size (D-1).
- **Why not clear the phone:** clearing it would delete the catalog gate Part A still needs. The
  5-product run stays in gate B3–B4.
- **Cost:** the negatives saved during this check stay in the gate catalog. The gate check counts
  them, and P2-7 can delete them.

### P2-4 · Edit, correct, delete from the scan card (`SR-06`–`SR-08`, `SR-32` undo)

- **Edit price:**
  - Tapping the price opens a numeric editor bound to the product id captured at tap time (gate A2).
  - `parsePesos`, then one transaction: UPDATE plus `price_history` (`TR-41`).
  - Both prices (*tingi* / *buo*) are editable.
- **Correct** (D-3, D-4): *Wrong?* opens a sheet with three things:
  - the likely products from the latest top 3, leaving out negatives and the rejected product;
  - a name search;
  - *Not in my list*.

  Picking a product runs the same capture guard as P2-3, then saves a correction shot.
- **Delete:**
  - Soft delete (`deleted_at`), then an index rebuild (E-4).
  - A 10 s undo bar; undo restores the product and rebuilds again.
- **`useScanner.productOf`'s cache** is keyed on `catalogVersion`. Today it assumes products never
  change, which stops being true here.
- **The stability buffer resets** after every catalog change: enrollment, delete, restore, negative,
  correction. A lock must never mix votes from two indexes.

*Done when:* gate steps A2–A4 pass on the Infinix, on the 20-product catalog.

*Amended 2026-09-14 (P2-4 build):*
- **A minimal trash list with *Restore* is pulled forward from P2-7** onto the Products tab, because
  gate A4 restores from the trash. P2-7 still owns thumbnails and the 30-day purge at launch.
- **The price is tappable only on a settled card:** a quote, the card after *Yes*, or after a chip or
  tile tap. On the question card the tindera has not yet agreed which product it is, so an edit there
  could land on the wrong one.
- **Delete sits on the price editor**, not as a third control on the card, which the helper reads at
  arm's length (§7).
- **The reject sheet moved into the panel under the camera**, where enrollment already is, so the
  search field is not hidden by the keyboard.
- **The gate panel reads out `price_history`**, as A2's evidence, because release builds do not log.

*Amended 2026-09-14 (gate A3 on device, operator's call, ADR-022):* the first build could not correct
a chip pair. The Knorr pair only ever showed chips, and the sheet opened from *Neither* refused both
chip products. The chip card's link is now *Wrong?*, and its sheet lists both chip products first.
Picking one saves a correction shot on it, through the same capture guard.

### P2-5 · Quick-pick grid (`SR-10`, `L-01`)

- **Marking a product ambiguous:** a toggle at enrollment, *"Looks like other items (repacked)"*,
  sets `is_ambiguous`. It stays editable in the Directory.
- **Per D-2:** a frame that resolves to an ambiguous product opens the grid. The grid is also a
  pinned button on the Scan tab whenever at least one ambiguous product exists.
- **A tile** shows the photo, name and price. Tapping it shows the price, as a chip tap does.
- **`SR-23` hint:** when a new product clears τ against an existing one, the duplicate warning
  offers to mark both ambiguous. A suggestion only, since `L-02` size pairs trigger it too.

*Done when:* gate step B5 passes, run early on a scratch catalog.

*Amended 2026-09-14 (P2-5 build):*
- **A tile shows the photo and name, not the price** (operator's call). Tiles are in a fixed order by
  name, with nothing highlighted, and a price appears only after a tap, as ADR-018 says. A price on
  every tile, or the bag the camera ranked first placed at the front, would hand the helper the
  answer the scanner may not give.
- **A grid lock also offers a non-repacked product the frame chipped with a bag**, in the same name
  order. The frame was close to it too.
- **The grid has no *Wrong?* and no *Not in my list*.** Nothing on it is named. A negative saved from
  a clear bag would also silence every look-alike bag, because a negative outranks ambiguity (E-5).
- **Marking the look-alikes runs inside the enrollment transaction** (`TR-45`), and it skips the
  *Save anyway?* alert.
- **Voting pauses while the pinned grid is open**, as for the other panels. A grid lock does not
  pause voting, and a tile choice survives while the grid stays locked.

*Amended 2026-09-14 (operator's call): B5's early run uses the gate catalog, not a scratch one.*
- **The run:** enroll the 3 repacked bags into the 20-product catalog, run B5, then delete all 3.
- **Why this is safe for gate A5:** deleted products leave the search index (E-4), so A5 still
  scans the same 20.
- **Why not a scratch catalog:** it would mean clearing app data, and then a backup and restore of
  the only gate catalog.
- **Costs:**
  - The trashed bags' rows and photos stay until P2-7's purge, and the gate check's shot count
    includes them.
  - During B5, the look-alike offer must not be accepted for any of the 20 gate products.
- Gate part B still runs B5 again on the fresh install.

### P2-6 · First run, permission recovery, guided enrollment (`SR-44`, `SR-43`, `SR-20`, `SR-22`, `SR-25`)

- **The flow**, shown on an empty catalog:
  1. Welcome.
  2. Language (`SR-42`).
  3. Why the camera is needed, then the OS prompt.
  4. If the prompt is denied or blocked: a recovery screen that opens system settings through
     `Linking.openSettings()`. That is React Native core and opens a system screen, not a network
     connection (`SR-43`).
  5. Guided add ×5, with progress (*2 of 5*), the framing coach (*"isang item lang sa loob ng
     kahon"*, ADR-006), and a different angle prompted per shot (`SR-20`).
  6. After the first product, *"try scanning it"*, which teaches the Yes / No card on something
     real.
  7. A one-line explanation of why the app asks while the list is small.
- ***Finish later* is allowed.** An *n of 5* banner stays until five products exist. The dismissal
  is saved in `app_meta`, as `ui_language` is.
- **Quality warnings (`SR-22`)** on each saved JPEG, on the JS thread (enrollment is exempt from
  `TR-25`):
  - too dark and blown out, from mean luminance;
  - blurred, from `laplacianVariance`.

  Both thresholds are **uncalibrated placeholders** (`TR-27`'s floor is 0), so they warn and never
  block.
- **Enrollment time** from *Add* to saved goes to the interaction log (`SR-25`).

*Done when:* gate steps B1 and B2 pass on a cleared install.

*Amended 2026-09-15 (P2-6 build):*
- **B1–B2 run on a side-by-side install, not a cleared gate app** (operator's call).
  `com.jash.bantaynimama.fresh` has its own data and camera permission, so both steps get an empty
  catalog while the 20-product catalog waits for A5 (`TOOLING.md`). Gate part B still clears the real
  app at P2-9.
- **Photos come before the form.** The camera is already on the item when *Add* is tapped, and the
  duplicate warning (`SR-23`) then appears before a name is typed.
- **The Scan tab no longer asks for the camera on mount.** A prompt with no reason on screen is what
  step 3 replaces.
- **On Android 11+, "don't ask again" is a second denial.** The dialog has no checkbox, so gate B1
  denies twice.
- **The quality limits are placeholders** (`shotQuality.ts`). The gate panel records each shot's
  luminance and sharpness for Phase 3.
- **The intro survives being killed in system settings** (device attempt 1, operator's call). On the
  Infinix, Android killed the app 4 s after Permissions opened. Reaching the camera step is saved in
  `app_meta` (`first_run_intro`), so a relaunch resumes there instead of at the welcome.
- **The interaction log still dies with the process** (§7 is unchanged). So B1's permission steps
  are also read from the system log (`adb logcat -b events`: `GrantPermissionsActivity` and
  `APPLICATION_DETAILS_SETTINGS`). B2's times need the app kept running until the gate panel is read.

*Amended 2026-09-15 (gate B2 attempt 2 missed `SR-25`, operator's call):*
- **Measured:** 6 products at 38–56 s each, median 42.6 s, against 30 s. Nothing between *Add* and
  save was logged, so the slow part is unknown.
- **The guided form shows only `SR-21`'s required fields**, name and price per piece. Pack price, unit
  and category sit behind *More details*, and a bad pack price opens it. Outside the guided flow the
  form is unchanged. The *repacked* toggle stays in view, because a clear bag saved without it can be
  named as another bag (ADR-018).
- **Step timings:** each photo added (`enrollPhoto`) and each product's first keystroke
  (`enrollTyping`) go to the interaction log. The gate panel splits each product into *Add* → first
  photo, the photos, and last photo → saved.
- **B2 is re-run on a cleared fresh copy**, with 3 photos per product where 5 are not needed
  (`SR-20` allows 3–5).

### P2-7 · Products tab becomes the Directory (`SR-30`–`SR-35`)

- **List and edit:**
  - Search by name (`SR-30`), with thumbnail, name and price.
  - Edit every field (`SR-31`); a price edit writes `price_history`.
- **Trash (`SR-32`):** a trash view with restore. The purge after 30 days runs at launch, beside
  the orphan sweep.
- **Teach again (`SR-33`):** adds `teach` shots up to the product's cap.
- **Sort (`SR-34`):** by name, recently added, or recently scanned. `last_scanned_at` is written
  once per lock change, never per frame.
- **Storage used by photos (`SR-35`).**
- **The *Not in my list* items**, with thumbnails and delete. This is the undo when a tindera marks
  one of her own products by mistake.
- **The gate check** stays, collapsed, as a regression tool.
- **If Phase 2 runs long, cut these first:** `SR-34`, `SR-35` (both SHOULD).

*Done when:* each requirement is exercised on the Infinix, and changes survive a force-stop.

### P2-8 · Time-to-lock, measured (`NFR-04`)

**The problem:** the app cannot see the moment a product enters the reticle, so it needs a
start-time proxy, calibrated once against video.

- **Frame log:** every processed frame's vote and time, in a ring buffer in memory, beside the lock
  log.
- **Episode:** from an Unknown lock (the empty table) to the next ACCEPT or chips lock.
  - `t_lock` is the lock event.
  - `t_seen` is the first frame in the episode whose decision is not UNKNOWN.
- **The proxy under-reads, in two ways:**
  - It misses frames where the product is already in view but below τ, such as when it is moving in
    or blurred.
  - If frames are stamped when they arrive on the JS thread, it misses the first frame's worklet
    time: 124.7 ms median in P1-6.

  So stamp each frame in the worklet, when captured. First check that the worklet's clock matches
  the JS thread's before subtracting one from the other. If it does not, report the offset rather
  than hide it.
- **Calibration:**
  - Record 20 episodes with `adb shell screenrecord` (over USB, no network). Read `t_enter`
    frame by frame, and report the proxy's bias.
  - Screen recording encodes video on the same chip, so also compare the proxy p90 with and without
    recording. If recording slows scanning, the calibration is not trusted.
- **Readout** in the gate panel: n, median and p90 of the proxy, and p90 corrected for the bias.
  Recorded from screenshots (P1-7).
- **Informational:** in confirm mode, lock → Yes tap, which is the time until the helper can quote.
  It is not part of `NFR-04`.
- **What to expect, computed and not measured:**
  - A clean lock is 4 agreeing frames at 4 fps: ~750 ms from the first agreeing frame, plus one
    frame's processing, so ≈ 0.9–1.0 s.
  - Each disagreeing frame adds 250 ms. A p90 of 1.2 s therefore tolerates about one.
- **If p90 exceeds 1.2 s:** record it, and do not change the quorum in Phase 2 (E-2, ADR-016).

*Done when:* the proxy and its calibration are recorded in `ARCHITECTURE.md` §3 and §8 and
`PROJECT_STATUS.md`, with device and n.

### P2-9 · Gate run

1. The operator reviews the new Filipino copy.
2. Run §4 on the device, in airplane mode.
3. Run `/phase-gate`.

---

## 6. Not in Phase 2

| Deferred | To | Why |
|---|---|---|
| τ/δ retune, `NFR-01` / `NFR-03`, `confirm_below` value (Q-5), bundled distractor bank (ADR-013) | Phase 3 | Needs store data |
| Sharpness gate in the worklet (`TR-27`) | Phase 3 | 20.9 ms per frame, and it did not separate wrong votes (ADR-016) |
| Native vector search (`NFR-09`, ADR-014), `NFR-07` latency, GPU vector agreement | Phase 3 | Not UI work |
| Export / import (`SR-45`) | Phase 4 | |
| Reanimated (`TR-18`), zustand (`TR-15`) | On measured need | E-3 |
| A PIN or roles for price edits | Not planned | Not in the spec; see §8 |

---

## 7. Design questions the build must settle (engineering)

- **Card legibility.** The helper reads it at arm's length on a 720p budget screen. Check it on the
  Infinix with the operator; do not judge it on a laptop emulator.
- **Negatives and search cost.** Every negative is one more matrix row. Search measured 8.52 ms at
  100 shots. The gate readout shows the negative count, and no cap is set until growth is measured.
- **A chip tap stays price-only; it teaches nothing.** Learning from chip taps would fill the
  correction slots on `L-02` size pairs, where more shots cannot help.
  *Amended 2026-09-14 (ADR-022, operator's call):* a chip **tap** still teaches nothing, but the
  chip card's *Wrong?* sheet can now save a correction on either product of the pair. Without it,
  gate A3 could not be run: the Knorr pair only ever chipped.
- **The interaction log is not persisted.** It is a measurement aid for the gate, not user
  behaviour kept on the phone (`TR-52`'s spirit).

---

## 8. Risks

| Risk | Status | Phase 2 action |
|---|---|---|
| **Reflexive Yes.** Confirm mode protects only if the helper looks before tapping. | Cannot be measured with an operator who knows the products | Show the enrollment photo on the question. Record it as a known limit until a store trial. |
| **A negative silences a real product** | New with `SR-14` | The capture guard (P2-3), the negatives list with delete (P2-7), and gate B4's re-scan of enrolled products |
| **Anyone holding the phone can change a price** | No accounts by design (`TR-50`) | `price_history` keeps every change, and delete has undo. A local PIN would not break `TR-50`, but it is not in the spec: flag it, do not build it. |
| **Migration 2 on the only copy of the gate catalog** | Accepted (§2) | Test under `node:sqlite` before the device; checkpoint first in P2-2 |
| **Always-confirm makes every scan a tap** (if D-1 is accepted) | Acceptable until Phase 3 calibrates `confirm_below` | Record lock → Yes time (P2-8), so the cost is a number |
| **Look-alike confusion persists** | Carried | Corrections add shots, but the two cans already score each other up to 0.76. Do not claim a fix. Phase 3. |
| **Scope.** Nine steps, including the whole Directory. | Plan-level | Cut `SR-34`, `SR-35`, `SR-22` and `SR-11` (all SHOULD) first |
| **Filipino copy grows several-fold** | Plan-level | Claude drafts, the operator corrects before `/phase-gate` |

---

## 9. Measurements Phase 2 records

| What | Where it goes |
|---|---|
| Time-to-lock: n, median, p90, and the proxy's calibration bias (`NFR-04`) | `ARCHITECTURE.md` §3 and §8, `PROJECT_STATUS.md` |
| Enrollment time per product (`SR-25`) | `PROJECT_STATUS.md` |
| Un-enrolled items that drew a question, at 5 products | `ARCHITECTURE.md` §6, `PROJECT_STATUS.md`. Per item and after stability, so **not** directly comparable to the simulation's 15.1% per frame; say so wherever it appears. |
| Items reading Unknown after being marked *Not in my list* | same |
| Index rebuild time after delete and restore | `ARCHITECTURE.md` §8 |
| Migration 1 → 2 on the real catalog | `PROJECT_STATUS.md`, `CHANGELOG.md` |

All on the Infinix X6823, release APK, named in every row.

---

## 10. Docs updated on approval

- [x] `CLAUDE.md` — this plan added to the *Read first* table *(2026-09-14, at draft)*
- [x] `PROJECT_STATUS.md` — Phase 2 checklist, next action, §4's gate wording *(2026-09-14)*
- [x] `PROJECT_SPECS.md` — header moved to Phase 2. Amendments: `TR-38` (D-1), `SR-10` (D-2), `TR-42` (D-3), `SR-07` (D-4), `TR-39` (E-1). `TR-15` and `TR-18` marked deferred (E-3). *(2026-09-14)*
- [x] `DECISIONS.md` — ADR-017 (D-1, E-1, E-5), ADR-018 (D-2), ADR-019 (D-3, D-4), ADR-020 (E-3) *(2026-09-14)*
- [x] `ARCHITECTURE.md` §2 — the UI-thread row no longer names Reanimated (ADR-020) *(2026-09-14)*
- [ ] `ARCHITECTURE.md` — §5 schema v2 when P2-2 lands, §6 display step when P2-1 lands, §7 layout as files appear. *§6 display step and §7's P2-1 domain files done (2026-09-14). §5 schema v2, repositories and invariants done at P2-2 (2026-09-14).*
- [x] `CHANGELOG.md` — plan entry with the settled decisions *(2026-09-14)*
