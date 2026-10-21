import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { hintFor, pick } from '../hooks/lib'

function world(on: On) {
  const store = new Map<string, unknown>()
  const w = { prompts: [] as { text: string; context?: readonly string[] }[] }
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => (store.set(e.key, e.value), { value: undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } as never }))
  on('prompt.submit', (_$, e) => (w.prompts.push({ text: e.text, context: e.context }), { text: e.text, context: e.context }) as never)
  return w
}

const start = ($: Engine) => $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true } as never)
const slash = async ($: Engine, args = '') =>
  ((await $.command.run({ command: 'skill-router', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })) as { text?: string }).text ?? ''
const say = ($: Engine, text: string) => $.prompt.submit({ text, origin: { kind: 'user' } } as never)

test('rules: each skill matches its own kind of request and nothing else', () => {
  expect(pick('submit this job to the cluster with sbatch and wait for it', [])).toBe('ahpcc')
  expect(pick('is it safe to install this plugin from github', [])).toBe('assess-plugin')
  expect(pick('can you review my last change before I push', [])).toBe('review')
  expect(pick('build a portal that lets lab members upload phenotype files and see results', [])).toBe('plan-first')
  expect(pick('rewrite this email so it sounds less formal please', [])).toBe('writing')
  expect(pick('fix the off by one error in the loop above please', [])).toBeUndefined()
})

test('rules: slash commands, short replies, a named skill and an already hinted skill give nothing', () => {
  expect(pick('/review the diff against main for me', [])).toBeUndefined()
  expect(pick('review it', [])).toBeUndefined()
  expect(pick('use the review skill on my last change please', [])).toBeUndefined()
  expect(pick('review my last change before I push it', ['review'])).toBeUndefined()
})

test('a matching prompt gets one added line, once per skill; others pass unchanged; off adds nothing', async ($, on) => {
  const w = world(on)
  await start($)
  await say($, 'please review my last change before I push it')
  expect(w.prompts[0]!.context).toEqual([hintFor('review')])
  await say($, 'please review my next change before I push it')
  expect(w.prompts[1]!.context).toBeUndefined()
  await say($, 'what does this function return when the input is empty')
  expect(w.prompts[2]!.context).toBeUndefined()
  expect(await slash($)).toBe('skill-router · on · hinted this session: review')
  expect(await slash($, 'off')).toBe('skill-router · off')
  await say($, 'rewrite this email so it sounds less formal please')
  expect(w.prompts[3]!.context).toBeUndefined()
  expect(await slash($, 'maybe')).toContain('nothing changed')
})
