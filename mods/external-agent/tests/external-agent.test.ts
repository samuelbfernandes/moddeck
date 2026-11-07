import { expect, test } from 'claude-code/testing'

import { askArgv, parseCodexModels, parseLmsModels, parseOllamaModels } from '../hooks/agents'

const OK = { stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
type Ran = { argv: string[]; stdin?: string }

// Each `on` hook stands in for the engine; process.run fakes the agent CLIs and records what it was asked to start.
function fakeEngine(on: any, runs: Ran[], o: { exitCode?: number; deck?: unknown } = {}) {
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('tool.register', (_: unknown, e: any) => ({ value: { tool: `mcp__external-agent__${e.name}` } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'we use pytest' }, { role: 'assistant', text: 'noted' }] }))
  on('state.get', (_: unknown, e: any) => ({ value: { value: JSON.stringify(e).includes('"moddeck"') ? o.deck : undefined, version: 1 } }))
  on('process.run', (_: unknown, e: any) => {
    runs.push({ argv: [...e.argv], stdin: e.init?.stdin })
    const code = o.exitCode ?? 0
    return { value: { ...OK, exitCode: code, stdout: code === 0 ? `answer to: ${e.init?.stdin}` : '', stderr: code === 0 ? '' : 'not logged in' } }
  })
}
const start = ($: any) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

test('/agent defaults to Codex on this machine, able to edit inside its sandbox, with the shared conversation', async ($, on) => {
  const runs: Ran[] = []
  fakeEngine(on, runs)
  await start($)
  const out = await $.command.run({ command: 'agent', args: 'add a test' })
  expect(out.text).toContain('Codex (OpenAI):')
  const { argv, stdin } = runs[0]!
  expect(argv.slice(0, 2)).toEqual(['codex', 'exec'])
  expect(argv).toContain('workspace-write')
  expect(argv.join(' ')).not.toContain('dangerously')
  expect(argv.join(' ')).not.toContain('add a test') // the task is never an argument
  expect(stdin).toContain('User: we use pytest') // the shared conversation
  expect(stdin).toContain('Your task now:\nadd a test')
})

test('the agent and model the moddeck wizard saved are used', async ($, on) => {
  const runs: Ran[] = []
  fakeEngine(on, runs, { deck: { agent: 'claude', model: 'opus' } })
  await start($)
  const out = await $.command.run({ command: 'agent', args: 'hello' })
  expect(out.text).toContain('Claude Code:')
  expect(runs[0]!.argv).toEqual(['claude', '-p', '--model', 'opus', '--permission-mode', 'acceptEdits'])
})

test('/agent with no question shows usage and starts nothing', async ($, on) => {
  const runs: Ran[] = []
  fakeEngine(on, runs)
  await start($)
  expect((await $.command.run({ command: 'agent', args: '' })).text).toBe('Usage: /agent <task>')
  expect(runs.length).toBe(0)
})

test('a failing agent is reported, not thrown', async ($, on) => {
  const runs: Ran[] = []
  fakeEngine(on, runs, { exitCode: 1 })
  await start($)
  const out = await $.command.run({ command: 'agent', args: 'hello' })
  expect(out.text).toContain('failed (exit 1)')
  expect(out.text).toContain('not logged in')
})

test('read access, local models through Codex, and the model lists', async () => {
  const argv = askArgv({ agent: 'codex', model: 'gpt-x', access: 'read' }, 'review', false)
  expect(argv.slice(0, 3)).toEqual(['codex', 'exec', 'review'])
  expect(argv).toContain('sandbox_mode="read-only"')
  expect(argv).toContain('--uncommitted')
  expect(argv.join(' ')).toContain('-m gpt-x')
  expect(parseCodexModels('{"models":[{"slug":"a","visibility":"list"},{"slug":"b","visibility":"hide"}]}')).toEqual(['a'])
  expect(parseCodexModels('not json')).toEqual([])
  const lm = askArgv({ agent: 'lmstudio', model: 'google/gemma' }, 'ask', true)
  expect(lm.join(' ')).toContain('--oss --local-provider lmstudio -m google/gemma')
  expect(lm).toContain('workspace-write')
  expect(askArgv({ agent: 'ollama', model: 'llama3' }, 'ask', true).join(' ')).toContain('--local-provider ollama')
  expect(parseLmsModels('[{"modelKey":"a","type":"llm"},{"modelKey":"e","type":"embedding"}]')).toEqual(['a'])
  expect(parseOllamaModels('NAME ID SIZE\nllama3:8b abc 4GB\n')).toEqual(['llama3:8b'])
})

test('the API connection is used only when chosen, answers only, and sends the key from the secret option', { options: { apiKey: 'k-1' } }, async ($, on) => {
  const runs: Ran[] = []
  const posts: { url: string; init: any }[] = []
  fakeEngine(on, runs, { deck: { agent: 'lmstudio', model: 'g', connection: 'api' } })
  on('http.fetch', (_: unknown, e: any) => (posts.push({ url: e.url, init: e.init }), { value: { status: 200, ok: true, headers: {}, text: '{"choices":[{"message":{"content":"api says hi"}}]}' } }))
  await start($)
  const out = await $.command.run({ command: 'agent', args: 'hello' })
  expect(out.text).toContain('api says hi')
  expect(runs.length).toBe(0) // no program started
  expect(posts[0]!.url).toBe('http://127.0.0.1:1234/v1/chat/completions')
  expect(posts[0]!.init.headers.authorization).toBe('Bearer k-1')
})
