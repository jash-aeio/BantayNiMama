---
description: Record Phase 0 measurement results into the project docs
allowed-tools: Read, Edit, Write, Bash(node:*)
---

Record the results of a Phase 0 embedding viability run.

Raw results (paste accuracy numbers, score distributions, device, or a path to a results file):
$ARGUMENTS

## Steps

1. If given a results file, read it. If given raw numbers, use them as stated. **Never invent or
   interpolate a number that was not provided.**

2. Compute and report:
   - Top-1 and top-3 accuracy over all labeled frames
   - Top-1 accuracy over **non-ambiguous items only** — this is what the gate measures, since
     `L-01` and `L-02` items are known-unsolvable and must not count against the model
   - Per-item accuracy, so the specific failures are visible
   - The score distribution for true matches vs. false matches

3. **Derive τ and δ from the distributions, not by guessing:**
   - `τ` — the similarity floor that admits ≥95% of true matches while excluding as many
     un-enrolled items as possible. Bias toward precision: `NFR-02` outranks `NFR-01`.
   - `δ` — the top1−top2 margin that separates correct matches from near-identical-variant
     confusions (Palmolive green vs pink, Kopiko 3-in-1 vs 2-in-1).

4. Update `docs/PROJECT_STATUS.md`:
   - Fill the **Measured results** table with real numbers and the date
   - Name the device each latency figure came from
   - Tick the completed Phase 0 checklist boxes
   - Resolve Q-1 and Q-2 in "Decisions pending"

5. Update `docs/ARCHITECTURE.md` — fill the **Measured** column in §8 Performance Budget.

6. Add a `docs/CHANGELOG.md` entry under `[Unreleased] → Added`.

7. State the gate verdict plainly: **≥85% top-1 on non-ambiguous items, pass or fail.**

## If the gate fails

Do not propose proceeding to Phase 1. Work the remediation ladder from `PROJECT_STATUS.md` in order:
1. Tighten reticle guidance and re-shoot — framing is a bigger accuracy lever than model choice.
2. Try MobileCLIP via `react-native-executorch`, accepting the JS-thread architecture cost (ADR-002).
3. Reconsider the product thesis.

Report which rung you are on and why.
