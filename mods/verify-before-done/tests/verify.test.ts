import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { NOTE, isCodeFile, isTestCommand } from '../hooks/lib'

function world(on: On) {
  const store = new Map<string, unknown>()
  const w = { toasts: [] as string[], prompts: [] as { text: string; context?: readonly string[] }[] }
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => (store.set(e.key, e.value), { value: undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } as never }))
  on('ui.toast', (_$, e) => (w.toasts.push(e.text), { value: undefined }))
  on('tool.call', () => ({ result: { ok: true }, ref: 1, text: 'done' }) as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_$, e) => (w.prompts.push({ text: e.text, context: e.context }), { text: e.text, context: e.context }) as never)
  return w
}

const start = ($: Engine) => $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true } as never)
const slash = async ($: Engine, args = '') =>
  ((await $.command.run({ command: 'verify-before-done', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })) as { text?: string }).text ?? ''
const call = ($: Engine, input: Record<string, unknown>) => $.tool.call(input as never)
const turn = ($: Engine) => $.turn.start({ text: 'go', turnId: 't' } as never)
const end = ($: Engine) => $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 't', reason: 'answer' } as never)

test('what counts as code and as a test run', () => {
  expect(isCodeFile('/p/R/a.R')).toBe(true)
  expect(isCodeFile('C:\\p\\a.rs')).toBe(true)
  expect(isCodeFile('/p/README.md')).toBe(false)
  for (const c of ['Rscript -e "devtools::test()"', 'cargo test --release', 'pytest -q', 'npm test', 'R CMD check .', 'claude plugin test mods/x']) expect(isTestCommand(c)).toBe(true)
  for (const c of ['git status', 'ls', 'Rscript analysis.R']) expect(isTestCommand(c)).toBe(false)
})

test('code changed with no test: a toast now and one reminder with the next prompt, once', async ($, on) => {
  const w = world(on)
  await start($)
  await turn($)
  await call($, { tool: 'Edit', file_path: '/proj/R/a.R', old_string: 'a', new_string: 'b' })
  await end($)
  expect(w.toasts).toEqual(['verify-before-done: code changed and no test or check ran this turn'])
  await $.prompt.submit({ text: 'next', origin: { kind: 'user' } } as never)
  expect(w.prompts[0]!.context).toEqual([NOTE])
  await $.prompt.submit({ text: 'again', origin: { kind: 'user' } } as never)
  expect(w.prompts[1]!.context).toBeUndefined()
  expect(await slash($)).toContain('1 turn changed code with no test run')
})

test('a test run in the turn, or only doc edits, say nothing; off says nothing', async ($, on) => {
  const w = world(on)
  await start($)
  await turn($)
  await call($, { tool: 'Edit', file_path: '/proj/R/a.R', old_string: 'a', new_string: 'b' })
  await call($, { tool: 'Bash', command: 'Rscript -e "devtools::test()"' })
  await end($)
  await turn($)
  await call($, { tool: 'Edit', file_path: '/proj/README.md', old_string: 'a', new_string: 'b' })
  await end($)
  expect(w.toasts).toEqual([])
  expect(await slash($, 'off')).toBe('verify-before-done · off')
  await turn($)
  await call($, { tool: 'Edit', file_path: '/proj/R/a.R', old_string: 'a', new_string: 'b' })
  await end($)
  expect(w.toasts).toEqual([])
  expect(await slash($, 'x')).toContain('nothing changed')
})
