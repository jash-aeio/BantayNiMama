# Project Status

> **Claude: update this file at the end of any session that changes what is built, blocked, or
> decided.** Keep it short — it is a dashboard, not a journal. The journal is `CHANGELOG.md`.

**Last updated:** 2026-09-13
**Current phase:** Phase 0 — Embedding Viability Spike
**Overall health:** 🟡 Unvalidated — the core thesis has not yet been tested

---

## Right now

| | |
|---|---|
| **Working on** | Phase 0 spike — **release APK runs untethered and loads the model** (2026-09-13). Awaiting store data. |
| **Next action** | Enroll ~20 products × 3–5 shots (A-3) — 8 products × 1 shot so far; undo/delete controls installed (2026-09-13), then ~100 labeled test frames (A-4) — **on a shelf, not at a desk**. See [`PHASE_0_RUNBOOK.md`](./PHASE_0_RUNBOOK.md). |
| **Blocked on** | Reference shots of ~20 real products (A-3), then ~100 labeled test frames (A-4). Nothing technical is blocking. |
| **Watch out for** | Per-frame latency **140–248 ms** vs a 25–40 ms budget — `NFR-07` is not met. Does not block the accuracy gate; see `ARCHITECTURE.md` §8. Release build is **not** materially faster (on-screen spot readings 140.7 / 144.0 ms), so the debug figure stands until a dataset run replaces it. |
| **Known soft spot** | If enrollment is shot at a desk rather than on a shelf, the gate number is optimistic and Phase 3 will regress against it. Record the capture setting alongside the number. |
| **Biggest risk** | Q-1 — unproven that a generic embedding model separates sari-sari SKUs |

---

## Phase progress

| Phase | Name | Status | Gate |
|---|---|---|---|
| **0** | Embedding viability spike | 🔵 In progress | ≥ 85% top-1 on non-ambiguous items |
| 1 | Proof of concept — real data path | ⚪ Not started | Enroll 20 → force-quit → relaunch → scan all 20 |
| 2 | UI / UX | ⚪ Not started | — |
| 3 | ML integration & accuracy | ⚪ Not started | NFR-01 ≥ 90%, NFR-02 ≤ 2% |
| 4 | Polish & ship | ⚪ Not started | All NFRs met on a real device |
| 5 | Post-MVP | ⚪ Deferred | — |

Legend: ⚪ not started · 🔵 in progress · 🟢 passed gate · 🔴 gate failed

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
- [ ] ~20 reference products captured — including the near-identical pairs:
  - [ ] Two Nissin ramen variants (same brand, different variant)
  - [ ] Creamy white solo vs twin pack (tests L-02)
  - [ ] ~~Two repacked clear bags (L-01)~~ — not in the set on hand; L-01 stays unmeasured
- [x] In-JS cosine match, top-3 printed on screen with scores
- [ ] ~100 labeled test frames collected
- [x] Top-1 / top-3 accuracy computed — `scripts/analyze.mjs`, verified on synthetic data (PASS and FAIL paths)
- [x] Score histogram produced; **τ and δ read off it** — sweep implemented, constrained to the NFR-02 ceiling
- [ ] **GATE:** ≥ 85% top-1 on non-ambiguous items

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
| Top-1 accuracy (non-ambiguous) | ≥ 85% | — | — |
| Top-3 accuracy | — | — | — |
| τ (tau) | — | — | — |
| δ (delta) | — | — | — |
| Embedding dimensionality | assumed 1024 | **1280** | 2026-09-13 |
| Per-frame worklet latency, budget Android | 25–40 ms | **140–248 ms, median ~148** — Infinix X6823 (Unisoc T616, armeabi-v7a), **debug build**; covers crop+resize+inference+L2 as one | 2026-09-13 |
| Same, release build | 25–40 ms | **140.7 and 144.0 ms** — same device, release APK. Two on-screen readings only, not a dataset run; enough to show the release build is not materially faster, not enough for a distribution. | 2026-09-13 |
| Inference latency, iOS | 8–15 ms | — | — |

---

## Decisions pending

| # | Question | Owner | Needed by |
|---|---|---|---|
| Q-1 | Does MobileNetV3 clear the 85% gate? | Phase 0 measurement | Now |
| Q-2 | Empirical τ and δ | Phase 0 measurement | Now |
| Q-3 | MobileCLIP vs MobileNetV3 | Phase 3 bake-off | Phase 3 |
| Q-4 | INT8 accuracy cost | Phase 3 | Phase 3 |

---

## Known limitations accepted

These are **not bugs**. See `PROJECT_SPECS.md` §8.

- **L-01** Repacked clear-bag goods are indistinguishable → quick-pick grid
- **L-02** Same product, different size → disambiguation chip
- **L-03** Device loss = catalog loss → export ships Phase 4
- **L-04** Deformable packaging recognizes less reliably
