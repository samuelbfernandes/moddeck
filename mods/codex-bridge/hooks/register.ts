// codex-bridge: ask OpenAI Codex from Claude Code. `/codex <question>`, `/codex-review [instructions]`, and the tool
// `mcp__codex-bridge__ask` that Claude can call for a second opinion.
//
// Codex always runs read-only (it can read the project, never edit it or run commands that write) and ephemeral (no
// session files). The question goes on standard input, never into a shell string or an argument. Every hook fails open:
// when Codex is missing or fails, the answer says so and nothing else is blocked.
import type { EngineInterface, Register } from 'claude-code'

const READ_ONLY = ['-c', 'sandbox_mode="read-only"']
const TIMEOUT_MS = 10 * 60 * 1000
const MAX_CHARS = 60_000
const TOOL = 'mcp__codex-bridge__ask'

export type Mode = 'ask' | 'review'
type Answer = { isOk: boolean; text: string }

/** The codex command line for a mode; the prompt is sent on stdin (`-`). */
export function buildArgv(mode: Mode, hasInstructions: boolean): string[] {
  if (mode === 'review') {
    return ['codex', 'exec', 'review', ...READ_ONLY, '--uncommitted', '--ephemeral', ...(hasInstructions ? ['-'] : [])]
  }
  return ['codex', 'exec', '-s', 'read-only', ...READ_ONLY, '--ephemeral', '--skip-git-repo-check', '--color', 'never', '-']
}

function clip(text: string): string {
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n…(Codex output cut at ${MAX_CHARS} characters)` : text
}

async function askCodex($: EngineInterface, mode: Mode, prompt: string): Promise<Answer> {
  $.ui.status(mode === 'review' ? 'Codex is reviewing…' : 'Codex is thinking…')
  try {
    const ran = await $.process.run(buildArgv(mode, prompt.length > 0), { stdin: prompt, timeoutMs: TIMEOUT_MS })
    if (ran.exitCode !== 0) {
      return { isOk: false, text: `Codex failed (exit ${ran.exitCode}):\n${clip(ran.stderr.trim().slice(-4000))}` }
    }
    return { isOk: true, text: clip(ran.stdout.trim() || '(Codex returned no text)') }
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    return { isOk: false, text: `Codex could not run (${why}). Is it installed and signed in? Try \`codex login\`.` }
  } finally {
    $.ui.status(undefined)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'codex', description: 'Ask Codex (read-only): /codex <question>', argumentHint: '<question>' })
      await $.command.register({
        name: 'codex-review',
        description: 'Codex reviews uncommitted git changes (read-only): /codex-review [instructions]',
        argumentHint: '[instructions]',
      })
      await $.tool.register({
        name: 'ask',
        description:
          'Ask OpenAI Codex, running locally in a read-only sandbox, for a second opinion (mode "ask") ' +
          'or a review of uncommitted git changes (mode "review"). Codex cannot edit files. ' +
          "Use when the user asks for Codex or for an independent check. Uses the user's Codex quota.",
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

  on('command.run', { command: 'codex' }, async ($, e) => {
    const prompt = e.args.trim()
    if (!prompt) return { text: 'Usage: /codex <question>' }
    const answer = await askCodex($, 'ask', prompt)
    return { text: `Codex:\n\n${answer.text}`, context: [`The user asked Codex: ${prompt}\n\nCodex replied:\n${answer.text}`] }
  })

  on('command.run', { command: 'codex-review' }, async ($, e) => {
    const answer = await askCodex($, 'review', e.args.trim())
    return { text: `Codex review:\n\n${answer.text}`, context: [`Codex reviewed the uncommitted changes:\n${answer.text}`] }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const prompt = typeof e.prompt === 'string' ? e.prompt.trim() : ''
    const mode: Mode = e.mode === 'review' ? 'review' : 'ask'
    if (mode === 'ask' && !prompt) return { deny: 'prompt is required for mode "ask".' }
    const answer = await askCodex($, mode, prompt)
    return answer.isOk ? { result: answer.text } : { result: answer.text, isError: true }
  })
}
