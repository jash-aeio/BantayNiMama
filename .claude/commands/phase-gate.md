---
description: Evaluate the current phase's exit criteria against measured evidence
allowed-tools: Read, Edit, Bash(git log:*), Bash(npm test:*), Bash(npm run typecheck:*)
---

Evaluate whether the current phase has actually cleared its gate.

Phase to evaluate (default: the current phase in PROJECT_STATUS.md): $ARGUMENTS

## Steps

1. Read `docs/PROJECT_STATUS.md` for the current phase and its gate.
2. Read `docs/PROJECT_SPECS.md` §5 for the relevant NFR targets.
3. For each gate criterion, find the **measured evidence** — a recorded number in
   `PROJECT_STATUS.md`, a passing test, a logged device measurement.
4. Produce a verdict table:

   | Criterion | Target | Measured | Evidence | Verdict |
   |---|---|---|---|---|

5. Give one of three verdicts:
   - **PASS** — every criterion has measured evidence meeting its target.
   - **FAIL** — a criterion was measured and missed. State the remediation path from
     `PROJECT_STATUS.md`.
   - **UNPROVEN** — a criterion has no measurement yet. This is **not** a pass. Name exactly what
     must be measured.

6. On PASS, update the phase table in `docs/PROJECT_STATUS.md` to 🟢 and set the next phase to 🔵.

## Rules

- **An unmeasured criterion is never a pass.** Estimates, expectations and "should be fine" do not
  count as evidence.
- Do not advance the phase on a FAIL or UNPROVEN verdict.
- For Phase 0 specifically: the gate is ≥85% top-1 on non-ambiguous items, computed over a labeled
  frame set of ~100 frames. Accuracy claimed from casual testing is not a measurement.
- Name the device any latency or battery number was measured on.
