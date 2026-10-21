---
name: plan-first
description: Use before a bigger build (a feature, portal, pipeline, analysis, new repo) when the request is large or underspecified, when choosing a stack or design, or when asked to align, scope or plan first. Interviews, then writes a spec and hands off to a fresh session. Not for small edits, bug fixes, or questions with an obvious answer.
---

# Plan first

A one-paragraph request for a big build gets filled in with guesses, and the wrong guess surfaces hours later. Spend a few
minutes on questions first.

## Steps
1. **Read what exists.** Skim the repo, `AGENTS.md`/`CLAUDE.md` and any file the request names, so no question asks what
   the code already answers.
2. **Interview in rounds.** Ask 3 to 5 numbered questions at a time, each with lettered choices and a recommended default
   (`1 b, 2 a` is a full answer). Use the question tool when there is one. Cover, in order: the goal and who it is for; what
   "done" looks like and how it is checked; inputs, outputs and existing data; hard constraints (language, versions, no
   network, performance, where it runs: laptop or the HPC cluster); what is out of scope. Skip any question a choice cannot change.
3. **Choose the design when a choice is open.** Where the stack or structure is not fixed, compare two or three options
   in one line each (fit, cost, what could go wrong) and recommend one. Default to what the repo already uses (R, Rust,
   Slurm); a web framework or service only when the task needs one. If the person's pick is not the most logical,
   say so and propose the better one.
4. **Confirm.** Restate the plan in five lines or fewer. If the person says go, continue; if something is wrong, ask only about that.
5. **Write the spec** to `SPEC.md` (or the named path): goal, user, done-when checks, constraints, the decisions made and
   why, open questions, and a short ordered task list. Reasons beside decisions, so later work can judge edge cases.
6. **Hand off.** Do not build in this session: its context is full of the interview. End with one paste-ready line for a
   fresh session, such as `Read SPEC.md and build it; ask before changing anything the spec marks as decided.`

## Notes
- Fast is the point. When the answer is obvious from the code, state your assumption and ask the person to correct it.
- Never invent a requirement to fill a section; write "open question" instead.
