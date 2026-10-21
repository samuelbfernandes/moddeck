---
name: review
description: Use after implementing a change, before commit or push, or when asked to review, "check this" or get a second opinion. Quick self-review for ordinary code; a different model (Codex or a fresh read-only Claude) is mandatory for genetics, statistics, methods, equations, DAG semantics or code generation. Not for pure docs or formatting changes.
---

# Review

**The implementer is never its own reviewer for theory.** Choose the depth first and say it in one line.

| The change | Depth |
|---|---|
| Genetics, quantitative genetics (effects, selection, meiosis, variance partitioning, heritability, BLUP/GBLUP), a method, a cited equation, DAG semantics, code generation. If unsure whether it is theory, treat it as theory. | **second model** (below) |
| Ordinary code: a bug fix, a feature, a refactor | **quick review** |
| Docs or formatting only | none |

## Quick review (read-only, in this session)
1. `git diff --staged` or `git diff <base>...HEAD`; note the files and what the change claims to do.
2. Look for: bugs and edge cases (empty, one element, NA, off-by-one), missing or weak tests, contradictions with
   `AGENTS.md`, secrets, and anything bigger than the task needs (keep diffs small).
3. Report findings as `file:line`, most serious first, and what you did **not** check. Do not edit anything; propose fixes.
4. Run the project's tests and report the real result.

## Second-model review
1. **Freeze the change.** Identify the exact diff and the claim ("this implements equation X from <source>").
2. **Pick the reviewer, never yourself.**
   - A push already triggers this for repos with `docs/THEORY_REVIEW.md` (or `git config toolkit.theoryPaths`): the global
     pre-push hook has Codex review the pushed diff read-only and blocks on FAIL. Use this skill for an earlier or deeper
     review, or where that hook is not active.
   - If the repo has `dev/dual.sh`, use it: `dev/dual.sh review --staged` (or `<paths>`). Read `dev/README.md` first.
   - Codex CLI (flags checked against 0.162.0): read-only structured review of a diff:
     `git diff --staged | codex exec -s read-only --ephemeral -C <repo> --output-schema ~/.claude/moddeck/global/theory-review.schema.json -o "$TMPDIR/review.json" "<reviewer prompt>"`.
     Quick unstructured pass: `codex review --uncommitted` (or `--base <branch>`, `--commit <sha>`). `-s workspace-write` only in a
     throwaway worktree (`git worktree add ../_review <rev>`, `TMPDIR` inside it) when the reviewer must run R for executed evidence.
   - If the Codex plugin is installed, `/codex:adversarial-review` with focus text also works. Never `/codex:rescue` (it edits files).
   - Else spawn a fresh read-only Claude subagent (no edit tools) with the prompt below.
   - If none is possible, **stop and say the change is UNREVIEWED**. Do not self-approve.
3. **Reviewer prompt** (adapt the bracketed parts; keep the adversarial framing):
   > You are an independent reviewer. You are READ-ONLY: do not edit, create or delete anything. Your job is to
   > FALSIFY, not to agree. For [the change], find the input that breaks the equation, the allele frequency / sample
   > size / edge case where the identity fails, the citation whose page or equation number is wrong, the place where
   > the code diverges from [spec/docs/THEORY_REVIEW.md]. Run code to get executed evidence where you can. Report
   > per rubric item: PASS / FAIL / UNVERIFIABLE, with `file:line` evidence and the primary source (title, year, verified
   > page/equation). Never invent a citation, page or equation: if you cannot verify it, say UNVERIFIABLE. A review
   > that only confirms is a failed review.
4. **Rubric.** If `docs/THEORY_REVIEW.md` exists, use it item by item. Otherwise include at least: units and scaling;
   boundary frequencies (0, 0.5, 1); sample-size and degenerate cases; sign conventions; random-number handling and
   reproducibility; whether stated assumptions (HWE, LE, additivity, infinitesimal) match what the code does; every cited
   equation traced to a verified primary source and page.
5. **Confirm the reviewer changed nothing:** `git status` and `git diff`; remove the throwaway worktree.
6. **Objective gate:** run the project's tests (`devtools::test()`, `R CMD check` for releases, `cargo test`/clippy). Green
   tests do not replace the review, and a green review does not replace tests.
7. **Resolve.** Each FAIL is fixed by the implementer, then re-reviewed by the same reviewer until none remains. Record
   UNVERIFIABLE items (the schema's word; call them UNVERIFIED to the person) in the PR text or `docs/DECISIONS.md`.
8. **Report:** reviewer used, items PASS/FAIL/UNVERIFIED, what changed, tests result. No AI attribution in commit messages.

Roles alternate per task: if Claude implemented, Codex (or a fresh subagent) reviews; if Codex implemented, Claude reviews.
