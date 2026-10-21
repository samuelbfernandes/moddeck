// prompt-upgrade: turns a rough prompt into a great one before it is sent. A pane walks four steps (your prompt, up to
// three multiple-choice questions, a rewrite, a review with the original beside the upgrade); nothing runs until Run.
// /better <prompt> starts one; /better on|off sends every typed prompt there first; /better history lists the last 20.
// The upgrade is sent with $.prompt.submit, which skips this plugin's own hooks, so it can never loop back into the pane.
// FAIL OPEN: a failure in a hook lets the prompt through as typed; a failed model call shows a card and keeps the prompt.
// A draw only reads; every change of state comes from a press, a command or another event.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { UpgradeEntry, UpgradeSession, UpgradeStep } from '../types'
import {
  COLORS, STEP_NAMES, STEP_NAMES_NARROW, addHistory, answeredCount, bigNumber, cardWidth, fit, heading, isDone, isNarrow, parseQuestions,
  parseRewrite, questionsPrompt, QUESTIONS_SYSTEM, REWRITE_SYSTEM, rewritePrompt, route, rule, trackerIndex, wordCount,
} from './lib'

type Dollar = EngineInterface

const PANE = 'prompt-upgrade'
const COMMAND = 'better'
const session = atom({ plugin: 'prompt-upgrade', key: 'session' } as const, null as UpgradeSession | null)
const history = atom({ plugin: 'prompt-upgrade', key: 'history' } as const, [] as UpgradeEntry[])
const isAuto = atom({ plugin: 'prompt-upgrade', key: 'isAuto' } as const, false)

const COMMAND_HINT = 'Prompt upgrade · /better <prompt> · /better on|off · /better history'

async function isAutoOn($: Dollar): Promise<boolean> {
  try {
    return (await $.store.get('auto')) === true
  } catch {
    return false
  }
}

async function savedHistory($: Dollar): Promise<UpgradeEntry[]> {
  try {
    const v = await $.store.get('history')
    return Array.isArray(v) ? (v as UpgradeEntry[]).filter(e => e !== null && typeof e === 'object' && typeof e.text === 'string').slice(0, 20) : []
  } catch {
    return []
  }
}

const blank = (original: string, runId: number, step: UpgradeStep): UpgradeSession => ({
  runId, step, original, questions: [], answers: {}, otherFor: null, rewrite: null, isEditing: false, error: '',
})

/** Changes the session only while it is still the run that asked (a late model answer is dropped). */
const patch = ($: Dollar, runId: number, fn: (s: UpgradeSession) => UpgradeSession) =>
  update($, session, s => (s !== null && s.runId === runId ? fn(s) : s))

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 160)

/** Step 1 to 2: the fast model asks up to three questions; none that would help goes straight to the rewrite. */
async function ask($: Dollar, runId: number, original: string, options: PluginOptions): Promise<void> {
  try {
    const model = typeof options.questionModel === 'string' && options.questionModel !== '' ? options.questionModel : 'haiku'
    const r = await $.model.complete({ model, system: QUESTIONS_SYSTEM, prompt: questionsPrompt(original), maxTokens: 600, timeoutMs: 45_000 })
    const questions = r.isAnswered ? parseQuestions(r.text) : undefined
    if (questions === undefined) throw new Error(r.isAnswered ? 'the model answered in a form I could not read' : 'the model did not answer')
    if (questions.length === 0) return await toRewrite($, runId, options)
    await patch($, runId, s => ({ ...s, step: 'questions', questions }))
  } catch (error) {
    await patch($, runId, s => ({ ...s, step: 'error', failedAt: 'reading', error: message(error) }))
  }
}

