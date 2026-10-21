import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { DEFAULT_WORDS, isMethodPath, isReviewCommand, isReviewSkill, isSaveCommand } from '../hooks/lib'

function world(on: On) {
  const store = new Map<string, unknown>()
  const w = { toasts: [] as string[], ran: [] as string[] }
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => (store.set(e.key, e.value), { value: undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } as never }))
  on('ui.toast', (_$, e) => (w.toasts.push(e.text), { value: undefined }))
  on('tool.call', (_$, e) => {
    w.ran.push(String((e as Record<string, unknown>).command ?? (e as Record<string, unknown>).file_path ?? e.tool))
    return { result: { ok: true }, ref: 1, text: 'done' } as never
  })
  return w
}

const start = ($: Engine) => $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true } as never)
const slash = async ($: Engine, args = '') =>
  ((await $.command.run({ command: 'method-review', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })) as { text?: string }).text ?? ''
const call = ($: Engine, input: Record<string, unknown>) => $.tool.call(input as never) as Promise<Record<string, any>>

test('paths: code files with a method word count; tests, docs and other files do not', () => {
  expect(isMethodPath('/proj/R/blup.R', DEFAULT_WORDS)).toBe(true)
  expect(isMethodPath('/proj/src/Selection.rs', DEFAULT_WORDS)).toBe(true)
  expect(isMethodPath('/proj/tests/testthat/blup.R', DEFAULT_WORDS)).toBe(false)
  expect(isMethodPath('/proj/docs/blup.md', DEFAULT_WORDS)).toBe(false)
  expect(isMethodPath('/proj/R/plot.R', DEFAULT_WORDS)).toBe(false)
  expect(isMethodPath('/proj/R/blup.txt', DEFAULT_WORDS)).toBe(false)
})

test('commands: review, save and the review skill are recognised', () => {
  expect(isReviewCommand('git diff --staged | codex exec -s read-only "x"')).toBe(true)
  expect(isReviewCommand('dev/dual.sh review --staged')).toBe(true)
  expect(isReviewCommand('git commit -m x')).toBe(false)
  expect(isSaveCommand('git commit -m "x"')).toBe(true)
  expect(isSaveCommand('git -C repo push origin main')).toBe(true)
  expect(isSaveCommand('git status')).toBe(false)
  expect(isReviewSkill('review')).toBe(true)
  expect(isReviewSkill('moddeck:review')).toBe(true)
  expect(isReviewSkill('writing')).toBe(false)
})

test('a method edit adds one note; the first commit is held once with a toast; the second goes ahead', async ($, on) => {
  const w = world(on)
  await start($)
  const first = await call($, { tool: 'Edit', file_path: '/proj/R/blup.R', old_string: 'a', new_string: 'b' })
  expect(first.context?.[0]).toContain('R/blup.R looks like method code')
  const second = await call($, { tool: 'Edit', file_path: '/proj/R/herit.R', old_string: 'a', new_string: 'b' })
  expect(second.context).toBeUndefined()
  const held = await call($, { tool: 'Bash', command: 'git commit -m x' })
  expect(held.deny).toContain('held once')
  expect(w.toasts).toHaveLength(1)
  const again = await call($, { tool: 'Bash', command: 'git commit -m x' })
  expect(again.deny).toBeUndefined()
  expect(w.ran).toContain('git commit -m x')
})

test('a review clears the list: a Codex command, the review skill, or /method-review reviewed', async ($, on) => {
  world(on)
  await start($)
  const edit = () => call($, { tool: 'Edit', file_path: '/proj/R/blup.R', old_string: 'a', new_string: 'b' })
  await edit()
  await call($, { tool: 'Bash', command: 'codex review --uncommitted' })
  expect(await slash($)).toContain('nothing waiting')
  await edit()
  expect(await slash($)).toContain('1 unreviewed: R/blup.R')
  await call($, { tool: 'Skill', skill: 'review' })
  expect(await slash($)).toContain('nothing waiting')
  await edit()
  expect(await slash($, 'reviewed')).toBe('method-review · marked reviewed')
  expect((await call($, { tool: 'Bash', command: 'git push' })).deny).toBeUndefined()
})

test('off lets everything through; words can be added and removed; a failed edit is not remembered', async ($, on) => {
  world(on)
  await start($)
  expect(await slash($, 'add pedigree')).toContain('now watching paths with "pedigree"')
  expect((await call($, { tool: 'Write', file_path: '/proj/R/pedigree.R', content: 'x' })).context?.[0]).toContain('pedigree.R')
  expect(await slash($, 'remove pedigree')).toContain('no longer')
  expect(await slash($, 'off')).toBe('method-review · off')
  await call($, { tool: 'Edit', file_path: '/proj/R/blup.R', old_string: 'a', new_string: 'b' })
  expect((await call($, { tool: 'Bash', command: 'git commit -m x' })).deny).toBeUndefined()
  expect(await slash($, 'nonsense')).toContain('nothing changed')
})
