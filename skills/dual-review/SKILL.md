---
name: dual-review
description: Use when a change needs an independent review by another model and the reviewer is Codex or Gemini (Antigravity, agy, Neon) - "have Gemini review", "Codex review", "other model review", "independent theory review", "second opinion" on a commit, staged or uncommitted change.
---

# Dual review (Codex or Gemini)

One model implements, a *different* model reviews read-only and tries to prove the change
wrong. The reviewer is **Codex** or **Gemini** through the Antigravity CLI (`agy`, default model
`gemini-4-neon-medium` = Neon at medium effort). When to review, and the reviewer prompt, are in
the `review` skill; this skill is how to run Codex or Gemini and handle what comes back.

## Pick the reviewer

| User said | Reviewer |
|---|---|
| "Gemini", "Neon", "Antigravity", "cheaper" | Gemini |
| "Codex" | Codex |
| "the other model", "your pick", nothing | Gemini (cheaper). Say which you picked. |

The user's request for a Gemini or Codex review is the consent to send that code to it. The
reviewer must differ from the implementer: if Codex wrote the change, Gemini or Claude reviews.

## Pick the scope

- "Last commit" / "latest implementation": the latest commit that changed code
  (`git log --oneline -5 --stat`; skip docs-only commits). Name the commit in your reply.
- Uncommitted work: pass the file paths, plus the governing spec when it changed. Never stage or
  check out anything just to review it. Leave unrelated dirty files out.
- If `git status` shows uncommitted edits to files in the reviewed commit, the reviewer may read
  the working-tree version: say so in the prompt, or review the commit and the edits separately.

## Run it

Bash tool: `dangerouslyDisableSandbox: true` (both CLIs fail inside the sandbox: agy cannot write
`~/.gemini`, Codex cannot start its app server) and `run_in_background: true` (2-15 min).
Redirect output to a file in `$TMPDIR`.

**Repo has `dev/dual.sh` with a `gemini` reviewer** (`grep -q gemini dev/dual.sh`): use it; it
builds the prompt from the repo's rubric and keeps a transcript.

```bash
REVIEWER=gemini dev/dual.sh review --rev <sha>      # or --staged, or <paths...>; REVIEWER=codex
```

**Otherwise** write the `review` skill's reviewer prompt, with the diff (`git show <sha>` or
`git diff -- <paths>`) and the JSON verdict line below, to `$TMPDIR/review-prompt.md`, then:

```bash
# Gemini (Antigravity). --mode plan refuses edits. Headless agy auto-denies every shell command
# not allow-listed and then aborts with no output, so the prompt must list the allowed ones.
R="$(git rev-parse --show-toplevel)"
~/.gemini/bin/agy -p "$(cat "$TMPDIR/review-prompt.md")
You may run ONLY commands starting with: git show, git diff, git log, git grep, cat, grep, head, tail, wc, ls." \
  --model gemini-4-neon-medium --mode plan --print-timeout 1800s \
  --settings '{"permissions":{"allow":["read_file('"$R"')","command(git show)","command(git diff)","command(git log)","command(git grep)","command(cat)","command(grep)","command(head)","command(tail)","command(wc)","command(ls)"]}}' \
  </dev/null > "$TMPDIR/review.md" 2>&1

# Codex, read-only
codex exec -s read-only --ephemeral -C "$R" "$(cat "$TMPDIR/review-prompt.md")" </dev/null > "$TMPDIR/review.md" 2>&1
```

To let Gemini run the project's tests, add the test runner (`command(Rscript)`, `command(pytest)`)
to the allow-list and to the listed commands. Verdict line for the prompt:
`End with one fenced JSON object: {"verdict":"AGREE|BLOCK","open":["O1"],"confidence":0.0,"summary":"..."}`.

## Read the result

| Output | Meaning | Do |
|---|---|---|
| `"verdict":"AGREE"` | reviewer agrees | report it with its low notes |
| `"verdict":"BLOCK"`, findings O1, O2... | findings | verify each (below) |
| `jetski: no output produced ... "command" permission` | Gemini ran a command outside the allow-list | add it if read-only, rerun |
| `Please sign in` / auth timeout | agy not signed in | ask the user to run `~/.gemini/bin/agy` once |
| model not found | model id changed | `~/.gemini/bin/agy models`, pick the Neon medium id |
| agy or codex missing | no CLI | the other reviewer, or a fresh read-only Claude subagent (`review` skill) |

Run `git status` afterwards: the reviewer must not have changed anything.

## Handle findings

1. Check every finding against the code and the spec yourself; redo its arithmetic.
2. Classify: confirmed / partly / rejected. A rejection cites the spec line or code that settles it.
3. Fix confirmed ones with a test that fails on the old code, then run the project's tests.
4. A fix to genetics, statistics, methods or generated code gets one more review by a different model.
5. Report per finding: verdict and evidence; what was and was not run. Never push without asking.

## Common mistakes

- Running inside the sandbox, then concluding the CLI is broken.
- Calling `gemini` (Gemini CLI): Google retired its personal login. Use `agy`.
- Reviewing HEAD when HEAD is a docs-only commit.
- Staging files or checking out a commit just to review it.
- Accepting a BLOCK verdict wholesale, or dismissing it without checking the math.