/** Step 3: the upgraded prompt and a short list of what was added. */
async function toRewrite($: Dollar, runId: number, options: PluginOptions): Promise<void> {
  await patch($, runId, s => ({ ...s, step: 'rewrite', otherFor: null }))
  try {
    const s = await read($, session)
    if (s === null || s.runId !== runId) return
    const model = typeof options.rewriteModel === 'string' && options.rewriteModel !== '' ? options.rewriteModel : 'sonnet'
    const r = await $.model.complete({ model, system: REWRITE_SYSTEM, prompt: rewritePrompt(s.original, s.questions, s.answers), maxTokens: 1800, timeoutMs: 90_000 })
    const rewrite = r.isAnswered ? parseRewrite(r.text) : undefined
    if (rewrite === undefined) throw new Error(r.isAnswered ? 'the model answered in a form I could not read' : 'the model did not answer')
    await patch($, runId, cur => ({ ...cur, step: 'review', rewrite, isEditing: false }))
  } catch (error) {
    await patch($, runId, cur => ({ ...cur, step: 'error', failedAt: 'rewrite', error: message(error) }))
  }
}

/** Puts the words back in the prompt box, so nothing typed is lost. */
async function restore($: Dollar, text: string): Promise<boolean> {
  try {
    const out = (await $.prompt.fill({ text })) as { isFilled?: boolean } | undefined
    return out?.isFilled === true
  } catch {
    return false
  }
}

const closePane = ($: Dollar) => $.ui.close({ id: PANE }).catch(() => undefined)

/** Opens the pane on a fresh session. False (and the words back in the box) where no surface can draw it now. */
async function begin($: Dollar, text: string, step: UpgradeStep, options: PluginOptions): Promise<boolean> {
  const runId = await $.clock.now()
  await update($, session, () => blank(text, runId, step))
  let isPlaced = false
  try {
    isPlaced = (await $.ui.open({ id: PANE, title: 'Prompt upgrade', focus: true, closeOnEscape: true })).isPlaced
  } catch {
    isPlaced = false
  }
  if (!isPlaced) {
    await update($, session, () => null)
    await closePane($)
    return false
  }
  if (step === 'reading') void ask($, runId, text, options)
  return true
}

const NARROW_LINE = 'Prompt upgrade · the window is too narrow for the pane · your words are back in the prompt box'

/** The pane could not open: the words go back in the box and one line says why. */
function putBack($: Dollar, text: string): void {
  $.clock.after(50, () => {
    if (text !== '') void restore($, text)
    $.ui.toast(NARROW_LINE)
  })
}

async function pickAnswer($: Dollar, runId: number, i: number, value: string | null, options: PluginOptions): Promise<void> {
  await patch($, runId, s => ({ ...s, answers: { ...s.answers, [i]: value }, otherFor: s.otherFor === i ? null : s.otherFor }))
  const s = await read($, session)
  if (s !== null && s.runId === runId && s.step === 'questions' && isDone(s.questions, s.answers)) await toRewrite($, runId, options)
}

async function skipRest($: Dollar, runId: number, options: PluginOptions): Promise<void> {
  await patch($, runId, s => ({ ...s, answers: Object.fromEntries(s.questions.map((_, i) => [i, s.answers[i] ?? null])), otherFor: null }))
  await toRewrite($, runId, options)
}

async function send($: Dollar, text: string): Promise<void> {
  try {
    await $.prompt.submit({ text, asUser: true })
  } catch {
    $.ui.toast('Prompt upgrade · could not send it, your prompt is in the history')
  }
}

/** Run it: the upgrade goes to the model as my own words, the pane closes, the upgrade is kept in the history. */
async function run($: Dollar, text: string): Promise<void> {
  const s = await read($, session)
  if (s === null) return
  const entry: UpgradeEntry = { id: s.runId, at: await $.clock.now(), original: s.original, text, added: s.rewrite?.added ?? [] }
  const list = addHistory(await read($, history), entry)
  await update($, history, () => list)
  await $.store.set('history', list).catch(() => undefined)
  await update($, session, () => null)
  await closePane($)
  void send($, text)
}

async function sendOriginal($: Dollar): Promise<void> {
  const s = await read($, session)
  if (s === null) return
  await update($, session, () => null)
  await closePane($)
  void send($, s.original)
}

