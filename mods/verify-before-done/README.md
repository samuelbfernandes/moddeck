# verify-before-done

Install: `/plugin install verify-before-done --marketplace samuelbfernandes/moddeck`

Enforces "say what was and was not verified". When a turn changes code and runs no test, check or build, you see it at once
and Claude is reminded.

## What it does
- During each turn it notes whether Claude edited a code file (`.R`, `.rs`, `.py`, `.jl`, `.ts`, `.js`, `.go`, `.sh`, `.sql`...)
  and whether it ran a test, check or build (`devtools::test()`, `R CMD check`, `cargo test`/`check`/`clippy`/`build`,
  `pytest`, `npm test`/`build`, `go test`, `make test`, `quarto render`, `tsc`, `claude plugin test`...).
- When a turn ends with code changed and none of those run: a toast, and one reminder line sent with your next prompt asking
  Claude to say what was and was not verified, and to run the tests if it had said "done".
- Never blocks and never runs anything. Doc edits and subagent turns are ignored.

## Use
    /verify-before-done           status: how many turns this session
    /verify-before-done on | off

## Limits
It sees that a test command ran, not that it passed. Costs about 40 tokens once per missed turn.

## State for the moddeck side bar
`verify-before-done` → `isOff`, `unverified` (see `types/index.d.ts`).
