---
description: Run the documentation update checklist after finishing a feature
allowed-tools: Read, Edit, Write, Bash(git status:*), Bash(git diff:*), Bash(git log:*)
---

A feature was just completed. Bring the documentation back in sync before anything else.

Feature context (may be empty — infer from the diff if so): $ARGUMENTS

## Steps

1. Run `git status --porcelain` and `git diff --stat` to see exactly what changed.

2. **`docs/CHANGELOG.md`** — add an entry under `[Unreleased]` in the correct subsection
   (Added / Changed / Fixed / Removed). Cite the requirement IDs this satisfies (`SR-`, `TR-`,
   `NFR-`). Skip only if this was a pure refactor with no behaviour change — and say so if you skip.

3. **`docs/PROJECT_STATUS.md`** — update the "Right now" table, tick any completed phase-checklist
   boxes, and revise blockers. Keep it a dashboard: no narrative.

4. **`docs/ARCHITECTURE.md`** — update only if the schema, pipeline, matching policy, threading
   model, or a core dependency changed. Keep the SQL block, the pipeline diagram and the invariants
   literally true. If you measured latency, fill the **Measured** column with the real number and
   name the device.

5. **`docs/PROJECT_SPECS.md`** — update only if scope, a requirement, or a limitation changed.
   Never silently drop a requirement; mark it deferred with a reason.

6. **`docs/DECISIONS.md`** — add an ADR only if you made a choice a future reader might reverse by
   accident. Supersede, never rewrite, an accepted ADR.

7. Report a one-line summary of which documents you changed and which you deliberately skipped.

## Rules

- Measurements, never estimates. If a number is a guess, label it a guess.
- Do not mark a phase gate passed without the measurement that proves it.
- Do not invent requirement IDs. If one is missing from `PROJECT_SPECS.md`, add it there first.
