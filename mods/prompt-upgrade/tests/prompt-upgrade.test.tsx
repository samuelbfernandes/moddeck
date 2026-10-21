import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { addHistory, answeredCount, bigNumber, cardWidth, heading, isDone, parseQuestions, parseRewrite, route, trackerIndex, wordCount } from '../hooks/lib'

const QUESTIONS = JSON.stringify({
  questions: [
    { q: 'Who is it for?', options: ['Customers', 'Staff', 'Investors'] },
    { q: 'How long should it be?', options: ['One paragraph', 'A page'] },
    { q: 'Anything else?', options: ['no', 'maybe'] },
    { q: 'A fourth question is cut', options: ['a', 'b'] },
  ],
})
const REWRITE = JSON.stringify({ upgraded: 'Write a one paragraph welcome for the customers of [BAKERY NAME].', added: ['audience', 'length', 'a placeholder for the name'] })

const PANE = {
  plugin: 'prompt-upgrade', component: 'Pane', requestId: 'prompt-upgrade', surface: 'terminal',
  props: { title: 'Prompt upgrade', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const
const at = (cols: number) => ({ ...PANE, props: { ...PANE.props, bodyColumns: cols } }) as never

function world(on: On, opts: { questions?: string; fail?: boolean; placed?: boolean } = {}) {
  const w = { calls: [] as string[], submitted: [] as string[], filled: [] as string[], closed: 0, clock: mock.clock(on) }
  mock.store(on)
  on('model.complete', (_$, e) => {
    const isAsk = String((e as { system?: unknown }).system).includes('multiple-choice')
    w.calls.push(isAsk ? 'ask' : 'rewrite')
    if (opts.fail) return { value: { isAnswered: false, text: '' } as never }
    const text = isAsk ? (opts.questions ?? QUESTIONS) : REWRITE
    return { value: { isAnswered: true, text, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as never }
  })
  on('command.register', () => ({ value: undefined as never }))
  on('ui.open', () => ({ value: { isPlaced: opts.placed !== false } as never }))
  on('ui.close', () => (w.closed++, { value: undefined as never }))
  on('ui.toast', () => ({ value: undefined as never }))
  on('ui.copy', () => ({ value: { isCopied: true } as never }))
  on('prompt.fill', (_$, e) => (w.filled.push((e as { text: string }).text), { isFilled: true } as never))
  on('prompt.submit', (_$, e) => (w.submitted.push(e.text), { text: e.text }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  return w
}
const cmd = ($: Engine, args: string) => $.command.run({ command: 'better', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as never).then(r => r.text ?? '')
const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) => (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
const start = ($: Engine) => $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true } as never)
const sub = (text: string, over: Record<string, unknown> = {}) => ({ text, origin: 'composer', hasCommand: false, attachments: 0, isMeta: false, isMidTurn: false, ...over })

test('which prompts are taken and which pass through', () => {
  expect(route(sub('write a landing page for my bakery'), 4)).toEqual({ kind: 'take', text: 'write a landing page for my bakery' })
  expect(route(sub('/review the diff please now'), 4).kind).toBe('pass') // a slash command
  expect(route(sub('look at this picture for me please', { attachments: 1 }), 4).kind).toBe('pass') // an attachment
  expect(route(sub('and also fix the other bug too', { isMidTurn: true }), 4).kind).toBe('pass') // while Claude works
  expect(route(sub('yes'), 4).kind).toBe('pass')
  expect(route(sub('keep going'), 4).kind).toBe('pass')
  expect(route(sub('fix it now'), 4).kind).toBe('pass') // under the word floor
  expect(route(sub('write a landing page for my bakery', { origin: 'plugin' }), 4).kind).toBe('pass') // never its own sends
  expect(route(sub('> send this exactly as written'), 4)).toEqual({ kind: 'strip', text: 'send this exactly as written' })
})

test('the questions: fenced JSON, at most three, two to four options each', () => {
  const qs = parseQuestions('```json\n' + QUESTIONS + '\n```')!
  expect(qs.length).toBe(3)
  expect(qs[0]!.options).toEqual(['Customers', 'Staff', 'Investors'])
  expect(parseQuestions('{"questions": []}')).toEqual([])
  expect(parseQuestions('{"questions": [{"q": "one option", "options": ["only"]}]}')).toEqual([])
  expect(parseQuestions('not json')).toBeUndefined()
})

test('the rewrite: the upgraded text and what was added', () => {
  expect(parseRewrite(REWRITE)).toEqual({ text: 'Write a one paragraph welcome for the customers of [BAKERY NAME].', added: ['audience', 'length', 'a placeholder for the name'] })
  expect(parseRewrite('{"upgraded": "  "}')).toBeUndefined()
  expect(parseRewrite('nope')).toBeUndefined()
})

test('helpers: big numbers are three rows, rows fit the pane, the tracker maps each step', () => {
  expect(bigNumber(42)).toEqual(['╻ ╻ ╺━┓', '┗━┫ ┏━┛', '  ╹ ┗━╸'])
  expect(heading('Review', 30).length).toBe(30)
  expect(cardWidth(81) * 2 + 1).toBeLessThanOrEqual(81)
  expect(trackerIndex('error', 'rewrite')).toBe(2)
  expect(trackerIndex('review')).toBe(3)
  expect(wordCount('  two words ')).toBe(2)
  expect(isDone([{ q: 'a', options: ['x', 'y'] }], { 0: null })).toBe(true)
  expect(answeredCount([{ q: 'a', options: ['x', 'y'] }], { 0: null })).toBe(0)
  expect(addHistory(Array.from({ length: 20 }, (_, i) => ({ id: i })), { id: 99 }).length).toBe(20)
})

test('the full flow: /better, two answers, the review, Run sends the upgrade as my own words', async ($, on) => {
  const w = world(on)
  await start($)
  expect(await cmd($, 'write a welcome note for my bakery')).toContain('reading your prompt') // answers at once
  await w.clock.advance(5)
  expect(w.calls).toEqual(['ask'])
  const ui = await $.ui.mount(PANE as never)
  expect(await texts(ui)).toContain('Who is it for?')
  await ui.press({ key: 'q0o0' })
  await ui.press({ key: 'q1skip' })
  expect(await texts(ui)).toContain('1 of 3 answered')
  await ui.press({ key: 'skip-rest' })
  await w.clock.advance(5)
  expect(w.calls).toEqual(['ask', 'rewrite'])
  const shown = await texts(ui)
  expect(shown).toContain('REVIEW')
  expect(shown).toContain('a placeholder for the name')
  expect(shown).toContain('Write a one paragraph welcome') // the upgrade
  expect(shown).toContain('write a welcome note for my bakery') // the original beside it
  await ui.press({ key: 'run' })
  await w.clock.advance(5)
  expect(w.submitted).toEqual(['Write a one paragraph welcome for the customers of [BAKERY NAME].'])
  expect(w.closed).toBeGreaterThan(0)
  await ui.unmount()
  await cmd($, 'history')
  await w.clock.advance(5)
  const hist = await $.ui.mount(PANE as never)
  expect(await texts(hist)).toContain('write a welcome note for my bakery')
})

test('no question would help: it goes straight to the rewrite', async ($, on) => {
  const w = world(on, { questions: '{"questions": []}' })
  await start($)
  await cmd($, 'summarise the attached design document for the board')
  await w.clock.advance(5)
  expect(w.calls).toEqual(['ask', 'rewrite'])
  expect(await texts(await $.ui.mount(PANE as never))).toContain('Run it')
})

test('Cancel closes the pane and puts the original back in the prompt box', async ($, on) => {
  const w = world(on)
  await start($)
  await cmd($, 'write a welcome note for my bakery')
  await w.clock.advance(5)
  const ui = await $.ui.mount(PANE as never)
  await ui.press({ key: 'cancel' })
  expect(w.filled).toEqual(['write a welcome note for my bakery'])
  expect(w.closed).toBeGreaterThan(0)
  expect(w.submitted).toEqual([])
})

test('a failed model call shows a calm card; Send my original sends it untouched', async ($, on) => {
  const w = world(on, { fail: true })
  await start($)
  await cmd($, 'write a welcome note for my bakery')
  await w.clock.advance(5)
  const ui = await $.ui.mount(PANE as never)
  expect(await texts(ui)).toContain('Your prompt is safe.')
  await ui.press({ key: 'original' })
  await w.clock.advance(5)
  expect(w.submitted).toEqual(['write a welcome note for my bakery'])
})

test('the pane too narrow to open: the words go back in the prompt box', async ($, on) => {
  const w = world(on, { placed: false })
  await start($)
  await cmd($, 'write a welcome note for my bakery')
  await w.clock.advance(100)
  expect(w.filled).toEqual(['write a welcome note for my bakery'])
  expect(w.calls).toEqual([])
})

test('on and off: the switch is kept, and off sends a prompt as typed', async ($, on) => {
  const w = world(on)
  await start($)
  expect(await cmd($, 'on')).toContain('on')
  expect(await cmd($, 'off')).toContain('off')
  await $.prompt.submit({ text: 'write a welcome note for my bakery' } as never)
  await w.clock.advance(5)
  expect(w.calls).toEqual([])
  expect(w.submitted).toEqual(['write a welcome note for my bakery'])
})

test('the review fits a narrow and a wide pane, with the buttons above the cards', async ($, on) => {
  const w = world(on, { questions: '{"questions": []}' })
  await start($)
  await cmd($, 'summarise the attached design document for the board')
  await w.clock.advance(5)
  for (const cols of [40, 120]) {
    const ui = await $.ui.mount(at(cols))
    const all = await ui.findAll({ type: 'Text' })
    const flat = all.map(t => t.text)
    expect(flat.findIndex(t => /Run it/.test(t))).toBeLessThan(flat.findIndex(t => /^UPGRADE$/.test(t)))
    // The prompts themselves are wrapped by their cards; every other row is sized to the pane.
    for (const t of flat.filter(x => !/design document|welcome for the customers/.test(x))) for (const line of t.split('\n')) expect(line.length, line).toBeLessThanOrEqual(cols)
    await ui.unmount()
  }
})
