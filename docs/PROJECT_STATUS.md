# Project Status

> **Claude: update this file at the end of any session that changes what is built, blocked, or
> decided.** Keep it short — it is a dashboard, not a journal. The journal is `CHANGELOG.md`.

**Last updated:** 2026-09-12
**Current phase:** Phase 0 — Embedding Viability Spike
**Overall health:** 🟡 Unvalidated — the core thesis has not yet been tested

---

## Right now

| | |
|---|---|
| **Working on** | Project setup and documentation |
| **Next action** | Scaffold the Phase 0 spike app |
| **Blocked on** | Reference photos of ~20 real products, shot in an actual sari-sari store |
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

- [ ] Expo SDK 55 dev-client project created
- [ ] Development build running on a physical device
- [ ] VisionCamera preview with a center reticle
- [ ] `react-native-fast-tflite` loading the MobileNetV3 embedder
- [ ] 1024-d vector logged from a live frame
- [ ] ~20 reference products captured **in a real store** — including the nasty cases:
  - [ ] Two Palmolive sachet variants (near-identical colours)
  - [ ] Kopiko 3-in-1 vs 2-in-1
  - [ ] 250 ml and 1 L Coke (tests L-02)
  - [ ] Two repacked clear bags (tests L-01)
- [ ] In-JS cosine match, top-3 printed on screen with scores
- [ ] ~100 labeled test frames collected
- [ ] Top-1 / top-3 accuracy computed
- [ ] Score histogram produced; **τ and δ read off it**
- [ ] **GATE:** ≥ 85% top-1 on non-ambiguous items

### If the gate fails

Do **not** proceed to Phase 1. In order:
1. Tighten reticle guidance and re-shoot — framing is a bigger lever than model choice.
2. Try MobileCLIP via `react-native-executorch` (accepts a JS-thread architecture cost).
3. Reconsider the product thesis.

---

## Measured results

_Empty until Phase 0 runs. **Claude: record real numbers here, never estimates.**_

| Metric | Target | Measured | Date |
|---|---|---|---|
| Top-1 accuracy (non-ambiguous) | ≥ 85% | — | — |
| Top-3 accuracy | — | — | — |
| τ (tau) | — | — | — |
| δ (delta) | — | — | — |
| Inference latency, budget Android | 25–40 ms | — | — |
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
