#!/usr/bin/env node
/**
 * doc-guard — Stop hook for BantayNiMama.
 *
 * Fires when Claude finishes a turn. If source files changed in the working tree but the
 * documentation that must track them did not, block once with a reminder listing exactly
 * what is missing.
 *
 * Contract (Claude Code hooks):
 *   stdin  — JSON, includes `stop_hook_active`
 *   exit 0 — allow stop
 *   exit 2 — block; stderr is fed back to Claude as the reason
 *
 * Loop safety: if `stop_hook_active` is true we have already blocked once this turn, so we
 * always allow the stop. This hook can never fire twice in a row.
 */

import { execSync } from "node:child_process";

const read = () =>
  new Promise((resolve) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => resolve(raw));
    setTimeout(() => resolve(raw), 1500); // never hang the session
  });

const git = (args) => {
  try {
    return execSync(`git ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
};

const main = async () => {
  let payload = {};
  try {
    payload = JSON.parse((await read()) || "{}");
  } catch {
    /* malformed payload — fall through to the check */
  }

  // Already blocked once this turn. Let it stop.
  if (payload.stop_hook_active) process.exit(0);

  // --untracked-files=all is required: without it git collapses a new directory to "src/",
  // which would hide src/db|ml|domain paths and silently skip the ARCHITECTURE.md check.
  const status = git("status --porcelain --untracked-files=all");
  if (!status.trim()) process.exit(0); // nothing changed at all

  const files = status
    .split("\n")
    .map((l) => l.slice(3).trim())
    // Renames arrive as "old -> new"; keep the destination path.
    .map((f) => (f.includes(" -> ") ? f.split(" -> ")[1] : f))
    .map((f) => f.replace(/^"|"$/g, "")) // git quotes paths containing spaces
    .filter(Boolean);

  const isSource = (f) =>
    /^(src|app)\//.test(f) ||
    /^(package\.json|app\.json|app\.config\.[jt]s|tsconfig\.json)$/.test(f);

  const touchedSource = files.filter(isSource);
  if (touchedSource.length === 0) process.exit(0); // docs-only or config-only change

  const touched = (name) => files.some((f) => f.endsWith(name));

  const missing = [];
  if (!touched("CHANGELOG.md")) missing.push("docs/CHANGELOG.md — add an entry under [Unreleased]");
  if (!touched("PROJECT_STATUS.md")) missing.push("docs/PROJECT_STATUS.md — refresh phase, blockers, checklist");

  // Schema, pipeline, dependency or matching-policy changes must also touch ARCHITECTURE.md.
  const architectural = touchedSource.some((f) =>
    /^src\/(db|ml|domain)\//.test(f) || /^package\.json$/.test(f)
  );
  if (architectural && !touched("ARCHITECTURE.md")) {
    missing.push("docs/ARCHITECTURE.md — schema/pipeline/deps changed; keep the SQL, diagram and invariants true");
  }

  if (missing.length === 0) process.exit(0);

  const preview = touchedSource.slice(0, 8).join(", ");
  const more = touchedSource.length > 8 ? ` (+${touchedSource.length - 8} more)` : "";

  process.stderr.write(
    `Documentation is out of sync with the code you just changed.\n\n` +
      `Changed source: ${preview}${more}\n\n` +
      `Still to update:\n` +
      missing.map((m) => `  - ${m}`).join("\n") +
      `\n\nSee CLAUDE.md "Documentation maintenance". Cite requirement IDs (SR-/TR-/NFR-) in the ` +
      `changelog entry. If this change genuinely needs no doc update — a pure refactor with no ` +
      `behaviour change — say so explicitly and stop.\n`
  );
  process.exit(2);
};

main();
