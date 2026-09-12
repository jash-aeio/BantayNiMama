# CLAUDE.md — BantayNiMama

Offline-first visual price scanner for Philippine sari-sari stores. React Native + Expo,
on-device image embeddings, local vector search. **No backend, ever.**

---

## Read first

| Document | When to read it |
|---|---|
| [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) | **Every session.** Current phase, blockers, what's next. |
| [`docs/PROJECT_SPECS.md`](docs/PROJECT_SPECS.md) | Before implementing anything. Requirement IDs live here. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Before touching the pipeline, schema, or matching policy. |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Before changing a core dependency or architectural approach. |

---

## Non-negotiable rules

These come from the spec. Violating one is a bug even if the code works.

1. **No network I/O. Ever.** No backend, no API keys, no auth, no telemetry, no crash-reporting
   upload (`TR-50`, `TR-51`, `SR-41`). Before adding any dependency, check whether it phones home.
   If a feature seems to require a network call, it is out of scope — say so.
2. **Money is integer centavos.** ₱12.50 is `1250`. Floats for currency are forbidden everywhere
   except the final render (`TR-41`, ADR-007).
3. **Inference runs in the worklet, never on the JS thread** during live scanning (`TR-25`).
   Enrollment is exempt.
4. **τ and δ are read from `app_meta`, never hard-coded** (`TR-35`, ADR-008).
5. **Photo paths are relative to `documentDirectory`** (`TR-43`). Absolute paths break silently
   after an iOS app update.
6. **Every stored vector is stamped with its `model_id`** (`TR-23`). Never delete reference JPEGs —
   they are the only way to re-embed after a model swap (`TR-24`).
7. **Precision beats recall.** `NFR-02` (≤2% false positives) outranks `NFR-01` (≥90% accuracy).
   When tuning, always prefer "Unknown" over a guess. A wrong price quoted confidently costs the
   store money and trust.
8. **Enrollment is one transaction** (`TR-45`). A product with vectors but no metadata produces
   confident matches against something that does not exist.

---

## Documentation maintenance — required

**Documentation is part of the feature, not a follow-up.** A feature is not complete until the docs
below reflect it. A `Stop` hook will remind you; treat the reminder as blocking.

### After completing any feature or fix

| Update | When | What |
|---|---|---|
| **`docs/CHANGELOG.md`** | Always | An entry under `[Unreleased]` in the right subsection (Added/Changed/Fixed/Removed), citing requirement IDs. Skip only for pure refactors with no behaviour change. |
| **`docs/PROJECT_STATUS.md`** | Always | Current phase, "Right now" table, phase checklist boxes, blockers. Keep it a dashboard, not a journal. |
| **`docs/ARCHITECTURE.md`** | If you changed the schema, pipeline, matching policy, threading model, or a core dependency | Keep the SQL, the pipeline diagram and the invariants true. Fill the **Measured** column with real numbers as they arrive — never leave estimates there once measurements exist. |
| **`docs/PROJECT_SPECS.md`** | If scope, a requirement, or a limitation changed | Add or amend the `SR-`/`TR-`/`NFR-` entry. Never silently drop a requirement — mark it deferred and say why. |
| **`docs/DECISIONS.md`** | If you made a contested choice | A new ADR. Never edit an accepted ADR to change its meaning — supersede it. |

You can run `/feature-done` to walk this checklist.

### Rules for writing docs

- **Record measurements, never estimates.** If a number came from a guess, label it as an estimate.
  If it came from a device, say which device.
- **Cite requirement IDs.** `SR-02`, `TR-32`, `NFR-06` — they are stable and they make the docs
  navigable.
- **Never mark a phase gate passed without the measurement that proves it.**
- Keep `PROJECT_STATUS.md` short. History belongs in `CHANGELOG.md`.

---

## Code conventions

- **TypeScript `strict: true`.** No `any` without a comment explaining why.
- **`src/domain/` is pure.** No I/O, no native modules, no React. Everything there gets unit tests.
  If logic can be pure, put it there — it is the only part testable without a device.
- Native/camera/DB layers stay thin and delegate to `src/domain/`.
- **Worklet code must carry the `'worklet'` directive** and must not touch React state or async JS.
- **Every user-facing string goes through i18n** (`en` + `fil`). No hardcoded copy in components —
  including error messages (`SR-42`).
- Filipino retail terms (*tingi*, *buo*, *tindera*) are domain vocabulary. Use them in code and copy
  where they are the accurate word.
- Prefer `INTEGER` columns and explicit transactions in SQL. Name migrations by `schema_version`.

## Testing

- `src/domain/` — unit tested, no device required. This is where the matching policy lives, so this
  is where recognition correctness is actually proven (`TR-37`).
- Integration — enroll → force-quit → relaunch → scan, on a **physical device**. SQLite persistence
  is the thing under test.
- **The full suite must pass in airplane mode** (`TR-53`).
- Never claim a performance number without measuring it on a real device; name the device.

---

## Working style for this project

- The developer is learning mobile and ML alongside this build. When you make a non-obvious
  choice — a worklet boundary, a threshold, a transaction — **say why in one or two sentences**.
  Not a tutorial, just the reasoning.
- **Phase 0 is throwaway code by design.** Do not polish it, do not add tests to it, do not
  generalise it. Its only job is to answer whether the recognition thesis holds.
- Do not start the next phase before the current phase's gate has been measured and recorded.
- Flag honestly when something is a known limitation (`L-01`–`L-04`) rather than working around it.
  Two of them are genuinely unsolvable; pretending otherwise ships a feature that fails silently.

## Commands

```bash
npm run typecheck     # tsc --noEmit
npm test              # domain unit tests
npx expo start --dev-client   # requires a development build; Expo Go will NOT work (TR-03)
```

## Project slash commands

- `/feature-done` — run the documentation update checklist after finishing a feature
- `/phase-gate` — evaluate the current phase's exit criteria against measured evidence
- `/spike-report` — record Phase 0 measurement results into the docs