/** Cancel: the pane closes and the original prompt is back in the box. */
async function cancel($: Dollar): Promise<void> {
  const s = await read($, session)
  await update($, session, () => null)
  await closePane($)
  if (s !== null && s.original !== '') await restore($, s.original)
}

async function reopen($: Dollar, entry: UpgradeEntry): Promise<void> {
  const next: UpgradeSession = { ...blank(entry.original, entry.id, 'review'), rewrite: { text: entry.text, added: entry.added } }
  await update($, session, () => next)
}

export const register: Register = (on, options) => {
  const minWords = typeof options.minWords === 'number' && options.minWords >= 1 ? options.minWords : 4

  on('session.start', async ($, e, next) => {
    try {
      const isOn = await isAutoOn($)
      await update($, isAuto, () => isOn)
    } catch {
      // reads as off
    }
    try {
      const saved = await savedHistory($)
      await update($, history, list => (list.length > 0 ? list : saved))
    } catch {
      // an empty history
    }
    try {
      await $.command.register({ name: COMMAND, description: 'Upgrade a rough prompt before it is sent: /better <prompt> | on | off | history', argumentHint: '<prompt> | on | off | history', immediate: true })
    } catch {
      // automatic mode still works
    }
    // Reloaded mid-step: a model call that was in flight is lost, so it is asked again and the pane comes back.
    try {
      const s = await read($, session)
      if (s !== null) {
        const opened = await $.ui.open({ id: PANE, title: 'Prompt upgrade', focus: true, closeOnEscape: true }).catch(() => undefined)
        if (opened === undefined || !opened.isPlaced) await update($, session, () => null)
        else if (s.step === 'reading') void ask($, s.runId, s.original, options)
        else if (s.step === 'rewrite') void toRewrite($, s.runId, options)
      }
    } catch {
      // the pane stays closed
    }
    return next(e)
  })

  // A command answers at once; a pane it opens is opened a moment later, in the background.
  on('command.run', { command: COMMAND }, async ($, e) => {
    const text = e.args.trim()
    const word = text.toLowerCase()
    if (word === 'on' || word === 'off') {
      const to = word === 'on'
      if (to) await $.store.set('auto', true)
      else await $.store.delete('auto')
      await update($, isAuto, () => to)
      return { text: to ? 'Prompt upgrade · on · typed prompts go to the pane first' : 'Prompt upgrade · off · prompts are sent as typed' }
    }
    const open = (what: string, step: UpgradeStep) =>
      $.clock.after(1, () => void begin($, what, step, options).then(isOpen => (isOpen ? undefined : putBack($, what))))
    if (word === 'history') {
      open('', 'history')
      return { text: `Prompt upgrade · ${(await read($, history)).length} saved upgrades` }
    }
    if (text === '') {
      open('', 'input')
      return { text: 'Prompt upgrade · type your prompt in the pane' }
    }
    open(text, 'reading')
    return { text: 'Prompt upgrade · reading your prompt' }
  }).catch(() => ({ text: 'Prompt upgrade · that did not work, nothing changed' }))

  on('prompt.submit', async ($, e, next) => {
    try {
      if (!(await read($, isAuto)) || (await read($, session)) !== null) return next(e)
      const r = route(
        { text: e.text, origin: e.origin.kind, hasCommand: e.command !== undefined, attachments: e.attachments?.length ?? 0, isMeta: e.isMeta === true, isMidTurn: e.turnId !== undefined },
        minWords,
      )
      if (r.kind === 'pass') return next(e)
      if (r.kind === 'strip') return next({ ...e, text: r.text })
      if (!(await begin($, r.text, 'reading', options))) {
        putBack($, r.text)
        return { drop: NARROW_LINE }
      }
      return { drop: 'Prompt upgrade · your prompt is in the pane' }
    } catch {
      return next(e)
    }
  }).catch(($, e, next) => next(e))

  // The pane: only reads. Every press below changes state from its own handler.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const R = $.ui.resolve(e) as ReturnType<typeof $.ui.resolve> & { Input?: (p: Record<string, unknown>) => unknown }
    const { Box, Button, Text } = R
    const Input = R.Input
    const s = await read($, session)
    if (s === null) return next(e)
    const cols = Math.max(24, e.props.bodyColumns)
    const narrow = isNarrow(cols)
    const desk = e.surface === 'desktop' ? ({ minWidth: 0, overflow: 'hidden' } as const) : {}

    const gold = (key: string, label: string, onPress: () => void) => (
      <Button key={key} plain onPress={onPress}>
        <Text backgroundColor={COLORS.gold} color={COLORS.ink} bold>{` ${label} `}</Text>
      </Button>
    )
    const slate = (key: string, label: string, onPress: () => void, isChosen = false) => (
      <Button key={key} plain onPress={onPress}>
        <Text backgroundColor={isChosen ? COLORS.green : COLORS.hairline} color={isChosen ? COLORS.ink : COLORS.text} bold={isChosen}>{` ${label} `}</Text>
      </Button>
    )
    const quiet = (key: string, label: string, onPress: () => void) => (
      <Button key={key} plain onPress={onPress}>
        <Text color={COLORS.muted}>{label}</Text>
      </Button>
    )
    const head = (label: string, key: string) => <Text key={key} color={COLORS.muted} wrap="truncate-end">{heading(label, cols)}</Text>

    const title = 'PROMPT UPGRADE'
    const titleRow = (
      <Box key="title" flexDirection="column">
        <Text bold color={COLORS.text}>{title}</Text>
        <Text wrap="truncate-end">
          <Text color={COLORS.gold}>{rule(title.length, '━')}</Text>
          <Text color={COLORS.hairline}>{rule(cols - title.length, '─')}</Text>
        </Text>
      </Box>
    )

    const at = trackerIndex(s.step, s.failedAt)
    const names = narrow ? STEP_NAMES_NARROW : STEP_NAMES
    const tracker = (
      <Text key="tracker" wrap="truncate-end">
        {names.map((n, i) => (
          <Text key={`t${i}`} color={i < at ? COLORS.green : i === at ? COLORS.gold : COLORS.muted} bold={i === at}>
            {`${i < at ? '✓' : i === at ? '●' : '○'} ${n}${i < names.length - 1 ? '   ' : ''}`}
          </Text>
        ))}
      </Text>
    )

    const card = (key: string, label: string, text: string, width: number, outline?: string) => (
      <Box key={key} flexDirection="column" width={width} {...desk}>
        <Text color={outline ?? COLORS.muted} bold={outline !== undefined} wrap="truncate-end">{fit(label.toUpperCase(), width)}</Text>
        <Box borderStyle="round" borderColor={outline ?? COLORS.hairline} paddingX={1} width={width} {...desk}>
          <Text color={COLORS.text} wrap="wrap">{text}</Text>
        </Box>
      </Box>
    )

    const body: unknown[] = []

    if (s.step === 'input') {
      body.push(head('Your prompt', 'h-input'))
      body.push(
        Input !== undefined ? (
          <Input key="upgrade-input" label="" placeholder="Type a rough prompt, Enter to upgrade it" rows={4} autoFocus submitLabel="upgrade" onSubmit={(v: string) => { if (v.trim() !== '') void startFrom($, v.trim(), options) }} />
        ) : (
          <Text key="upgrade-noinput" color={COLORS.muted}>Type /better followed by your prompt.</Text>
        ),
      )
      body.push(<Box key="c-input">{quiet('cancel', 'Cancel', () => void cancel($))}</Box>)
    } else if (s.step === 'reading' || s.step === 'rewrite') {
      body.push(head('Your prompt', 'h-prompt'))
      body.push(card('card-orig', 'Your prompt', s.original, cols))
      body.push(<Text key="working" color={COLORS.gold}>{s.step === 'reading' ? 'Reading your prompt and choosing what to ask…' : 'Writing the upgrade from your answers…'}</Text>)
      body.push(<Box key="c-wait">{quiet('cancel', 'Cancel', () => void cancel($))}</Box>)
    } else if (s.step === 'questions') {
      const total = s.questions.length
      const count = answeredCount(s.questions, s.answers)
      body.push(head('Questions', 'h-q'))
      s.questions.forEach((q, i) => {
        const a = s.answers[i]
        const isAnswered = a !== undefined
        body.push(
          <Box key={`q${i}`} flexDirection="column">
            <Text wrap="wrap">
              <Text backgroundColor={isAnswered && a !== null ? COLORS.green : COLORS.gold} color={COLORS.ink} bold>{isAnswered && a !== null ? ' ✓ ' : ` ${i + 1} `}</Text>
              <Text color={COLORS.text} bold>{` ${q.q}`}</Text>
            </Text>
            <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginLeft={3}>
              {q.options.map((o, j) => slate(`q${i}o${j}`, fit(o, Math.max(8, cols - 8)), () => void pickAnswer($, s.runId, i, o, options), a === o))}
              {slate(`q${i}other`, 'Other (type it)', () => void update($, session, cur => (cur !== null && cur.runId === s.runId ? { ...cur, otherFor: i } : cur)), s.otherFor === i || (typeof a === 'string' && !q.options.includes(a)))}
              {a === null ? <Text key={`q${i}skipped`} color={COLORS.muted}>skipped</Text> : quiet(`q${i}skip`, 'Skip', () => void pickAnswer($, s.runId, i, null, options))}
            </Box>
            {s.otherFor === i && Input !== undefined ? (
              <Box key={`q${i}input`} marginLeft={3}>
                <Input key={`other${i}`} label="" placeholder="Your answer, Enter to keep it" autoFocus submitLabel="answer" onSubmit={(v: string) => { if (v.trim() !== '') void pickAnswer($, s.runId, i, v.trim().slice(0, 120), options) }} />
              </Box>
            ) : null}
          </Box>,
        )
      })
      body.push(
        <Box key="q-foot" columnGap={2}>
          <Text color={COLORS.muted}>{`${count} of ${total} answered`}</Text>
          {slate('skip-rest', 'Skip the rest, upgrade now', () => void skipRest($, s.runId, options))}
          {quiet('cancel', 'Cancel', () => void cancel($))}
        </Box>,
      )
    } else if (s.step === 'review' && s.rewrite !== null) {
      const up = s.rewrite
      const before = wordCount(s.original)
      const after = wordCount(up.text)
      const tiles: [string, number][] = [['words before', before], ['words after', after], ['details added', up.added.length]]
      body.push(head('Review', 'h-review'))
      body.push(
        <Box key="tiles" flexDirection="row" columnGap={1}>
          {tiles.map(([label, n]) => (
            <Box key={`tile-${label}`} flexDirection="column" borderStyle="round" borderColor={COLORS.hairline} paddingX={1}>
              {bigNumber(n).map((row, r) => <Text key={`tile-${label}-${r}`} color={label === 'details added' ? COLORS.green : COLORS.text} bold>{row}</Text>)}
              <Text color={COLORS.muted}>{label}</Text>
            </Box>
          ))}
        </Box>,
      )
      // The buttons come before the cards, so a long rewrite never pushes them off the screen.
      if (s.isEditing) {
        body.push(
          Input !== undefined ? (
            <Input key="edit-input" label="" value={up.text} rows={Math.min(10, Math.max(4, Math.ceil(up.text.length / Math.max(20, cols - 4)) + 1))} autoFocus submitLabel="run"
              onInput={(v: string) => void update($, session, cur => (cur !== null && cur.runId === s.runId && cur.rewrite !== null ? { ...cur, rewrite: { ...cur.rewrite, text: v } } : cur))}
              onSubmit={(v: string) => { if (v.trim() !== '') void run($, v.trim()) }} />
          ) : (
            <Text key="edit-none" color={COLORS.muted}>Editing needs a text field this window does not draw.</Text>
          ),
        )
        body.push(
          <Box key="edit-buttons" columnGap={1}>
            {gold('run', 'Run it', () => void run($, up.text))}
            {slate('back', 'Done editing', () => void update($, session, cur => (cur !== null && cur.runId === s.runId ? { ...cur, isEditing: false } : cur)))}
            {quiet('cancel', 'Cancel', () => void cancel($))}
          </Box>,
        )
      } else {
        body.push(
          <Box key="buttons" columnGap={1}>
            {gold('run', 'Run it', () => void run($, up.text))}
            {slate('edit', 'Edit', () => void update($, session, cur => (cur !== null && cur.runId === s.runId ? { ...cur, isEditing: true } : cur)))}
            {slate('copy', 'Copy', () => void $.ui.copy({ text: up.text, surface: e.surface }).catch(() => undefined))}
            {quiet('cancel', 'Cancel', () => void cancel($))}
          </Box>,
        )
      }
      if (up.added.length > 0) {
        body.push(head('What I added', 'h-added'))
        up.added.forEach((a, i) => body.push(<Text key={`add${i}`} color={COLORS.green} wrap="truncate-end">{`+ ${fit(a, cols - 2)}`}</Text>))
      }
      body.push(
        narrow ? (
          <Box key="cards" flexDirection="column" rowGap={1}>
            {card('card-orig', 'Your prompt', s.original, cols)}
            {card('card-up', 'Upgrade', up.text, cols, COLORS.gold)}
          </Box>
        ) : (
          <Box key="cards" flexDirection="row" columnGap={1}>
            {card('card-orig', 'Your prompt', s.original, cardWidth(cols))}
            {card('card-up', 'Upgrade', up.text, cardWidth(cols), COLORS.gold)}
          </Box>
        ),
      )
    } else if (s.step === 'error') {
      body.push(head('Something went wrong', 'h-err'))
      body.push(
        <Box key="err" flexDirection="column" borderStyle="round" borderColor={COLORS.amber} paddingX={1} width={cols} {...desk}>
          <Text color={COLORS.amber} bold>Your prompt is safe.</Text>
          <Text color={COLORS.text} wrap="wrap">{`The model call failed: ${s.error}`}</Text>
        </Box>,
      )
      body.push(
        <Box key="err-buttons" columnGap={1}>
          {gold('retry', 'Try again', () => void retry($, s, options))}
          {slate('original', 'Send my original', () => void sendOriginal($))}
          {quiet('cancel', 'Cancel', () => void cancel($))}
        </Box>,
      )
    } else if (s.step === 'history') {
      const list = await read($, history)
      body.push(head('Last 20 upgrades', 'h-hist'))
      if (list.length === 0) body.push(<Text key="none" color={COLORS.muted}>No upgrades yet.</Text>)
      list.forEach(en => body.push(
        <Box key={`hist${en.id}`}>
          {slate(`open${en.id}`, fit(en.original.replace(/\s+/g, ' '), Math.max(12, cols - 4)), () => void reopen($, en))}
        </Box>,
      ))
      body.push(<Box key="c-hist">{quiet('cancel', 'Close', () => void cancel($))}</Box>)
    }

    return (
      <Box flexDirection="column" rowGap={1} width={cols} {...desk}>
        {titleRow}
        {tracker}
        {body as never}
      </Box>
    )
  }).catch(($, e, next) => next(e))
}

async function startFrom($: Dollar, text: string, options: PluginOptions): Promise<void> {
  const runId = await $.clock.now()
  await update($, session, () => blank(text, runId, 'reading'))
  void ask($, runId, text, options)
}

async function retry($: Dollar, s: UpgradeSession, options: PluginOptions): Promise<void> {
  if (s.failedAt === 'rewrite') {
    await toRewrite($, s.runId, options)
    return
  }
  await patch($, s.runId, cur => ({ ...cur, step: 'reading', error: '' }))
  void ask($, s.runId, s.original, options)
}
