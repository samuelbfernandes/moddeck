# method-review

Install: `/plugin install method-review --marketplace samuelbfernandes/moddeck`

Enforces one rule: the model that wrote method code is never its own reviewer. When Claude edits method code, the first
`git commit` or `git push` is held once until a second model has looked at it.

## What it does
- After a successful Edit, Write, MultiEdit or NotebookEdit, a code file (`.R`, `.rs`, `.py`, `.jl`, `.cpp`, `.Rmd`, `.qmd`...)
  whose path holds one of these words (case ignored) is remembered as unreviewed: blup, herit, selection, meiosis,
  variance, kinship, relationship, likelihood, estimat, simulat, gwas, effects. Files under `tests/` or `docs/` do not count.
  The first one adds a one-line note for the model: use the `review` skill before committing.
- The first `git commit` or `git push` while any file is unreviewed is refused once, with a toast and a reason. Running the
  command again goes ahead. Nothing else is ever blocked, and nothing is edited.
- A review clears the list: the `review` skill, `codex exec` / `codex review`, `dev/dual.sh`, or `/method-review reviewed`.

## Use
    /method-review                status: what is waiting, and the words watched
    /method-review add pedigree   watch paths holding this word (kept across sessions)
    /method-review remove effects stop watching a word
    /method-review reviewed       mark everything reviewed
    /method-review on | off

## Limits
It matches path words, not what the code does: a method file with an unlisted name is missed, and an unrelated file with a
listed word is flagged. Tune the words with `add` and `remove`. Costs no tokens beyond the one note.

## State for the moddeck side bar
`method-review` → `isOff`, `pending` (see `types/index.d.ts`).
