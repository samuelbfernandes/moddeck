# codex-bridge

Install (Claude Code 2.1.287 or later): `/plugin install codex-bridge --marketplace samuelbfernandes/moddeck`

## What it does
Lets you ask OpenAI Codex from inside Claude Code, so a second model can answer or review without leaving the chat.

- `/codex <question>` asks Codex and shows its answer. Claude also reads the answer, so you can discuss it next.
- `/codex-review [instructions]` asks Codex to review your uncommitted git changes (staged, unstaged and new files).
- Claude gets a tool, `ask`, it can call by itself, for example when you say "check this with Codex". Mode `ask` sends a
  question; mode `review` reviews the uncommitted changes.

## Safety
- Codex always runs **read-only** (`sandbox_mode="read-only"`): it can read the project, but cannot edit files or run
  commands that write. No `--dangerously-*` flag is ever passed.
- Each run is **ephemeral** (`--ephemeral`): Codex keeps no session files.
- Your question goes to Codex on standard input, never into a shell string or a command-line argument.
- A run stops after 10 minutes; output is cut at 60,000 characters.

## Cost
Every call uses **your Codex (ChatGPT) quota**, and Codex's answer then becomes part of Claude's context (Claude tokens).
Nothing runs unless you type a command or Claude calls the tool.

## Needs
The Codex CLI, installed and signed in (`codex login`). `/codex-review` needs a git repository.

## Turn it off
Disable the plugin with `/plugin` (or untick it in the moddeck installer). It has no background behaviour to switch off.

## Limits
- Tested with a fake Codex in `tests/`, and by hand with codex-cli 0.162.0 on macOS. Not tested on Windows.
- If Claude Code cannot find `codex` on its PATH (some desktop setups), the answer says so: add Codex's folder to PATH.
- Codex's answer is a second opinion, not a verdict: check its claims before relying on them.
