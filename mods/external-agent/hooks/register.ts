// external-agent: delegate to another coding agent from Claude Code, sharing the same conversation.
// `/agent <task>`, `/agent-review [instructions]`, and the tool `mcp__external-agent__ask` that Claude (or the moddeck side
// bar) calls. The agent gets the conversation so far, and its answer comes back into the same thread.
//
// Which agent, connection, access and model: what the moddeck side bar's wizard saved (moddeck's `agent` state); without
// moddeck, Codex on this machine with its own default model, able to edit. By default the agent can edit files and run
// commands in the project under its own guard (see ./agents); 'read' keeps it read-only. The opt-in API connection answers
// only (no tools) and reads its key from this mod's secret option `apiKey`, kept in secure storage, never in moddeck.
// Every hook fails open: a missing or failing agent is reported in the answer and nothing else is blocked.
import type { EngineInterface, Register } from 'claude-code'

import { AGENTS, DEFAULT_AGENT, accessOf, ask, connectionCheck, connectionOf, digest, isConfig } from './agents'
import type { AgentConfig, Mode, Post, Run } from './agents'

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

async function sharedContext($: EngineInterface): Promise<string> {
  try {
    return digest(await $.session.messages())
  } catch {
    return ''
  }
}

type Reply = { isOk: boolean; text: string; label: string }

async function askAgent($: EngineInterface, apiKey: string, mode: Mode | 'check', prompt: string): Promise<Reply> {
  const conf = await configOf($)
  const label = AGENTS[conf.agent].label
  const run: Run = (argv, init) => $.process.run(argv, init)
  const post: Post = async (url, body, headers) => {
    const r = await $.http.fetch(url, { method: 'POST', body, headers })
    return { status: r.status, text: r.text }
  }
  const extra = { post, key: apiKey }
  if (mode === 'check') return { ...(await connectionCheck(run, conf, extra)), label }
  $.ui.status(`${label} is ${mode === 'review' ? 'reviewing' : accessOf(conf) === 'edit' && connectionOf(conf) === 'local' ? 'working' : 'thinking'}…`)
  try {
    return { ...(await ask(run, conf, mode, prompt, { ...extra, context: await sharedContext($) })), label }
  } finally {
    $.ui.status(undefined)
  }
}

export const register: Register = (on, options) => {
  const apiKey = typeof options.apiKey === 'string' ? options.apiKey : ''

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'agent', description: 'Delegate a task to the external agent (shares this conversation): /agent <task>', argumentHint: '<task>' })
      await $.command.register({ name: 'agent-review', description: 'The external agent reviews uncommitted git changes', argumentHint: '[instructions]' })
      await $.tool.register({
        name: 'ask',
        description:
          'Delegate to the external coding agent the user set up (Codex by default; Gemini CLI, a local model through Ollama or ' +
          'LM Studio, or Claude Code). It sees this conversation, and by default can edit files and run commands in the ' +
          'project (inside its own sandbox), like a sub-agent. mode "ask": a task or question; mode "review": review the ' +
          'uncommitted git changes. Use when the user asks for Codex, the external agent, a second opinion, or to hand a task ' +
          "over. Uses the user's quota for that agent. Read its result before relying on it.",
        inputSchema: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'The task or question, self-contained; or extra review instructions (may be empty for review).' },
            mode: { type: 'string', enum: ['ask', 'review', 'check'], description: 'ask (default), review, or check (connection test)' },
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
    if (!prompt) return { text: 'Usage: /agent <task>' }
    const a = await askAgent($, apiKey, 'ask', prompt)
    return { text: `${a.label}:\n\n${a.text}`, context: [`The user delegated to ${a.label}: ${prompt}\n\n${a.label} replied:\n${a.text}`] }
  })

  on('command.run', { command: 'agent-review' }, async ($, e) => {
    const a = await askAgent($, apiKey, 'review', e.args.trim())
    return { text: `${a.label} review:\n\n${a.text}`, context: [`${a.label} reviewed the uncommitted changes:\n${a.text}`] }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const prompt = typeof e.prompt === 'string' ? e.prompt.trim() : ''
    const mode = e.mode === 'review' ? 'review' : e.mode === 'check' ? 'check' : 'ask'
    if (mode === 'ask' && !prompt) return { deny: 'prompt is required for mode "ask".' }
    const a = await askAgent($, apiKey, mode, prompt)
    return a.isOk ? { result: a.text } : { result: a.text, isError: true }
  })
}
