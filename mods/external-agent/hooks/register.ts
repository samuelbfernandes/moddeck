// external-agent: ask another coding agent (Codex by default, or Claude Code) from Claude Code.
// `/agent <question>`, `/agent-review [instructions]`, and the tool `mcp__external-agent__ask` Claude can call.
//
// Which agent and model: what the moddeck side bar's setup wizard saved (moddeck's `agent` state); without moddeck, Codex
// with its own default model. Every agent runs read-only (see ./agents). Every hook fails open: a missing or failing
// agent is reported in the answer and nothing else is blocked.
import type { EngineInterface, Register } from 'claude-code'

import { AGENTS, DEFAULT_AGENT, ask, isConfig } from './agents'
import type { AgentConfig, Mode, Run } from './agents'

const TOOL = 'mcp__external-agent__ask'
const DECK_AGENT = { plugin: 'moddeck', key: 'agent' } as const

async function configOf($: EngineInterface): Promise<AgentConfig> {
  try {
    const v = ((await $.state.get(DECK_AGENT as never)) as { value?: unknown } | undefined)?.value
    if (isConfig(v)) return v
  } catch {
    // moddeck is not installed: the default below
  }
  return { agent: DEFAULT_AGENT, model: '' }
}

async function askAgent($: EngineInterface, mode: Mode, prompt: string): Promise<{ isOk: boolean; text: string; label: string }> {
  const conf = await configOf($)
  const label = AGENTS[conf.agent].label
  $.ui.status(`${label} is ${mode === 'review' ? 'reviewing' : 'thinking'}…`)
  try {
    const run: Run = (argv, init) => $.process.run(argv, init)
    return { ...(await ask(run, conf, mode, prompt)), label }
  } finally {
    $.ui.status(undefined)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'agent', description: 'Ask the external agent (read-only): /agent <question>', argumentHint: '<question>' })
      await $.command.register({ name: 'agent-review', description: 'The external agent reviews uncommitted git changes (read-only)', argumentHint: '[instructions]' })
      await $.tool.register({
        name: 'ask',
        description:
          'Ask the external coding agent the user set up (Codex by default, or Claude Code), running locally and read-only, ' +
          'for a second opinion (mode "ask") or a review of uncommitted git changes (mode "review"). It cannot edit files. ' +
          "Use when the user asks for Codex, the external agent, or an independent check. Uses the user's quota for that agent.",
        inputSchema: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'The question, or extra review instructions (may be empty for review).' },
            mode: { type: 'string', enum: ['ask', 'review'], description: 'ask (default) or review' },
          },
          required: ['prompt'],
        },
        isDeferred: false,
      })
    } catch {
      // fail-open: without the commands or the tool the session goes on as usual
    }
    return next(e)
  })

  on('command.run', { command: 'agent' }, async ($, e) => {
    const prompt = e.args.trim()
    if (!prompt) return { text: 'Usage: /agent <question>' }
    const a = await askAgent($, 'ask', prompt)
    return { text: `${a.label}:\n\n${a.text}`, context: [`The user asked ${a.label}: ${prompt}\n\n${a.label} replied:\n${a.text}`] }
  })

  on('command.run', { command: 'agent-review' }, async ($, e) => {
    const a = await askAgent($, 'review', e.args.trim())
    return { text: `${a.label} review:\n\n${a.text}`, context: [`${a.label} reviewed the uncommitted changes:\n${a.text}`] }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const prompt = typeof e.prompt === 'string' ? e.prompt.trim() : ''
    const mode: Mode = e.mode === 'review' ? 'review' : 'ask'
    if (mode === 'ask' && !prompt) return { deny: 'prompt is required for mode "ask".' }
    const a = await askAgent($, mode, prompt)
    return a.isOk ? { result: a.text } : { result: a.text, isError: true }
  })
}
