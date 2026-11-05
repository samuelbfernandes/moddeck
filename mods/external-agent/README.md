# external-agent

Install (Claude Code 2.1.287 or later): `/plugin install external-agent --marketplace samuelbfernandes/moddeck`

## What it does
Lets you ask another coding agent from inside Claude Code, so a second model can answer or review without leaving the chat.
Codex is the default; Claude Code (a separate `claude -p` run) is the other choice.

- `/agent <question>` asks the agent and shows its answer. Claude also reads the answer, so you can discuss it next.
- `/agent-review [instructions]` asks the agent to review your uncommitted git changes.
- Claude gets a tool, `ask`, it can call by itself, for example when you say "check this with Codex".
- In the moddeck side bar it is the **External Agent** box, right under Side Question. The first time it opens a setup
  wizard: pick the agent; it checks the agent is installed and signed in on this machine, lists its models, and runs a
  one-word connection check before it finishes. Then the box is a chat with a model selector, **review**, and
  "↳ use in prompt". **⚙ change** reopens the wizard. Answers in the box are not added to the conversation.

## Safety
- The agent always runs **read-only**. Codex: `--sandbox read-only`, `sandbox_mode="read-only"` and `--ephemeral` (no
  session files). Claude Code: `--permission-mode plan` and only the Read, Grep and Glob tools.
- No `--dangerously-*` flag is ever passed. Your question goes on standard input, never into a command-line argument.
- **No API key is stored by this mod or by moddeck.** If the agent is installed and signed in (subscription or its own
  stored key), no key is asked for. Only when Codex is installed but not signed in does the wizard offer a key field; the
  key goes straight to `codex login --with-api-key` (Codex stores it) and the field is emptied. The field shows the key
  while you type. Claude Code is signed in with `claude auth login` in a terminal.
- A run stops after 10 minutes; answers are cut at 60,000 characters.

## Cost
Every question uses **the chosen agent's quota** (your ChatGPT plan for Codex, your Claude plan for Claude Code). With
`/agent` or the tool, the answer also becomes part of Claude's context. The side bar box adds nothing to Claude's context
unless you press "use in prompt". The wizard's connection check is one tiny question.

## Needs
The agent's command-line program, installed and signed in: `codex` (`codex login`) or `claude` (`claude auth login`).
Review needs a git repository.

## Turn it off
Disable the plugin with `/plugin` (or untick it in the moddeck installer). It has no background behaviour.

## Limits
- Two agents are built in (Codex, Claude Code). Others (Gemini CLI, OpenCode) need an adapter in `hooks/agents.ts`; their
  flags were not checked here, so they are not offered. An arbitrary command is deliberately not allowed: moddeck only
  starts programs it names.
- Claude Code has no command that lists models: the wizard offers its aliases (sonnet, opus, haiku).
- No cancel: a question runs until it answers or reaches 10 minutes. Answers arrive whole, not streamed.
- Tested with fake agents in `tests/`, and by hand with codex-cli 0.162.0 and Claude Code on macOS. Not tested on Windows.
