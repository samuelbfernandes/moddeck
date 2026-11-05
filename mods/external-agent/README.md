# external-agent

Install (Claude Code 2.1.287 or later): `/plugin install external-agent --marketplace samuelbfernandes/moddeck`

## What it does
Work with another coding agent in the same chat, like a sub-agent: hand it a task, and its answer comes back into the
conversation Claude reads.

- Agents: **Codex** (default), **Gemini CLI**, a local model through **Ollama** or **LM Studio** (run inside Codex's agent,
  so it has tools too), or **Claude Code** (a separate `claude -p` run).
- `/agent <task>` delegates a task; `/agent-review [instructions]` reviews your uncommitted git changes.
- Claude gets a tool, `ask`, to delegate by itself ("hand this to Codex").
- The agent gets the conversation so far, so it works from the same context as Claude.
- In the moddeck side bar it is the **External Agent** box under Side Question: a setup wizard the first time (agent,
  connection, sign-in, model, connection check), then a chat that shows the conversation and grows as you type. Every
  exchange there is also added to the main chat. **⚙ change** reopens the wizard.

## Access and safety
- By default the agent **can edit files and run commands in the project**, each under its own guard:
  Codex (and local models through it): `--sandbox workspace-write` (writes inside the project, no network).
  Gemini CLI: `--approval-mode yolo --sandbox`. Claude Code: `--permission-mode acceptEdits` (edits files; it cannot run
  commands, since nobody can approve them in a background run).
- **Read only** is a choice in the wizard. No `--dangerously-*` or bypass flag is ever passed.
- Every task goes through Claude Code's permission check for the `ask` tool, so you approve it (or allow it always).
- The task goes on standard input, never into a command-line argument. A run stops after 10 minutes.

## Connection
- **On this machine (default):** the agent's own program, signed in on this machine. No API key is needed or stored. If
  Codex is installed but not signed in, the wizard can pass a key to `codex login --with-api-key` (Codex stores it).
- **Through its API (opt-in, off by default):** one OpenAI-compatible chat request to the agent's API (or a local server:
  LM Studio `http://127.0.0.1:1234/v1`, Ollama `http://127.0.0.1:11434/v1`). It answers only: no tools, no edits. A key, if
  needed, goes in `/config` › external-agent › API key, kept in secure storage.

## Cost
Each task uses the chosen agent's quota, and its answer becomes part of Claude's context. The agent also reads the shared
conversation (up to about 30,000 characters). The wizard's connection check is one tiny question.

## Turn it off
Disable the plugin with `/plugin` (or untick it in the moddeck installer). It has no background behaviour.

## Limits
- **Gemini CLI** and **Ollama** were not installed when this was built: their flags come from their documentation and were
  not run here (the connection check shows whether they work). Codex, LM Studio (through Codex and through its API) and
  Claude Code were tested for real.
- Ollama and LM Studio on this machine need Codex installed, which runs them.
- Gemini has no model list here: pick its default or type a model name.
- No cancel: a task runs until it answers or reaches 10 minutes. Answers arrive whole, not streamed.
- Tested with fake agents in `tests/` and by hand on macOS. Not tested on Windows.
