import { expect, test } from 'claude-code/testing'

const OK = { stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

// Each `on` hook stands in for the engine; process.run fakes the codex CLI and records what it was asked to start.
function fakeEngine(on: any, runs: { argv: string[]; stdin?: string }[], exitCode = 0) {
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('tool.register', (_: unknown, e: any) => ({ value: { tool: `mcp__codex-bridge__${e.name}` } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', (_: unknown, e: any) => {
    runs.push({ argv: [...e.argv], stdin: e.init?.stdin })
    return { value: { ...OK, exitCode, stdout: exitCode === 0 ? `answer to: ${e.init?.stdin}` : '', stderr: exitCode === 0 ? '' : 'not logged in' } }
  })
}

test('/codex sends the question on stdin to a read-only, ephemeral codex exec', async ($, on) => {
  const runs: { argv: string[]; stdin?: string }[] = []
  fakeEngine(on, runs)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const out = await $.command.run({ command: 'codex', args: 'what is 2+2?' })

  expect(out.text).toContain('answer to: what is 2+2?')
  expect(runs.length).toBe(1)
  const { argv, stdin } = runs[0]!
  expect(argv.slice(0, 2)).toEqual(['codex', 'exec'])
  expect(argv).toContain('read-only')
  expect(argv).toContain('--ephemeral')
  expect(argv.join(' ')).not.toContain('dangerously')
  expect(argv.join(' ')).not.toContain('2+2') // the question is never an argument
  expect(stdin).toBe('what is 2+2?')
})

test('/codex with no question shows usage and starts nothing', async ($, on) => {
  const runs: { argv: string[]; stdin?: string }[] = []
  fakeEngine(on, runs)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const out = await $.command.run({ command: 'codex', args: '' })

  expect(out.text).toBe('Usage: /codex <question>')
  expect(runs.length).toBe(0)
})

test('/codex-review reviews uncommitted changes read-only', async ($, on) => {
  const runs: { argv: string[]; stdin?: string }[] = []
  fakeEngine(on, runs)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await $.command.run({ command: 'codex-review', args: '' })

  const { argv } = runs[0]!
  expect(argv.slice(0, 3)).toEqual(['codex', 'exec', 'review'])
  expect(argv).toContain('--uncommitted')
  expect(argv).toContain('sandbox_mode="read-only"')
})

test('a failing codex is reported, not thrown', async ($, on) => {
  const runs: { argv: string[]; stdin?: string }[] = []
  fakeEngine(on, runs, 1)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const out = await $.command.run({ command: 'codex', args: 'hello' })

  expect(out.text).toContain('Codex failed (exit 1)')
  expect(out.text).toContain('not logged in')
})
