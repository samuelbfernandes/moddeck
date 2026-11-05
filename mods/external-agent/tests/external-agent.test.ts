import { expect, test } from 'claude-code/testing'

import { askArgv, parseCodexModels } from '../hooks/agents'

const OK = { stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
type Ran = { argv: string[]; stdin?: string }

// Each `on` hook stands in for the engine; process.run fakes the agent CLIs and records what it was asked to start.
function fakeEngine(on: any, runs: Ran[], o: { exitCode?: number; deck?: unknown } = {}) {
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('tool.register', (_: unknown, e: any) => ({ value: { tool: `mcp__external-agent__${e.name}` } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('state.get', (_: unknown, e: any) => ({ value: { value: JSON.stringify(e).includes('"moddeck"') ? o.deck : undefined, version: 1 } }))
  on('process.run', (_: unknown, e: any) => {
    runs.push({ argv: [...e.argv], stdin: e.init?.stdin })
    const code = o.exitCode ?? 0
    return { value: { ...OK, exitCode: code, stdout: code === 0 ? `answer to: ${e.init?.stdin}` : '', stderr: code === 0 ? '' : 'not logged in' } }
  })
}
const start = ($: any) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

test('/agent defaults to Codex: question on stdin, read-only and ephemeral', async ($, on) => {
  const runs: Ran[] = []
  fakeEngine(on, runs)
  await start($)
  const out = await $.command.run({ command: 'agent', args: 'what is 2+2?' })
  expect(out.text).toContain('Codex (OpenAI):')
  expect(out.text).toContain('answer to: what is 2+2?')
  const { argv, stdin } = runs[0]!
  expect(argv.slice(0, 2)).toEqual(['codex', 'exec'])
  expect(argv).toContain('read-only')
  expect(argv).toContain('--ephemeral')
  expect(argv.join(' ')).not.toContain('dangerously')
  expect(argv.join(' ')).not.toContain('2+2') // the question is never an argument
  expect(stdin).toBe('what is 2+2?')
})

test('the agent and model the moddeck wizard saved are used', async ($, on) => {
  const runs: Ran[] = []
  fakeEngine(on, runs, { deck: { agent: 'claude', model: 'opus' } })
  await start($)
  const out = await $.command.run({ command: 'agent', args: 'hello' })
  expect(out.text).toContain('Claude Code:')
  expect(runs[0]!.argv).toEqual(['claude', '-p', '--model', 'opus', '--permission-mode', 'plan', '--tools', 'Read', 'Grep', 'Glob'])
})

test('/agent with no question shows usage and starts nothing', async ($, on) => {
  const runs: Ran[] = []
  fakeEngine(on, runs)
  await start($)
  expect((await $.command.run({ command: 'agent', args: '' })).text).toBe('Usage: /agent <question>')
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

test('codex review is read-only with the chosen model; the catalog hides hidden models', async () => {
  const argv = askArgv({ agent: 'codex', model: 'gpt-x' }, 'review', false)
  expect(argv.slice(0, 3)).toEqual(['codex', 'exec', 'review'])
  expect(argv).toContain('sandbox_mode="read-only"')
  expect(argv).toContain('--uncommitted')
  expect(argv.join(' ')).toContain('-m gpt-x')
  expect(parseCodexModels('{"models":[{"slug":"a","visibility":"list"},{"slug":"b","visibility":"hide"}]}')).toEqual(['a'])
  expect(parseCodexModels('not json')).toEqual([])
})
