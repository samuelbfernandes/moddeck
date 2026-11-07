// moddeck: a side bar with the toolkit's mods and skills, one line each inside a card per group. A switch is the mod's name
// (green on, red off) and flips at once by running the mod's own command; another name runs its command at once when
// that is harmless, or puts it in the prompt box (`$.prompt.fill`) when it needs your text or changes something.
// Nothing here spends tokens or sends a prompt by itself.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentWizard, BtwEntry } from '../types'
import { INSTRUCTION, addEntry, buildPrompt, cutAnswer, digest, fallbackPrompt, footer, headline, isRunning, maxCharsOf, nextId, patchEntry, tokensOf, whyNot } from './btw'
import { GROUPS, MAX_LIST_ROWS, MIN_LIST_ROWS, TOOLS, allSkills, listRowsOf, listSize, priced, rankTools, searchFirst, shortDesc, slashOnly, splitCommand, starFirst, toggleStar } from './catalog'
import type { Action, InstalledSkill, Option, SavedPrompt, Tool } from './catalog'
import { CARD_CHROME, barTarget, listAt, pillText, scrollBar, stepTop, trackCells } from './layout'
import type { BottomList } from './layout'
import { AGENTS, AGENT_IDS, CHECK_PROMPT, DEFAULT_AGENT, accessOf, connectionOf, detect, isConfig, isLocalModel, isSignedIn, listModels, signInWithKey } from './agents'
import type { AgentConfig, Run } from './agents'
import { isDirty, linkedWorktree, parseStatusV2 } from './gitinfo'
import type { GitInfo } from './gitinfo'
import {
  DEFAULT_BOX,
  DEFAULT_ROWS,
  EMPTY_ACTIVITY,
  ROW_IDS,
  buildRows,
  finishRun,
  hideRow,
  layoutLines,
  parseRows,
  providerOf,
  showRow,
  startRun,
  targetOf,
} from './sessionrows'
import type { Activity, BoxSettings, EnvCounts, Layout, Part, RowId, Snapshot, TokenTotals } from './sessionrows'

import { ASK_HEADER, CHECK_EVERY_MS, LATER, RELEASE, REMOTE, SKIP, UPDATE_NOW, askText, installArgv, isNewer, latestRelease, manualCommand } from './update'

type Dollar = EngineInterface

const PANE = 'moddeck'
const TITLE = 'Moddeck'
const COLUMNS = 40
/** Wide enough for the cards with short names to sit two to a line. */
const WIDE_COLUMNS = 96
const HINT = 'Side panel · use /tui fullscreen'
const FAILED = 'Moddeck · could not open'
const PANE_SURFACES = new Set(['terminal', 'desktop'])
/**
 * The app's colours, the "Deep solid" palette in a dark and a light version: the box fill, its text, its descriptions,
 * its clickable words, and the name pills (on, off, a command). The app draws a button's text itself, in its own
 * theme's colour (light on a dark theme, dark on a light one), so a pill's fill is chosen to read under that text:
 * deep on a dark theme, a pale tint of the same hue on a light one.
 */
type Ink = { fill: string; text: string; desc: string; link: string; on: string; off: string; run: string; dotOn: string; dotOff: string; agent: string; error: string }
// agent: the External Agent box's title only (7.04:1 dark, 5.20:1 light on fill); error: failure text (5.96:1 dark, 4.58:1 light). WCAG AA checked.
const INK: Record<'dark' | 'light', Ink> = {
  dark: { fill: '#1F1F1E', text: '#ECEAE4', desc: '#9A9893', link: '#7FB2E5', on: '#166534', off: '#991B1B', run: '#374151', dotOn: '#22C55E', dotOff: '#EF4444', agent: '#5EB8B0', error: '#F87171' },
  light: { fill: '#FAF9F5', text: '#1F1F1E', desc: '#6B6A65', link: '#185FA5', on: '#BBF7D0', off: '#FECACA', run: '#E5E7EB', dotOn: '#16A34A', dotOff: '#DC2626', agent: '#0F766E', error: '#DC2626' },
}
type ThemePick = 'light' | 'dark'
const THEMES: readonly ThemePick[] = ['light', 'dark']
const isThemePick = (v: unknown): v is ThemePick => typeof v === 'string' && (THEMES as readonly string[]).includes(v)

const autoOpen = atom({ plugin: 'moddeck', key: 'autoOpen' } as const, 'new')
/** First row shown in each scrolling list (`skills`, `prompts`): a list shows a few rows at a time, with a scroll bar, when it has many. */
const tops = atom({ plugin: 'moddeck', key: 'tops' } as const, {} as Record<string, number>)
/** The updateCheck setting, set once by `register` (the open path in `toggle` reads it). */
let updateCheckOn = true
/** The Side Question panel: the last few side questions and answers, newest first (in memory only). */
/** The Side Question panel: collapsed to one button until clicked (or until /side is used). */
const btwOpen = atom({ plugin: 'moddeck', key: 'btwOpen' } as const, false)
const btwList = atom({ plugin: 'moddeck', key: 'btw' } as const, [] as BtwEntry[])
/** What the Ask here field holds: kept as it is typed, emptied after asking and by ✕ close. */
/** What each list's search field holds (`skills`, `prompts`); matching names move to the top. */
const listQuery = atom({ plugin: 'moddeck', key: 'listQuery' } as const, {} as Record<string, string>)
/** Cards folded down to their title by their ▾ button (`group:<name>`, `group:skills`, `group:prompts`); kept in the store as `folded`. null = not loaded. */
const folded = atom({ plugin: 'moddeck', key: 'folded' } as const, null as string[] | null)
/** Rows opened by their ▸ button to show the full description (`tool:<id>`, `skill:<id>`, `prompt:<id>`); kept in the store as `opened`. null = not loaded. */
const opened = atom({ plugin: 'moddeck', key: 'opened' } as const, null as string[] | null)
const btwDraft = atom({ plugin: 'moddeck', key: 'btwDraft' } as const, '')
/** The External Agent box, right under Side Question: the agent and model the setup wizard saved (also kept in the store
 * as `agent`; the external-agent mod reads it from here), its chat, and the wizard while it is open. */
const agentConf = atom({ plugin: 'moddeck', key: 'agent' } as const, null as AgentConfig | null)
const agentWiz = atom({ plugin: 'moddeck', key: 'agentWiz' } as const, null as AgentWizard | null)
/** The API key field: in memory only, emptied as soon as it is handed to the agent's own login. */
const agentKey = atom({ plugin: 'moddeck', key: 'agentKey' } as const, '')
const agentOpen = atom({ plugin: 'moddeck', key: 'agentOpen' } as const, false)
const agentList = atom({ plugin: 'moddeck', key: 'agentChat' } as const, [] as BtwEntry[])
const agentDraft = atom({ plugin: 'moddeck', key: 'agentDraft' } as const, '')
/** Answers shown in full by their "more" button; the others stop at AGENT_CLAMP_LINES lines. */
const agentFull = atom({ plugin: 'moddeck', key: 'agentFull' } as const, [] as number[])
const AGENT_CLAMP_LINES = 12
/** A newer release the person has not updated to yet (null = none known); the side bar shows a one-line button for it. */
const updateAvail = atom({ plugin: 'moddeck', key: 'updateAvail' } as const, null as string | null)
/** The expand button: the pane is drawn wide (`WIDE_COLUMNS`) instead of `COLUMNS`. */
const wide = atom({ plugin: 'moddeck', key: 'wide' } as const, false)
const DEFAULT_SKILL_ROWS = 5
/** A tool group with more tools than this gets stars and scrolls. */
const GROUP_SCROLL_AT = 8
/** Every skill the session has, as the engine lists it (null = not read yet: the toolkit's own are shown meanwhile). */
const installed = atom({ plugin: 'moddeck', key: 'installedSkills' } as const, null as InstalledSkill[] | null)
let skillsAsked = false
/** Lines each list (`skills`, `prompts`) shows, as its more/fewer buttons set it; kept in the store as `listRows`. null = not loaded. */
const listRows = atom({ plugin: 'moddeck', key: 'listRows' } as const, null as Record<string, number> | null)
/** Starred skill ids, shown at the top of the Skills box; kept in the store as `starred`. null = not loaded. */
const starred = atom({ plugin: 'moddeck', key: 'starred' } as const, null as string[] | null)

/** The list sizes and the stars, loaded from the store the first time they are asked for. */
async function rowsPicked($: Dollar): Promise<Record<string, number>> {
  const now = await read($, listRows)
  if (now !== null) return now
  const kept = (await stored<Record<string, number>>($, 'listRows')) ?? {}
  await safe(() => update($, listRows, () => kept))
  return kept
}
async function starsPicked($: Dollar): Promise<string[]> {
  const now = await read($, starred)
  if (now !== null) return now
  const kept = (await stored<string[]>($, 'starred')) ?? []
  await safe(() => update($, starred, () => kept))
  return kept
}
async function foldedPicked($: Dollar): Promise<string[]> {
  const now = await read($, folded)
  if (now !== null) return now
  const kept = (await stored<string[]>($, 'folded')) ?? []
  await safe(() => update($, folded, () => kept))
  return kept
}
async function flipFold($: Dollar, key: string): Promise<void> {
  const next = toggleStar(await foldedPicked($), key)
  await update($, folded, () => next)
  await safe(() => $.store.set('folded', next))
}
async function openedPicked($: Dollar): Promise<string[]> {
  const now = await read($, opened)
  if (now !== null) return now
  const kept = (await stored<string[]>($, 'opened')) ?? []
  await safe(() => update($, opened, () => kept))
  return kept
}
async function flipOpen($: Dollar, key: string): Promise<void> {
  const next = toggleStar(await openedPicked($), key)
  await update($, opened, () => next)
  await safe(() => $.store.set('opened', next))
}
async function setRows($: Dollar, id: string, n: number): Promise<void> {
  const next = { ...(await rowsPicked($)), [id]: n }
  await update($, listRows, () => next)
  await safe(() => $.store.set('listRows', next))
}
async function flipStar($: Dollar, id: string): Promise<void> {
  const next = toggleStar(await starsPicked($), id)
  await update($, starred, () => next)
  await safe(() => $.store.set('starred', next))
}

/** The session's skills from the engine's own listing (local estimate, no model call), with a description from the matching slash command. */
async function readSkills($: Dollar): Promise<void> {
  skillsAsked = true
  try {
    await readSkillsNow($)
  } finally {
    skillsAsked = false // asked again only while the list is still unread (`installed` is null)
  }
}
async function readSkillsNow($: Dollar): Promise<void> {
  const u = await attempt(() => $.session.usage({ breakdown: 'summary' }))
  const listed = u?.context.breakdown?.skills?.skillFrontmatter ?? []
  const cmds = (await attempt(() => $.command.list())) ?? []
  const descOf = new Map(cmds.map(c => [c.name, c.description]))
  const own = listed.map(k => ({ name: k.name, desc: descOf.get(k.name) }))
  // empty result still stops asking at every drawing
  await safe(() => update($, installed, () => [...own, ...slashOnly(cmds, new Set(listed.map(k => k.name)))]))
}
/** Where the last drawing put the pane's window and its lists, for the wheel (`ui.scroll`); a fresh load starts empty. */
let paneOffset = 0
let bottomLists: BottomList[] = []
let scrollables: Record<string, { total: number; shown: number }> = {}
const clampTop = (top: number, total: number, shown: number): number => Math.max(0, Math.min(top, total - shown))
/** What the person last picked in a dropdown here (`command-guard`, and `command-guard:last`, the level its switch goes back to): the pick shows at once, even where the other mod's state is not watched for redraws. */
const picks = atom({ plugin: 'moddeck', key: 'picks' } as const, {} as Record<string, string>)

// ---- the Session box: what is kept in memory (never in the transcript), and read by the pane ---------------------------------
type MeasureAtom = {
  context: { tokens?: number; window?: number; percent?: number }
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
  cost?: number
}
type MetaAtom = { model?: string; effort?: string | number; provider?: string; startedAt?: number; breakdown?: { name: string; tokens: number }[] }
/** The latest figures `session.measure` raised (or `session.usage()` gave at start). */
const measure = atom({ plugin: 'moddeck', key: 'measure' } as const, null as MeasureAtom | null)
const meta = atom({ plugin: 'moddeck', key: 'meta' } as const, {} as MetaAtom)
/** Git state of the working directory, refreshed at session start and after each turn; null = not a repository. */
const gitState = atom({ plugin: 'moddeck', key: 'git' } as const, null as GitInfo | null)
/** The working directory, shown with the branch in the line above the prompt. */
const cwdState = atom({ plugin: 'moddeck', key: 'cwd' } as const, '' as string)
const tokenTotals = atom({ plugin: 'moddeck', key: 'tokens' } as const, null as TokenTotals | null)
const activity = atom({ plugin: 'moddeck', key: 'activity' } as const, EMPTY_ACTIVITY as Activity)
/** The newest commit or checkpoint, ms; null = none, undefined (never set) = not read. */
const backupAt = atom({ plugin: 'moddeck', key: 'backupAt' } as const, undefined as number | null | undefined) // state is JSON data: only a number or null is ever written
/** The configured permission mode. */
const permMode = atom({ plugin: 'moddeck', key: 'permMode' } as const, undefined as string | undefined)
const EFFORT_ADVICE = { plugin: 'model-picker', key: 'effortAdvice' } as const
const ROUTED_TO = { plugin: 'model-picker', key: 'routedTo' } as const
const envCounts = atom({ plugin: 'moddeck', key: 'env' } as const, null as EnvCounts | null)
/** The rows shown (a comma list in display order) and the layout, as /moddeck rows set them; null = not set by the person (the settings apply). */
const rowsList = atom({ plugin: 'moddeck', key: 'rows' } as const, null as string | null)
const layoutPick = atom({ plugin: 'moddeck', key: 'layout' } as const, null as Layout | null)
/** `/moddeck theme light|dark`, this session's pick (kept in the store too); null = the setting. */
const themePick = atom({ plugin: 'moddeck', key: 'theme' } as const, null as ThemePick | null)

const LEDGER = { plugin: 'usage-meter', key: 'ledger' } as const
const CACHE = { plugin: 'cache-guard', key: 'cache' } as const
const KEEPWARM = { plugin: 'cache-guard', key: 'keepwarm' } as const
const JANITOR_OFF = { plugin: 'branch-janitor', key: 'isOff' } as const
const BAND_HIDDEN = { plugin: 'progress', key: 'isHidden' } as const

const HELP = [
  'Moddeck · /moddeck shows or hides the side bar',
  '/moddeck update checks for a newer release · /side <question> asks in the side bar',
  `/moddeck rows list · hide <id> · show <id> · compact · expanded`,
  '/moddeck theme light · dark (the side bar colours in the desktop app)',
  `ids: ${ROW_IDS.join(', ')}`,
].join('\n')

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback
}

function defer($: Dollar, work: () => Promise<void>): void {
  $.clock.after(1, () => {
    work().catch(() => undefined)
  })
}

// The other mods' state this side bar reads. The engine wants each reference written out here, so the list of what a
// module reads can be checked; a mod that is not installed (or a read that is refused) reads as "cannot see".
const SUGGEST_OFF = { plugin: 'model-picker', key: 'isOff' } as const
const REFLECT_OFF = { plugin: 'reflect', key: 'isOff' } as const
const SECRET_ON = { plugin: 'secret-guard', key: 'isOn' } as const
const DATA_OFF = { plugin: 'data-guard', key: 'isOff' } as const
const BIGFILE_OFF = { plugin: 'big-file-guard', key: 'isOff' } as const
const REPRO_OFF = { plugin: 'repro-log', key: 'isOff' } as const
const AUTOTEST_OFF = { plugin: 'auto-test', key: 'isOff' } as const
const PING_OFF = { plugin: 'long-run-ping', key: 'isOff' } as const
const PROMPTS = { plugin: 'prompt-library', key: 'items' } as const
const BLAST_LEVEL = { plugin: 'command-guard', key: 'level' } as const
const REVIEW_OFF = { plugin: 'review-cost', key: 'isOff' } as const
const FORMAT_OFF = { plugin: 'format-on-edit', key: 'isOff' } as const
const LEDGER_OFF = { plugin: 'test-ledger', key: 'isOff' } as const
const INBOX_OFF = { plugin: 'error-inbox', key: 'isOff' } as const
const CONCISE_OFF = { plugin: 'concise', key: 'isOff' } as const
const METHOD_OFF = { plugin: 'method-review', key: 'isOff' } as const
const VERIFY_OFF = { plugin: 'verify-before-done', key: 'isOff' } as const
const ROUTER_OFF = { plugin: 'skill-router', key: 'isOff' } as const
const UPGRADE_AUTO = { plugin: 'prompt-upgrade', key: 'isAuto' } as const
const TLDR_OFF = { plugin: 'tldr', key: 'isOff' } as const
const TLDR_MODE = { plugin: 'tldr', key: 'mode' } as const
const SKINS_PREFS = { plugin: 'skins', key: 'prefs' } as const

async function valueOf(read: Promise<unknown>): Promise<unknown> {
  try {
    return ((await read) as { value?: unknown } | undefined)?.value
  } catch {
    return undefined
  }
}

const firstLine = (text: string | undefined): string => (text ?? '').split('\n')[0]?.trim() ?? ''
/** `$.ui.log` draws one transcript line, where a newline shows as a stray glyph: the lines are joined with " · " instead. */
export const oneLine = (text: string): string =>
  text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .join(' · ')

/** Show a command's reply: its first line as a toast (the engine already prints the whole reply under the command). */
function show($: Dollar, text: string | undefined, fallback: string): void {
  $.ui.toast(firstLine((text ?? '').trim()) || fallback)
}

/** A switch click: run the mod's own `on` / `off` at once. */
async function flip($: Dollar, s: Tool, isOn: boolean): Promise<void> {
  try {
    const out = (await $.command.run({ command: s.command ?? s.id, args: isOn ? 'off' : 'on' })) as { text?: string } | undefined
    show($, out?.text, `${s.label} · ${isOn ? 'off' : 'on'}`)
  } catch {
    $.ui.toast(`Moddeck · could not switch ${s.label}`)
  }
}

/** Run the command now, or (when it needs your text or changes something) put it in the prompt box; nothing is sent. */
async function act($: Dollar, action: Action): Promise<void> {
  const typed = action.text.trim()
  try {
    if (action.run) {
      const { command, args } = splitCommand(action.text)
      const out = (await $.command.run({ command, args })) as { text?: string } | undefined
      show($, out?.text, `Moddeck · ${typed}`)
      return
    }
    const out = (await $.prompt.fill({ text: action.text } as never)) as { isFilled?: boolean } | undefined
    if (out?.isFilled === false) $.ui.toast(`Moddeck · type it yourself: ${typed}`)
  } catch {
    $.ui.toast(action.run ? `Moddeck · could not run ${typed}` : `Moddeck · type it yourself: ${typed}`)
  }
}

/** A dropdown pick: remember it for the drawing, then run the mod's own command with it. */
/** Asked when the advisor is picked while a variable keeps it off: what is in the way, and a way out. */
async function offerAdvisorFix($: Dollar, blockedBy: string, model: string): Promise<void> {
  const isTelemetry = blockedBy === 'DISABLE_TELEMETRY'
  const YES = 'Yes, go ahead'
  const NO = 'No'
  const text = isTelemetry
    ? `Using the advisor turns Claude Code's telemetry back on (DISABLE_TELEMETRY is removed from your settings), so usage data is sent to Anthropic again. Error reports stay off. OK to proceed?`
    : `Using the advisor removes CLAUDE_CODE_DISABLE_ADVISOR_TOOL from your settings. OK to proceed?`
  let answer: string
  try {
    answer = await $.ui.ask(text, { options: [YES, NO], header: 'Advisor' })
  } catch {
    return // Esc: nothing changes
  }
  if (answer !== YES) return
  const request = isTelemetry
    ? `Remove DISABLE_TELEMETRY from the env block of ~/.claude/settings.json, and if ~/.claude/moddeck/state/user.json lists "telemetry-off" under "selected", take it out so a moddeck update does not put it back. Back up both files first. Then tell me to restart and run /advisor ${model}.`
    : `Remove CLAUDE_CODE_DISABLE_ADVISOR_TOOL from the env block of ~/.claude/settings.json (back the file up first). Then tell me to restart and run /advisor ${model}.`
  await act($, { text: request, run: false })
  $.ui.toast('Press Enter to make the change')
}

async function pick($: Dollar, id: string, command: string, value: string, fillsPrompt = false, blockedBy?: string): Promise<void> {
  if (fillsPrompt && blockedBy !== undefined && value !== 'off') return offerAdvisorFix($, blockedBy, value)
  if (fillsPrompt) {
    // Claude Code's own command: a mod cannot run it, so it goes in the prompt box; the row follows the setting once sent.
    await act($, { text: `/${command} ${value}`, run: false })
    $.ui.toast(`Press Enter to run /${command} ${value}`)
    return
  }
  await safe(() => update($, picks, p => ({ ...p, [id]: value })))
  try {
    const out = (await $.command.run({ command, args: value })) as { text?: string } | undefined
    $.ui.toast(firstLine(out?.text) || `${command} · ${value}`)
  } catch {
    $.ui.toast(`Moddeck · could not set ${command} to ${value}`)
  }
}

/** command-guard's name is a switch too: off, or back to the level it had (medium the first time). */
async function flipLevel($: Dollar, t: Tool, level: string, chosen: Record<string, string>, blockedBy?: string): Promise<void> {
  const back = chosen[`${t.id}:last`] ?? t.defaultLevel ?? (t.levels?.includes('medium') ? 'medium' : t.levels?.find(l => l !== 'off')) ?? 'on'
  if (level !== 'off') await safe(() => update($, picks, p => ({ ...p, [`${t.id}:last`]: level })))
  await pick($, t.id, t.command ?? t.id, level === 'off' ? back : 'off', t.fillsPrompt === true, blockedBy)
}

async function safe(f: () => Promise<unknown>): Promise<void> {
  try {
    await f()
  } catch {
    // a pick is still run; only its early redraw is lost
  }
}

async function isPaneOpen($: Dollar): Promise<boolean> {
  return (await $.ui.panes()).some(p => p.id === PANE)
}

async function toggle($: Dollar): Promise<string> {
  await update($, autoOpen, () => 'done') // the person has taken over: never open it for them after this
  if (await isPaneOpen($)) {
    await $.ui.close({ id: PANE })
    return 'Moddeck · closed'
  }
  const opened = await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
  if (opened.isPlaced && updateCheckOn) defer($, async () => void (await checkForUpdate($, false)))
  return opened.isPlaced ? 'Moddeck · open' : 'Moddeck · waiting for room\nTry /tui fullscreen, or a wider window.'
}

// ---- Side Question: a side question answered over the cached context, shown in the side bar and never added to the chat -------
/** Opens the side bar if it is not up (a /side typed with it closed brings it), without taking over its auto-open. */
async function ensurePane($: Dollar): Promise<boolean> {
  if (await isPaneOpen($)) return true
  await update($, autoOpen, () => 'done')
  const opened = await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
  return opened.isPlaced
}

async function askBtw($: Dollar, maxChars: number, text: string): Promise<string> {
  const question = text.trim()
  if (question === '') {
    await safe(() => update($, btwOpen, () => true))
    await ensurePane($)
    return 'Side Question · type it in the box at the bottom of the side bar, or /side <question>'
  }
  const now = await $.clock.now()
  if (isRunning(await read($, btwList), now)) return 'Side Question · one is still thinking'
  if (!(await ensurePane($))) return 'Side Question · no room for the side bar\nTry /tui fullscreen, or a wider window.'
  await safe(() => update($, btwOpen, () => true)) // asking opens the panel
  const id = nextId(await read($, btwList))
  await update($, btwList, l => addEntry(l, { id, at: now, question, status: 'thinking', answer: '', isCut: false, tokens: null, note: '' }))
  defer($, async () => {
    let patch: Partial<BtwEntry>
    try {
      let r = await $.model.fork({ prompt: buildPrompt(question) })
      if (!r.isAnswered && r.reason === 'nothing-to-fork') {
        // A resumed or reloaded session has no request to fork until its next turn: ask over the transcript's text instead.
        const text = digest((await attempt(() => $.session.messages())) ?? [])
        const model = (await attempt(() => $.session.model())) ?? 'sonnet'
        if (text !== '') r = await $.model.complete({ model: typeof model === 'string' && model !== '' ? model : 'sonnet', system: INSTRUCTION, prompt: fallbackPrompt(text, question), maxTokens: 1024 })
      }
      if (!r.isAnswered) patch = { status: 'failed', note: whyNot(r) }
      else if (r.text.trim() === '') patch = { status: 'failed', note: whyNot({ reason: 'empty-reply' }) }
      else {
        const cut = cutAnswer(r.text, maxChars)
        patch = { status: 'done', answer: cut.text, isCut: cut.isCut, tokens: tokensOf(r.usage) }
      }
    } catch {
      patch = { status: 'failed', note: 'The request could not be sent' }
    }
    await update($, btwList, l => patchEntry(l, id, patch))
  })
  return 'Side Question · thinking · the answer is in the side bar'
}

// ---- External Agent: another coding agent, set up once by a wizard, working in the same conversation ---------------------------
// The side bar never starts the agent for a task itself: it calls the external-agent mod's tool, which runs it (sharing this
// conversation, able to edit by default) and goes through the permission check like any tool call. Each exchange is added to
// the main thread, so Claude and every agent see the same history. moddeck runs only the wizard's harmless probes (versions,
// sign-in status, model lists). No API key is stored by moddeck. Fail open: a failure is shown, nothing else is blocked.
const AGENT_TOOL = 'mcp__external-agent__ask'
/** An agent may take up to ten minutes; an entry still running after this no longer blocks a new task. */
const AGENT_STALE_MS = 11 * 60_000
const AGENT_MAX_CHARS = 6000
/** How much of an answer goes into the visible thread note (the model reads the whole answer in its own row). */
const AGENT_NOTE_CHARS = 1500

/** Changes the open wizard (nothing when it is closed). */
const patchWiz = ($: Dollar, f: (w: AgentWizard) => Partial<AgentWizard>) => update($, agentWiz, w => (w === null ? w : { ...w, ...f(w) }))
const agentRun = ($: Dollar): Run => (argv, init) => $.process.run(argv, init)

/** The external-agent tool: { isOk, text }. A refusal (the person said no, or the mod is missing) is a failure with its reason. */
async function callAgent($: Dollar, prompt: string, mode: 'ask' | 'review' | 'check'): Promise<{ isOk: boolean; text: string }> {
  try {
    const r = (await $.tool.call({ tool: AGENT_TOOL, prompt, mode } as never)) as { deny?: string; result?: unknown; text?: string; isError?: true }
    const body = typeof r.result === 'string' ? r.result : (r.text ?? '')
    if (r.deny !== undefined) return { isOk: false, text: `Not run · ${r.deny}` }
    return r.isError === true ? { isOk: false, text: body || 'The agent failed' } : { isOk: true, text: body }
  } catch {
    return { isOk: false, text: 'The external-agent mod is not installed (it runs the agent), or the call was stopped' }
  }
}

/** One exchange into the main thread: a row the model reads, and a note the person sees. */
async function shareInThread($: Dollar, name: string, question: string, answer: string, isOk: boolean): Promise<void> {
  const said = isOk ? `${name} replied:\n${answer}` : `${name} could not answer: ${answer}`
  await safe(() => $.session.append({ message: { type: 'user', content: [{ type: 'text', text: `[External Agent · from the side bar] The user asked ${name}: ${question}\n\n${said}` }] } } as never))
  const note = answer.length > AGENT_NOTE_CHARS ? `${answer.slice(0, AGENT_NOTE_CHARS)}…` : answer
  await safe(() => $.session.append({ message: { type: 'system', content: [{ type: 'text', text: `${name} · ${headline(question, 120)}\n${isOk ? note : `could not answer: ${note}`}` }] } } as never))
}

async function askAgentBox($: Dollar, text: string, mode: 'ask' | 'review'): Promise<string> {
  const conf = await read($, agentConf)
  if (conf === null) return 'External Agent · finish the setup first'
  const name = AGENTS[conf.agent].label
  const question = text.trim()
  if (mode === 'ask' && question === '') return 'External Agent · type a task or question in the box'
  const now = await $.clock.now()
  const list = await read($, agentList)
  if (list.some(a => a.status === 'thinking' && now - a.at < AGENT_STALE_MS)) return 'External Agent · one is still running'
  await safe(() => update($, agentOpen, () => true))
  const id = nextId(list)
  const label = mode === 'review' ? `Review my uncommitted changes${question === '' ? '' : `: ${question}`}` : question
  await update($, agentList, l => addEntry(l, { id, at: now, question: label, status: 'thinking', answer: '', isCut: false, tokens: null, note: name }))
  defer($, async () => {
    const a = await callAgent($, question, mode)
    const cut = cutAnswer(a.text, AGENT_MAX_CHARS)
    const patch: Partial<BtwEntry> = a.isOk ? { status: 'done', answer: cut.text, isCut: cut.isCut, note: name } : { status: 'failed', note: headline(a.text, 300) }
    await update($, agentList, l => patchEntry(l, id, patch))
    await shareInThread($, name, label, a.text, a.isOk)
  })
  return `External Agent · ${name} is ${mode === 'review' ? 'reviewing' : 'working'}`
}

// The wizard: agent → connection → sign-in (this machine only) → model → connection check. Slow parts run deferred.
const FRESH_WIZ = (c: AgentConfig | null): AgentWizard => ({
  step: 'agent',
  agent: c?.agent ?? DEFAULT_AGENT,
  connection: c === null ? 'local' : connectionOf(c),
  access: c === null ? 'edit' : accessOf(c),
  baseUrl: c?.baseUrl ?? '',
  found: {},
  signedIn: null,
  models: [],
  model: c?.model ?? '',
  busy: '',
  note: '',
  isOk: false,
})

async function wizOpen($: Dollar): Promise<void> {
  await update($, agentWiz, () => FRESH_WIZ(null))
  const conf = await read($, agentConf)
  await update($, agentWiz, () => FRESH_WIZ(conf))
  defer($, async () => {
    for (const id of AGENT_IDS) {
      const f = await detect(agentRun($), id)
      await patchWiz($, w => ({ found: { ...w.found, [id]: f } }))
    }
  })
}

/** After the connection step: on this machine, the sign-in check and models; through the API, the models a local server lists. */
async function wizAfterConnect($: Dollar): Promise<void> {
  const w0 = await read($, agentWiz)
  if (w0 === null) return
  const conf = await read($, agentConf)
  const keepModel = (models: string[]) => (conf !== null && conf.agent === w0.agent && (conf.model === '' || models.includes(conf.model)) ? conf.model : (models[0] ?? ''))
  if (w0.connection === 'api') {
    await patchWiz($, () => ({ step: 'model', signedIn: null, busy: 'Looking for models…', note: '' }))
    defer($, async () => {
      const models = isLocalModel(w0.agent) ? await listModels(agentRun($), w0.agent) : []
      await patchWiz($, () => ({ models, model: keepModel(models), busy: '' }))
    })
    return
  }
  await patchWiz($, () => ({ step: 'signin', signedIn: null, models: [], busy: 'Checking it is installed and signed in…', note: '', isOk: false }))
  defer($, async () => {
    const run = agentRun($)
    const found = await detect(run, w0.agent)
    if (!found.isInstalled) {
      await patchWiz($, w => ({ found: { ...w.found, [w0.agent]: found }, signedIn: false, busy: '' }))
      return
    }
    const signed = await isSignedIn(run, w0.agent)
    const models = signed ? await listModels(run, w0.agent) : []
    await patchWiz($, w => ({ found: { ...w.found, [w0.agent]: found }, signedIn: signed, models, model: keepModel(models), busy: '', step: signed ? 'model' : 'signin' }))
  })
}

async function wizUseKey($: Dollar): Promise<void> {
  const key = await read($, agentKey)
  await update($, agentKey, () => '') // the key leaves moddeck's memory at once
  const w0 = await read($, agentWiz)
  if (w0 === null || key.trim() === '') return
  await patchWiz($, () => ({ busy: 'Signing in…', note: '' }))
  defer($, async () => {
    const ok = await signInWithKey(agentRun($), w0.agent, key)
    if (ok) await wizAfterConnect($)
    else await patchWiz($, () => ({ busy: '', note: 'That key was not accepted.' }))
  })
}

/** The check runs through the external-agent mod with the wizard's choice saved first (it reads moddeck's `agent`). */
async function wizCheck($: Dollar): Promise<void> {
  const w0 = await read($, agentWiz)
  if (w0 === null || w0.busy !== '') return
  const before = await read($, agentConf)
  const trial: AgentConfig = { agent: w0.agent, model: w0.model.trim(), connection: w0.connection, access: w0.access, ...(w0.connection === 'api' && w0.baseUrl.trim() ? { baseUrl: w0.baseUrl.trim() } : {}) }
  await patchWiz($, () => ({ step: 'check', busy: 'Running the connection check…', note: '', isOk: false }))
  await update($, agentConf, () => trial)
  defer($, async () => {
    const a = await callAgent($, CHECK_PROMPT, 'check')
    if (!a.isOk) await update($, agentConf, () => before) // a failed check leaves the old choice in force
    await patchWiz($, () => ({ busy: '', isOk: a.isOk, note: headline(a.text, 300) }))
  })
}

async function wizFinish($: Dollar): Promise<void> {
  const w = await read($, agentWiz)
  const conf = await read($, agentConf)
  if (w === null || !w.isOk || conf === null) return
  await safe(() => $.store.set('agent', conf))
  await update($, agentWiz, () => null)
}

/** Cancel: back to the saved choice (a passing check may have tried another). */
async function wizCancel($: Dollar): Promise<void> {
  const saved = await attempt(() => $.store.get('agent'))
  if (isConfig(saved)) await update($, agentConf, () => saved)
  await update($, agentWiz, () => null)
}

// ---- update check: `git ls-remote --tags` for the newest release, asked once per window; nothing is installed without a yes ----
async function stored<T>($: Dollar, key: string): Promise<T | undefined> {
  try {
    return (await $.store.get(key)) as T | undefined
  } catch {
    return undefined
  }
}

/** Looks the newest release tag up (at most every CHECK_EVERY_MS unless forced) and, when it is newer and not skipped, asks. */
async function checkForUpdate($: Dollar, isForced: boolean): Promise<string> {
  const now = await $.clock.now()
  let latest = await stored<string>($, 'latest')
  const at = (await stored<number>($, 'checkedAt')) ?? 0
  if (isForced || latest === undefined || now - at >= CHECK_EVERY_MS || now < at) {
    try {
      const r = await $.process.run(['git', 'ls-remote', '--tags', '--refs', REMOTE], { timeoutMs: 20_000 })
      if (r.exitCode !== 0) return 'Moddeck · could not check for updates'
      latest = latestRelease(r.stdout)
      await $.store.set('checkedAt', now)
      if (latest !== undefined) await $.store.set('latest', latest)
    } catch {
      return 'Moddeck · could not check for updates' // offline or no git: stay quiet at start, say so on a forced check
    }
  }
  if (latest === undefined || !isNewer(latest, RELEASE)) {
    await update($, updateAvail, () => null)
    return `Moddeck ${RELEASE} · up to date`
  }
  await update($, updateAvail, () => latest ?? null)
  if (!isForced && (await stored<string>($, 'skipped')) === latest) return `Moddeck ${latest} is available (skipped)`
  await offerUpdate($, latest)
  return `Moddeck ${latest} is available`
}

async function offerUpdate($: Dollar, latest: string): Promise<void> {
  let answer: string
  try {
    answer = await $.ui.ask(askText(latest, RELEASE), { options: [UPDATE_NOW, LATER, SKIP], header: ASK_HEADER })
  } catch {
    return // Esc: ask again next time
  }
  if (answer === SKIP) {
    await $.store.set('skipped', latest)
    await update($, updateAvail, () => null)
  } else if (answer === UPDATE_NOW) await runUpdate($, latest)
}

/** The installer's documented one-liner through pipx (else uvx); the result is told in a toast and the log. */
async function runUpdate($: Dollar, latest: string): Promise<void> {
  const manual = `Moddeck · update by hand: ${manualCommand(latest)}`
  try {
    let runner: 'pipx' | 'uvx' | undefined
    for (const r of ['pipx', 'uvx'] as const) {
      try {
        if ((await $.process.run([r, '--version'], { timeoutMs: 10_000 })).exitCode === 0) {
          runner = r
          break
        }
      } catch {
        // not installed: try the next
      }
    }
    if (runner === undefined) return void $.ui.toast(manual, { timeoutMs: 15_000 })
    $.ui.toast(`Moddeck · updating to ${latest}…`)
    const out = await $.process.run(installArgv(runner, latest), { timeoutMs: 300_000 })
    if (out.exitCode === 0) {
      await update($, updateAvail, () => null)
      $.ui.toast(`Moddeck ${latest} installed · restart Claude Code to use it`, { timeoutMs: 15_000 })
    } else {
      $.ui.log(oneLine(`Moddeck update failed (exit ${out.exitCode})\n${(out.stderr || out.stdout).split('\n').slice(-8).join('\n')}`))
      $.ui.toast(manual, { timeoutMs: 15_000 })
    }
  } catch {
    $.ui.toast(manual, { timeoutMs: 15_000 })
  }
}

/** Once per session, from a timer: open where there is room; whether it docked is settled by its first drawing. */
async function autoOpenPane($: Dollar): Promise<void> {
  if ((await read($, autoOpen)) !== 'new') return
  await update($, autoOpen, () => 'done')
  if (await isPaneOpen($)) return
  const opened = await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
  if (opened.isPlaced) await update($, autoOpen, () => 'checking')
  else await $.ui.close({ id: PANE })
}

/** The expand button: close and reopen the pane at the other width; if there is no room for it, put it back as it was. */
async function expand($: Dollar): Promise<void> {
  try {
    const isWide = await read($, wide)
    await $.ui.close({ id: PANE })
    const opened = await $.ui.open({ id: PANE, title: TITLE, columns: isWide ? COLUMNS : WIDE_COLUMNS })
    if (opened.isPlaced) {
      await update($, wide, () => !isWide)
      return
    }
    await $.ui.close({ id: PANE })
    await $.ui.open({ id: PANE, title: TITLE, columns: isWide ? WIDE_COLUMNS : COLUMNS })
    $.ui.toast('Moddeck · no room to resize')
  } catch {
    $.ui.toast('Moddeck · could not resize')
  }
}

async function settleAutoOpen($: Dollar, placement: 'dock' | 'inline'): Promise<void> {
  if ((await read($, autoOpen)) !== 'checking') return
  await update($, autoOpen, () => 'done')
  if (placement !== 'dock') await $.ui.close({ id: PANE })
}


// ---- gathering the Session box's figures: every source is tried on its own and a failure only drops its row ----------------
async function attempt<T>(f: () => Promise<T>): Promise<T | undefined> {
  try {
    return await f()
  } catch {
    return undefined
  }
}

async function storedText($: Dollar, key: string): Promise<string | undefined> {
  const v = await attempt(() => $.store.get(key))
  return typeof v === 'string' ? v : undefined
}

async function nowOf($: Dollar): Promise<number> {
  const t = await attempt(() => $.clock.now())
  return typeof t === 'number' && Number.isFinite(t) ? t : Date.now()
}

function contextOf(c: { tokens?: number; window?: number; percent?: number } | undefined): MeasureAtom['context'] {
  return { tokens: c?.tokens, window: c?.window, percent: c?.percent }
}

/** `git status` and `rev-parse`, read-only and short; not a repository (or no git) leaves the atom null. */
async function refreshGit($: Dollar): Promise<void> {
  let info: GitInfo | null = null
  try {
    const st = await $.process.run(['git', '--no-optional-locks', 'status', '--porcelain=v2', '--branch'], { timeoutMs: 4000 })
    if (st.exitCode === 0) info = parseStatusV2(st.stdout) ?? null
    if (info) {
      const rev = await attempt(() => $.process.run(['git', 'rev-parse', '--git-dir', '--git-common-dir'], { timeoutMs: 2000 }))
      const worktree = rev && rev.exitCode === 0 ? linkedWorktree(rev.stdout) : undefined
      if (worktree) info = { ...info, worktree }
    }
  } catch {
    info = null
  }
  const dir = await attempt(() => $.session.cwd())
  if (typeof dir === 'string') await safe(() => update($, cwdState, () => dir))
  await safe(() => update($, gitState, () => info))
  if (info === null) return // no repository: the backup row needs git anyway
  // The newest of the last commit and the last checkpoint: what a dirty tree could be recovered from.
  const stamp = async (argv: string[]) => {
    const r = await attempt(() => $.process.run(argv, { timeoutMs: 3000 }))
    const n = r && r.exitCode === 0 ? Number(r.stdout.trim().split('\n')[0]) : NaN
    return Number.isFinite(n) && n > 0 ? n * 1000 : undefined
  }
  const times = [await stamp(['git', '--no-optional-locks', 'log', '-1', '--format=%ct']), await stamp(['git', '--no-optional-locks', 'for-each-ref', '--sort=-creatordate', '--count=1', '--format=%(creatordate:unix)', 'refs/moddeck/checkpoints'])].filter((t): t is number => t !== undefined)
  await safe(() => update($, backupAt, () => (times.length > 0 ? Math.max(...times) : null)))
}

/**
 * The app's colours: `/moddeck theme` (this session's, else saved), else the `appTheme` setting. A mod cannot see the
 * app's own light or dark choice, so the person picks it.
 */
async function inkOf($: Dollar, setting: ThemePick): Promise<Ink> {
  const stored = await storedText($, 'theme')
  return INK[(await read($, themePick)) ?? (isThemePick(stored) ? stored : setting)]
}

/** `/moddeck theme light|dark`: the side bar's colours in the app, kept for later sessions. */
async function themeCommand($: Dollar, words: string[]): Promise<string> {
  const want = words[0]
  if (words.length !== 1 || !isThemePick(want)) return 'Moddeck · /moddeck theme light or dark'
  await setTheme($, want)
  return `Moddeck · theme ${want}`
}

/** The light or dark colours, now and in later sessions: `/moddeck theme`, or the sun and moon at the top of the side bar. */
async function setTheme($: Dollar, want: ThemePick): Promise<void> {
  await update($, themePick, () => want)
  await attempt(() => $.store.set('theme', want))
}

/** The permission mode set in the settings (or a config row, where the menu has one). The mode Shift+Tab switches to mid-session is not readable by a mod. */
async function readPermissionMode($: Dollar): Promise<string | undefined> {
  const ok = (v: unknown): v is string => typeof v === 'string' && v !== ''
  const rows = await attempt(() => $.config.list())
  const row = rows?.find(r => /permission.?mode|default.?mode/i.test(r.key))
  if (row && ok(row.value)) return row.value
  const settings = (await attempt(() => $.settings.read())) as { permissions?: { defaultMode?: unknown }; defaultMode?: unknown } | undefined
  const fromSettings = settings?.permissions?.defaultMode ?? settings?.defaultMode
  return ok(fromSettings) && fromSettings !== 'default' ? fromSettings : undefined // the ordinary mode is not worth a row
}

/** CLAUDE.md files (the project root and its parents up to home, plus ~/.claude/CLAUDE.md), rules, MCP servers, hooks, plugins. */
async function countEnvironment($: Dollar): Promise<EnvCounts> {
  const out: EnvCounts = {}
  const home = await attempt(() => $.env.get('HOME'))
  const found = await attempt(() => $.fs.ancestors({ names: ['CLAUDE.md'] }))
  if (found) {
    const inHome = found.filter(f => !home || f.dir === home || f.dir.startsWith(`${home}/`))
    let n = inHome.length
    if (home) {
      const own = await attempt(() => $.fs.read(`${home}/.claude/CLAUDE.md`))
      if (typeof own === 'string') n++
    }
    out.claudeMd = n
  }
  const rules = await attempt(() => $.fs.list('.claude/rules'))
  if (rules) out.rules = rules.filter(r => r.kind === 'file' && r.name.endsWith('.md')).length
  const settings = (await attempt(() => $.settings.read())) as Record<string, unknown> | undefined
  const servers = new Set<string>()
  const norm = (n: string) => n.replace(/[^a-zA-Z0-9]/g, '_')
  const tools = await attempt(() => $.tool.list())
  for (const t of tools ?? []) {
    const name = t.mcp ? t.name.slice(5).split('__')[0] : undefined
    if (name) servers.add(norm(name))
  }
  if (settings?.mcpServers && typeof settings.mcpServers === 'object') for (const k of Object.keys(settings.mcpServers)) servers.add(norm(k))
  if (tools !== undefined || settings !== undefined) out.mcp = servers.size
  if (settings) {
    const hooks = settings.hooks
    if (hooks && typeof hooks === 'object') {
      out.hooks = Object.values(hooks as Record<string, unknown>).reduce<number>(
        (n, entries) => n + (Array.isArray(entries) ? entries.reduce<number>((m, en) => m + (Array.isArray((en as { hooks?: unknown })?.hooks) ? (en as { hooks: unknown[] }).hooks.length : 1), 0) : 0),
        0,
      )
    }
    const plugins = settings.enabledPlugins
    if (plugins && typeof plugins === 'object') out.plugins = Object.values(plugins as Record<string, unknown>).filter(v => v === true).length
  }
  return out
}

/** Once per session, from a timer: load what /moddeck rows saved, and read the model, provider, start time, environment and git. */
async function primeSession($: Dollar): Promise<void> {
  const rows = await storedText($, 'rows')
  if (rows !== undefined) await safe(() => update($, rowsList, () => rows))
  const layout = await storedText($, 'layout')
  if (layout === 'compact' || layout === 'expanded') await safe(() => update($, layoutPick, () => layout))

  const usage = await attempt(() => $.session.usage())
  const model = (await attempt(async () => ((await $.config.list()).find(r => r.key === 'model')?.value))) ?? (await attempt(() => $.session.model()))
  const env = async (name: string, f: () => Promise<string | undefined>) => (await attempt(f)) ?? ((await attempt(() => $.settings.read())) as { env?: Record<string, string> } | undefined)?.env?.[name]
  const provider = providerOf({
    bedrock: await env('CLAUDE_CODE_USE_BEDROCK', () => $.env.get('CLAUDE_CODE_USE_BEDROCK')),
    vertex: await env('CLAUDE_CODE_USE_VERTEX', () => $.env.get('CLAUDE_CODE_USE_VERTEX')),
    foundry: await env('CLAUDE_CODE_USE_FOUNDRY', () => $.env.get('CLAUDE_CODE_USE_FOUNDRY')),
    baseUrl: await env('ANTHROPIC_BASE_URL', () => $.env.get('ANTHROPIC_BASE_URL')),
  })
  await safe(() =>
    update($, meta, m => ({
      ...m,
      model: m.model ?? (typeof model === 'string' && model !== '' ? model : undefined),
      provider,
      startedAt: typeof usage?.startedAt === 'number' ? usage.startedAt : m.startedAt,
    })),
  )
  if (usage) await safe(() => update($, measure, m => m ?? { context: contextOf(usage.context), rateLimits: usage.rateLimits ?? [], cost: usage.cost?.usd }))
  const counts = await attempt(() => countEnvironment($))
  if (counts) await safe(() => update($, envCounts, () => counts))
  const mode = await readPermissionMode($)
  if (mode !== undefined) await safe(() => update($, permMode, () => mode))
  await refreshGit($)
}

/** The biggest used categories of the window, from the engine's own local estimate (`summary`: no model or token-count call). */
async function breakdownOf($: Dollar): Promise<{ name: string; tokens: number }[] | undefined> {
  const u = await attempt(() => $.session.usage({ breakdown: 'summary' }))
  const cats = u?.context.breakdown?.categories
  if (!cats) return undefined
  return cats
    .filter(c => c.kind === 'used' && c.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 3)
    .map(c => ({ name: c.name, tokens: c.tokens }))
}

async function observeMeasure($: Dollar, e: { context: MeasureAtom['context']; rateLimits: MeasureAtom['rateLimits']; cost?: { usd: number }; changed: readonly string[] }): Promise<void> {
  await update($, measure, () => ({ context: contextOf(e.context), rateLimits: e.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt })), cost: e.cost?.usd }))
  const percent = e.context.percent ?? 0
  if (percent >= 85 && e.changed.includes('context')) {
    const breakdown = await breakdownOf($)
    await update($, meta, m => ({ ...m, breakdown }))
  } else if (percent < 85) {
    const held = (await read($, meta)).breakdown
    if (held !== undefined) await update($, meta, m => ({ ...m, breakdown: undefined }))
  }
}

/** The settings the Session box reads, settled once at load. */
type Conf = { showSession: boolean; layout: Layout; rows: string; theme: ThemePick; box: Omit<BoxSettings, 'width'> }

/** What is shown now: the person's /moddeck rows choice (this session's, else saved), else the settings. */
async function currentRows($: Dollar, c: Conf): Promise<RowId[]> {
  const picked = (await read($, rowsList)) ?? (await storedText($, 'rows')) ?? c.rows
  return parseRows(picked)
}
async function currentLayout($: Dollar, c: Conf): Promise<Layout> {
  const picked = (await read($, layoutPick)) ?? (await storedText($, 'layout'))
  return picked === 'compact' || picked === 'expanded' ? picked : c.layout
}

/** `/moddeck rows ...`: change the Session box and keep it (in this plugin's store). Unknown words change nothing. */
async function rowsCommand($: Dollar, c: Conf, words: string[]): Promise<string> {
  const [verb, id] = [words[0] ?? 'list', words[1]?.toLowerCase()]
  const shownNow = await currentRows($, c)
  const describe = async () => {
    const shown = await currentRows($, c)
    const hidden = ROW_IDS.filter(r => !shown.includes(r))
    return `Rows: ${shown.join(', ') || 'none'}${hidden.length > 0 ? `\nHidden: ${hidden.join(', ')}` : ''}\nLayout: ${await currentLayout($, c)}`
  }
  if (verb === 'list' && words.length <= 1) return describe()
  if ((verb === 'compact' || verb === 'expanded') && words.length === 1) {
    await update($, layoutPick, () => verb)
    await attempt(() => $.store.set('layout', verb))
    return `Moddeck · rows ${verb}`
  }
  if ((verb === 'hide' || verb === 'show') && words.length === 2 && id !== undefined && (ROW_IDS as readonly string[]).includes(id)) {
    const next = (verb === 'hide' ? hideRow(shownNow, id as RowId) : showRow(shownNow, id as RowId)).join(',')
    await update($, rowsList, () => next)
    await attempt(() => $.store.set('rows', next))
    return `Moddeck · ${verb === 'hide' ? 'hid' : 'showing'} ${id}\n${await describe()}`
  }
  return HELP
}


/** Everything the Session box could show right now; a source that fails or is absent leaves its field out. */
async function snapshotOf($: Dollar): Promise<Snapshot> {
  const now = await nowOf($)
  let m = await read($, measure)
  const held = await read($, meta)
  let startedAt = held.startedAt
  if (m === null || startedAt === undefined) {
    const u = await attempt(() => $.session.usage())
    if (u) {
      startedAt = typeof u.startedAt === 'number' ? u.startedAt : startedAt
      m = m ?? { context: contextOf(u.context), rateLimits: u.rateLimits ?? [], cost: u.cost?.usd }
    }
  }
  const ledger = await valueOf($.state.get(LEDGER as never))
  const cache = await valueOf($.state.get(CACHE as never))
  const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined)
  const l = obj(ledger)
  const c = obj(cache)
  const nn = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : v === null ? null : undefined)
  return {
    now,
    model: held.model,
    provider: held.provider,
    effort: held.effort,
    startedAt,
    context: m?.context,
    breakdown: held.breakdown,
    rateLimits: m?.rateLimits,
    cost: m?.cost,
    ledger: l ? { today: nn(l.today) ?? undefined, week: nn(l.week) } : undefined,
    cache: c ? { expiresAt: nn(c.expiresAt), hitRate: nn(c.hitRate) } : undefined,
    git: await read($, gitState),
    permissionMode: await read($, permMode),
    backupAt: await read($, backupAt),
    routedTo: ((v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined))(await valueOf($.state.get(ROUTED_TO as never))),
    effortAdvice: ((v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined))(await valueOf($.state.get(EFFORT_ADVICE as never))),
    tokens: await read($, tokenTotals),
    activity: await read($, activity),
    env: await read($, envCounts),
  }
}


export const register: Register = (on, options) => {
  const isAutoOpen = options.autoOpen !== false
  const rows = typeof options.skillRows === 'number' && options.skillRows >= 1 ? Math.floor(options.skillRows) : DEFAULT_SKILL_ROWS
  const conf: Conf = {
    showSession: options.showSession !== false,
    layout: options.sessionLayout === 'compact' ? 'compact' : 'expanded',
    rows: typeof options.sessionRows === 'string' ? options.sessionRows : DEFAULT_ROWS,
    theme: isThemePick(options.appTheme) ? options.appTheme : 'dark',
    box: {
      sevenDayAt: num(options.usageSevenDayAt, DEFAULT_BOX.sevenDayAt),
      toolsMaxVisible: Math.max(1, Math.floor(num(options.toolsMaxVisible, DEFAULT_BOX.toolsMaxVisible))),
      pushWarn: Math.max(1, num(options.pushWarn, DEFAULT_BOX.pushWarn)),
      envThreshold: num(options.envThreshold, DEFAULT_BOX.envThreshold),
    },
  }
  const showSession = conf.showSession
  updateCheckOn = options.updateCheck !== false
  const btwMax = maxCharsOf(options.btwMaxChars)

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'moddeck', description: 'Show or hide the moddeck side bar; "rows" sets what its Session box shows' })
    } catch {
      // the side bar can still be opened another way
    }
    try {
      await $.command.register({ name: 'side', description: 'Ask a side question in the moddeck side bar; the answer is not added to the conversation: /side <question>', argumentHint: '<question>', immediate: true })
    } catch {
      // without it the box at the bottom of the side bar still takes questions
    }
    // The External Agent set up in an earlier session; none yet means the box opens on its setup wizard.
    defer($, async () => {
      const saved = await attempt(() => $.store.get('agent'))
      if (isConfig(saved)) await update($, agentConf, () => saved)
      else if ((await read($, agentWiz)) === null) await wizOpen($)
    })
    if (updateCheckOn) defer($, async () => void (await checkForUpdate($, false))) // every time it is turned on: a quiet look at the newest release
    if (showSession) defer($, () => primeSession($)) // reading only: never blocks the start
    defer($, () => readSkills($)) // the Skills box lists every installed skill
    if (isAutoOpen && e.isInteractive && e.surface !== null && PANE_SURFACES.has(e.surface)) defer($, () => autoOpenPane($))
    return next(e)
  })

  on('command.run', { command: 'moddeck' }, async ($, e) => {
    const words = String((e as { args?: unknown }).args ?? '').trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) return { text: await toggle($) }
    if (words[0]!.toLowerCase() === 'update') return { text: await checkForUpdate($, true) }
    if (words[0]!.toLowerCase() === 'theme') return { text: await themeCommand($, words.slice(1).map(w => w.toLowerCase())) }
    if (words[0]!.toLowerCase() === 'rows') return { text: await rowsCommand($, conf, words.slice(1).map(w => w.toLowerCase())) }
    return { text: HELP }
  }).catch(() => ({ text: FAILED }))

  on('command.run', { command: 'side' }, async ($, e) => ({ text: await askBtw($, btwMax, String((e as { args?: unknown }).args ?? '')) })).catch(() => ({ text: 'Side Question · could not ask' }))

  // ---- observers for the Session box: each lets the event through first (or, for a step, before it), and only keeps books ----
  on('session.measure', async ($, e, next) => {
    const out = await next(e)
    try {
      await observeMeasure($, e as never)
    } catch {
      // the box shows the last figures it had
    }
    return out
  })

  // A step streams, so this hook is a generator that forwards the stream untouched; the books are kept from a timer, off its path.
  on('turn.step', async function* ($, e, next) {
    try {
      defer($, async () => {
        if (e.agentId !== undefined) return // a subagent's model is not the session's
        const held = await read($, meta)
        if (held.model !== e.model || held.effort !== e.effort) await update($, meta, m => ({ ...m, model: e.model, effort: e.effort }))
      })
    } catch {
      // the model row keeps what it had
    }
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const out = await next(e)
    try {
      if (e.agentId === undefined) {
        const u = e.usage
        if (u) {
          const tps = e.durationMs >= 500 && u.output_tokens > 0 ? u.output_tokens / (e.durationMs / 1000) : undefined
          await update($, tokenTotals, t => ({
            input: (t?.input ?? 0) + u.input_tokens,
            output: (t?.output ?? 0) + u.output_tokens,
            cacheRead: (t?.cacheRead ?? 0) + u.cache_read_input_tokens,
            cacheWrite: (t?.cacheWrite ?? 0) + u.cache_creation_input_tokens,
            tokensPerSecond: tps ?? t?.tokensPerSecond,
          }))
        }
        if (showSession) defer($, () => refreshGit($))
      }
    } catch {
      // the totals keep their last value
    }
    return out
  })

  on('tool.call', async ($, e, next) => {
    const id = String((e as { tool_use_id?: unknown }).tool_use_id ?? '')
    const name = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const target = name === 'Skill' && typeof input.skill === 'string' ? input.skill : targetOf(input)
    try {
      void update($, activity, a => startRun(a, { id, name, target, state: 'running' })).catch(() => undefined)
    } catch {
      // nothing is kept for this call
    }
    const out = await next(e)
    try {
      const failed = (out as { isError?: boolean; deny?: unknown } | undefined)?.isError === true || (out as { deny?: unknown } | undefined)?.deny !== undefined
      await update($, activity, a => finishRun(a, id, failed ? 'error' : 'done'))
    } catch {
      // a call may stay marked running
    }
    return out
  }).catch(($, e, next) => next(e)) // a failed book-keeping never refuses the call

  on('session.compact', async ($, e, next) => {
    const out = await next(e)
    try {
      const done = e.agentId === undefined && e.trigger !== 'precompute' && typeof (out as { skip?: unknown } | undefined)?.skip !== 'string'
      if (done) await update($, activity, a => ({ ...a, compactions: a.compactions + 1 }))
    } catch {
      // the count keeps its last value
    }
    return out
  }).catch(($, e, next) => next(e))

  // The mouse wheel over a long list (Skills, Prompts) scrolls that list; anywhere else it scrolls the pane as usual.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const hit = e.pointer === undefined ? undefined : listAt(bottomLists, e.contentRows, paneOffset + e.pointer.row)
    const list = hit === undefined ? undefined : scrollables[hit.id]
    if (hit === undefined || list === undefined || e.by === 0) return next(e)
    await update($, tops, t => ({ ...t, [hit.id]: clampTop((t[hit.id] ?? 0) + e.by, list.total, list.shown) }))
    return {}
  }).catch(($, e, next) => next(e)) // a failed list scroll still scrolls the pane

  // The line above the prompt: the folder and the branch, like the path line in RStudio's console.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const [dir, g] = [await read($, cwdState), await read($, gitState)]
    if (dir === '' && !g) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const home = dir.replace(/^\/(Users|home)\/[^/]+/, '~')
    const line = (
      <Box key="moddeck-where" columnGap={1}>
        {g && <Text bold color={isDirty(g) ? 'warning' : 'success'}>{`⎇ ${g.branch}${isDirty(g) ? '*' : ''}`}</Text>}
        {home !== '' && <Text dimColor wrap="truncate-start">{home}</Text>}
      </Box>
    )
    let below: unknown
    try {
      below = await next(e)
    } catch {
      below = undefined
    }
    return below !== null && typeof below === 'object' ? (
      <Box key="moddeck-where-band" flexDirection="column">
        {line}
        {below as never}
      </Box>
    ) : (
      line
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const R = $.ui.resolve(e) as ReturnType<typeof $.ui.resolve> & { Input?: (p: Record<string, unknown>) => unknown }
    const { Box, Button, Select, Text } = R
    const Input = R.Input
    if ((await read($, autoOpen)) === 'checking') defer($, () => settleAutoOpen($, e.props.placement))
    const isInline = e.props.placement === 'inline' || e.viewport?.isFullscreen === false
    if (e.surface === 'terminal' && isInline) return <Text dimColor>{HINT}</Text>
    paneOffset = e.props.scroll?.offset ?? 0
    // The desktop app lays boxes out like a web page: a box never shrinks below its text unless told it may (minWidth 0),
    // and text past its box is clipped (with "…") only when the box hides overflow. It also draws a Button's `label`
    // instead of its children, so there a Button gets no label and a switch's colour is the box around its name.
    // The terminal's tree is left exactly as it was.
    const desk = e.surface === 'desktop'
    const fit = desk ? ({ minWidth: 0, overflow: 'hidden' } as const) : {}
    // The app's boxes are filled and their text coloured from INK; the terminal keeps its theme's colours.
    const ink = desk ? await inkOf($, conf.theme) : undefined
    const fill = ink ? { backgroundColor: ink.fill } : {}
    const inked = ink ? { color: ink.text } : {}
    const dim = ink ? { color: ink.desc } : { dimColor: true }
    const link = ink?.link ?? 'suggestion'
    const cols = Math.max(20, e.props.bodyColumns)
    const room = Math.max(10, cols - CARD_CHROME)

    // Every line is one row: coloured parts inside one Text, so a pane narrower than the line cuts it with "…".
    const partsLine = (key: string, parts: readonly Part[]) => (
      <Text key={key} wrap="truncate-end">
        {parts.map((p, i) => (
          <Text key={`${key}:${i}`} color={p.color ?? (ink ? (p.dim ? ink.desc : ink.text) : undefined)} dimColor={ink ? undefined : p.dim} bold={p.bold}>
            {p.text}
          </Text>
        ))}
      </Text>
    )
    // A card: a bold title, then a round box whose rows are parted by thin rules (the look of the Session box).
    const rule = (key: string) => (
      <Text key={key} {...dim} wrap="truncate-end">
        {'─'.repeat(300)}
      </Text>
    )
    // A card: its title with a ▾ that folds the card down to the title alone (▸ opens it again), then its bordered box.
    const foldedNow = await foldedPicked($)
    const card = (key: string, title: string, rowsOf: unknown[], opts: { width?: number | string; rules?: boolean; count?: number } = {}) => {
      const isFolded = foldedNow.includes(key)
      const shownTitle = isFolded && opts.count !== undefined && !title.includes(' · ') ? `${title} · ${opts.count}` : title
      return (
        <Box key={key} flexDirection="column" width={opts.width} flexShrink={1} {...fit}>
          <Box columnGap={1} {...fit}>
            <Button key={`title:${key}`} plain label={desk ? undefined : isFolded ? `open ${title}` : `fold ${title}`} onPress={() => void flipFold($, key)}>
              <Text bold wrap="truncate-end">
                {shownTitle}
              </Text>
            </Button>
            <Button key={`fold:${key}`} plain label={desk ? undefined : isFolded ? `open ${title}` : `fold ${title}`} onPress={() => void flipFold($, key)}>
              <Text color={link}>{isFolded ? '▸' : '▾'}</Text>
            </Button>
          </Box>
          {!isFolded && (
            <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={1} {...fill} {...fit}>
              {(opts.rules === false ? rowsOf : rowsOf.flatMap((r, i) => (i === 0 ? [r] : [rule(`${key}:rule:${i}`), r]))) as never}
            </Box>
          )}
        </Box>
      )
    }

    // The Session box at the top: live figures from the engine, each row hidden when its figure is missing.
    let sessionBox: unknown = null
    if (showSession) {
      try {
        const settings: BoxSettings = { ...conf.box, width: room }
        const built = buildRows(await snapshotOf($), settings)
        const shown = (await currentRows($, conf)).map(id => built[id]).filter((r): r is NonNullable<typeof r> => r !== undefined)
        const lines = layoutLines(shown, await currentLayout($, conf), settings.width)
        if (lines.length > 0) {
          sessionBox = (
            <Box key="session" flexDirection="column" borderStyle="round" paddingX={1} {...fill} {...fit}>
              <Text bold {...inked}>
                Session
              </Text>
              {lines.map(l => (
                <Box key={`session:row:${l.key}`} {...fit}>
                  {partsLine(`session:line:${l.key}`, l.parts)}
                </Box>
              ))}
            </Box>
          )
        }
      } catch {
        sessionBox = null // the side bar still draws without it
      }
    }

    // The Side Question panel, right under the Session box: one line until clicked, then the last answers and a field.
    const btws = await read($, btwList)
    const isBtwOpen = await read($, btwOpen)
    // The Side Question box: its title (hover it for what it does), an "Ask here" field beside it, and the last answers below.
    const thinking = btws.some(b => b.status === 'thinking')
    const draft = await read($, btwDraft)
    const ask = (v: string) => {
      void update($, btwDraft, () => '')
      void askBtw($, btwMax, v).then(t => $.ui.toast(t.split('\n')[0] ?? t))
    }
    // Hovering the title lights the "btw-tip" group, which reveals the tip card laid over the box just below the title row.
    const btwTitle = (
      <Box key="btw:title" flexShrink={0} hover={{ scope: 'btw-tip' }}>
        <Text bold {...inked}>{`Side Question${thinking ? ' …' : ''}`}</Text>
      </Box>
    )
    const btwTip = (
      <Box position="absolute" top={1} left={0} right={0} display="none" hover={{ scope: 'btw-tip', display: 'flex' }} borderStyle="round" paddingX={1} {...fill}>
        <Text {...dim} wrap="wrap">
          Ask about this session without adding anything to the chat. The answer shows here only. $ spends model tokens.
        </Text>
      </Box>
    )
    const btwHead = (
      <Box key="btw:head" columnGap={1} alignItems="center" {...fit}>
        {btws.length > 0 && (
          <Button key="btw:toggle" plain label={desk ? undefined : isBtwOpen ? 'hide answers' : 'show answers'} onPress={() => void update($, btwOpen, o => !o)}>
            <Text {...inked}>{isBtwOpen ? "▾" : `▸ ${btws.length}`}</Text>
          </Button>
        )}
        {btwTitle}
        <Box flexGrow={1} flexShrink={1} {...fit}>
          {Input !== undefined ? (
            <Input key="btw:input" placeholder="Ask here" submitLabel="ask" value={draft} onInput={(v: string) => void update($, btwDraft, () => v)} onSubmit={(v: string) => ask(v)} />
          ) : (
            <Text {...dim} wrap="truncate-end">
              type /side your question
            </Text>
          )}
        </Box>
      </Box>
    )
    const btwBox = (
      <Box key="btw" flexDirection="column" borderStyle="round" paddingX={1} {...fill} {...fit}>
        {btwHead}
        {btwTip}
        {isBtwOpen &&
          btws.slice(0, 2).map(b => (
            <Box key={`btw:${b.id}`} flexDirection="column">
              <Text color={link} wrap="truncate-end">{`› ${headline(b.question, room)}`}</Text>
              {b.answer !== '' && (
                <Text {...inked} wrap="wrap">
                  {b.answer}
                </Text>
              )}
              <Text {...dim} wrap="truncate-end">
                {footer(b)}
              </Text>
              {b.status !== 'thinking' && (
                <Button key={`btw:close:${b.id}`} plain onPress={() => {
                    void update($, btwList, l => l.filter(a => a.id !== b.id))
                    void update($, btwDraft, () => '') // a fresh field for the next question
                  }}>
                  <Text color={link}>✕ close</Text>
                </Button>
              )}
            </Box>
          ))}
      </Box>
    )

    // The External Agent box, right under Side Question: its title on top, then the setup wizard (first time, or ⚙ change)
    // or the conversation with the agent, newest last, and a field that grows with what is typed.
    const agentCfg = await read($, agentConf)
    const wiz = await read($, agentWiz)
    const chats = await read($, agentList)
    const keyDraft = await read($, agentKey)
    const chatBusy = chats.some(b => b.status === 'thinking')
    const accent = ink?.agent ?? 'suggestion'
    const errorInk = ink?.error ?? 'error'
    const choiceLine = (c: AgentConfig) =>
      `${AGENTS[c.agent].label} · ${connectionOf(c) === 'api' ? 'API' : 'this machine'} · ${connectionOf(c) === 'api' ? 'answers only' : accessOf(c) === 'edit' ? 'can edit' : 'read-only'}`
    const head = (
      <Box key="agent:head" columnGap={1} alignItems="center" {...fit}>
        <Box key="agent:title" flexShrink={0} hover={{ scope: 'agent-tip' }}>
          <Text bold color={accent}>{`External Agent $${chatBusy || (wiz !== null && wiz.busy !== '') ? ' …' : ''}`}</Text>
        </Box>
        <Box flexGrow={1} flexShrink={1} {...fit}>
          {agentCfg !== null && wiz === null && (
            <Text {...dim} wrap="truncate-end">
              {choiceLine(agentCfg)}
            </Text>
          )}
        </Box>
        {wiz === null && (
          <Box key="agent:setup:box" flexShrink={0}>
            <Button key="agent:setup" plain label="change the agent, connection or model" onPress={() => void wizOpen($)}>
              <Text color={link}>⚙ change</Text>
            </Button>
          </Box>
        )}
      </Box>
    )
    const tip = (
      <Box position="absolute" top={1} left={0} right={0} display="none" hover={{ scope: 'agent-tip', display: 'flex' }} borderStyle="round" paddingX={1} {...fill}>
        <Text {...dim} wrap="wrap">
          Hand a task to another coding agent (Codex by default; Gemini, a local model through Ollama or LM Studio, or Claude Code). It sees this conversation, and by default can edit files and run commands in the project inside its own sandbox; each task asks your permission first. Its answer is added to the chat so Claude sees it too. Each task uses that agent's quota.
        </Text>
      </Box>
    )
    let body: unknown[] = []
    if (wiz !== null) {
      const steps: AgentWizard['step'][] = wiz.connection === 'api' ? ['agent', 'connect', 'model', 'check'] : ['agent', 'connect', 'signin', 'model', 'check']
      const back = (step: AgentWizard['step']) => (
        <Button key={`agent:back:${step}`} plain onPress={() => void patchWiz($, () => ({ step, busy: '', note: '' }))}>
          <Text color={link}>← back</Text>
        </Button>
      )
      const cancel =
        agentCfg !== null || (await attempt(() => $.store.get('agent'))) !== undefined ? (
          <Button key="agent:cancel" plain onPress={() => void wizCancel($)}>
            <Text color={link}>cancel</Text>
          </Button>
        ) : null
      const choose = (key: string, isOn: boolean, label: string, onPress: () => void) => (
        <Button key={key} plain onPress={onPress}>
          <Text color={link} wrap="truncate-end">{`${isOn ? '●' : '○'} ${label}`}</Text>
        </Button>
      )
      body.push(
        <Box key="agent:wiz:top" columnGap={2} {...fit}>
          <Text bold {...inked} wrap="wrap">
            {`Setup · step ${steps.indexOf(wiz.step) + 1} of ${steps.length}`}
          </Text>
          {cancel}
        </Box>,
      )
      if (wiz.step === 'agent') {
        body.push(<Text key="agent:wiz:q" {...inked} wrap="wrap">Which agent should Claude work with?</Text>)
        for (const id of AGENT_IDS) {
          const f = wiz.found[id]
          const state = f === undefined ? 'checking…' : f.isInstalled ? `installed${f.version ? ` · ${headline(f.version, 28)}` : ''}` : f.version ? f.version : 'not found on this machine'
          body.push(choose(`agent:pick:${id}`, wiz.agent === id, `${AGENTS[id].label}${id === DEFAULT_AGENT ? ' (default)' : ''} · ${state}`, () => void patchWiz($, () => ({ agent: id, step: 'connect', baseUrl: '', model: '' }))))
        }
      } else if (wiz.step === 'connect') {
        const a = AGENTS[wiz.agent]
        body.push(<Text key="agent:wiz:cq" {...inked} wrap="wrap">{`How should Claude connect to ${a.label}?`}</Text>)
        body.push(choose('agent:conn:local', wiz.connection === 'local', `On this machine (default)${isLocalModel(wiz.agent) ? ' · runs inside Codex' : ''} · full tools`, () => void patchWiz($, () => ({ connection: 'local' }))))
        body.push(choose('agent:conn:api', wiz.connection === 'api', 'Through its API (opt-in) · answers only, no tools', () => void patchWiz($, () => ({ connection: 'api' }))))
        if (wiz.connection === 'local') {
          body.push(<Text key="agent:wiz:aq" {...inked} wrap="wrap">What may it do?</Text>)
          body.push(choose('agent:access:edit', wiz.access === 'edit', 'Edit files and run commands in this project (sandboxed)', () => void patchWiz($, () => ({ access: 'edit' }))))
          body.push(choose('agent:access:read', wiz.access === 'read', 'Read only', () => void patchWiz($, () => ({ access: 'read' }))))
          if (wiz.agent === 'claude' && wiz.access === 'edit') body.push(<Text key="agent:wiz:cl" {...dim} wrap="wrap">Claude Code can edit files here, but not run commands: nobody can approve them in a background run.</Text>)
          if (!a.isVerified) body.push(<Text key="agent:wiz:uv" {...dim} wrap="wrap">{`${a.label} was not installed when this was built: the connection check shows whether it works.`}</Text>)
        } else {
          if (Input !== undefined) body.push(<Input key="agent:url" placeholder={a.apiBase} submitLabel="set" value={wiz.baseUrl} onInput={(v: string) => void patchWiz($, () => ({ baseUrl: v }))} onSubmit={(v: string) => void patchWiz($, () => ({ baseUrl: v }))} />)
          body.push(<Text key="agent:wiz:key" {...dim} wrap="wrap">{`Address: ${wiz.baseUrl.trim() || a.apiBase}. A key, if this API needs one, goes in /config › external-agent › API key (kept in secure storage; local servers need none).`}</Text>)
        }
        body.push(
          <Box key="agent:conn:row" columnGap={2}>
            {back('agent')}
            <Button key="agent:conn:next" plain onPress={() => void wizAfterConnect($)}>
              <Text color={link}>next →</Text>
            </Button>
          </Box>,
        )
      } else if (wiz.step === 'signin') {
        const a = AGENTS[wiz.agent]
        if (wiz.busy !== '') body.push(<Text key="agent:busy" {...dim}>{wiz.busy}</Text>)
        else if (wiz.found[wiz.agent]?.isInstalled === false) {
          const why = isLocalModel(wiz.agent) && wiz.found[wiz.agent]?.version ? `${a.label} is here, but Codex, which runs it, is not.` : `${a.label} is not installed on this machine.`
          body.push(<Text key="agent:missing" color={errorInk} wrap="wrap">{`${why} Install it, then check again, or go back and use its API.`}</Text>)
        } else if (wiz.signedIn === false) {
          body.push(<Text key="agent:nosign" {...inked} wrap="wrap">{`${a.label} is installed but not signed in, so it cannot run here yet.`}</Text>)
          if (a.takesApiKey && Input !== undefined) {
            body.push(
              <Input key="agent:key" placeholder="API key (visible while typing; the agent stores it, moddeck does not)" submitLabel="sign in" value={keyDraft} onInput={(v: string) => void update($, agentKey, () => v)} onSubmit={() => void wizUseKey($)} />,
            )
          }
          body.push(<Text key="agent:howto" {...dim} wrap="wrap">{`${a.takesApiKey ? 'Or run' : 'Run'} \`${a.signIn}\` in a terminal, then check again.`}</Text>)
        }
        if (wiz.note !== '') body.push(<Text key="agent:note" color={errorInk} wrap="wrap">{wiz.note}</Text>)
        if (wiz.busy === '') {
          body.push(
            <Box key="agent:signin:row" columnGap={2}>
              {back('connect')}
              <Button key="agent:recheck" plain onPress={() => void wizAfterConnect($)}>
                <Text color={link}>↻ check again</Text>
              </Button>
            </Box>,
          )
        }
      } else if (wiz.step === 'model') {
        if (wiz.busy !== '') body.push(<Text key="agent:busy" {...dim}>{wiz.busy}</Text>)
        if (wiz.connection === 'local' && wiz.signedIn === true) body.push(<Text key="agent:signed" {...dim} wrap="wrap">{`${AGENTS[wiz.agent].label} is ready on this machine · no API key needed`}</Text>)
        body.push(<Text key="agent:wiz:m" {...inked}>Pick a model, or type one:</Text>)
        const choices = ['', ...wiz.models].slice(0, 13)
        for (const m of choices) body.push(choose(`agent:model:${m || 'default'}`, wiz.model === m, m || "the agent's own default", () => void patchWiz($, () => ({ model: m }))))
        if (Input !== undefined) body.push(<Input key="agent:model:typed" placeholder="model name" submitLabel="use" value={wiz.models.includes(wiz.model) ? '' : wiz.model} onInput={(v: string) => void patchWiz($, () => ({ model: v }))} onSubmit={(v: string) => void patchWiz($, () => ({ model: v.trim() }))} />)
        body.push(
          <Box key="agent:model:row" columnGap={2}>
            {back(wiz.connection === 'api' ? 'connect' : 'signin')}
            <Button key="agent:next" plain onPress={() => void wizCheck($)}>
              <Text color={link}>next: connection check →</Text>
            </Button>
          </Box>,
        )
      } else {
        body.push(<Text key="agent:wiz:c" {...inked} wrap="wrap">{`Connection check: ${AGENTS[wiz.agent].label}${wiz.model ? ` (${wiz.model})` : ''} answers a one-word question. It asks your permission first.`}</Text>)
        if (wiz.busy !== '') body.push(<Text key="agent:busy" {...dim}>{`${wiz.busy} (up to a minute)`}</Text>)
        else if (wiz.note !== '') body.push(<Text key="agent:note" color={wiz.isOk ? accent : errorInk} wrap="wrap">{wiz.isOk ? `✓ ${wiz.note}` : wiz.note}</Text>)
        if (wiz.busy === '') {
          body.push(
            <Box key="agent:check:row" columnGap={2}>
              {back('model')}
              {wiz.isOk ? (
                <Button key="agent:finish" plain onPress={() => void wizFinish($)}>
                  <Text color={link}>finish ✓</Text>
                </Button>
              ) : (
                <Button key="agent:check" plain onPress={() => void wizCheck($)}>
                  <Text color={link}>{wiz.note === '' ? 'run the check' : '↻ try again'}</Text>
                </Button>
              )}
            </Box>,
          )
        }
      }
    } else if (agentCfg !== null) {
      const isAgentOpen = await read($, agentOpen)
      const draftText = await read($, agentDraft)
      const fullIds = await read($, agentFull)
      const askIt = (v: string, mode: 'ask' | 'review') => {
        if (mode === 'ask') void update($, agentDraft, () => '')
        void askAgentBox($, v, mode).then(t => $.ui.toast(t))
      }
      // The field grows with the text: one row per line (long lines wrap), up to eight.
      const width = Math.max(10, room - 6)
      const fieldRows = Math.min(8, Math.max(1, draftText.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / width)), 0)))
      const thread = isAgentOpen ? [...chats].reverse() : []
      // Until the first answer, say what the agent may do here: the tip on hover is not seen by everyone.
      const scope = connectionOf(agentCfg) === 'api' ? 'answer questions only' : accessOf(agentCfg) === 'edit' ? 'read and edit this project and run commands' : 'read this project'
      const hint = `${AGENTS[agentCfg.agent].label} can ${scope}.${connectionOf(agentCfg) === 'api' ? '' : ' Each task asks your permission first.'}`
      body = [
        ...(chats.length === 0 ? [<Text key="agent:hint" {...dim} wrap="wrap">{hint}</Text>] : []),
        ...thread.map(b => {
          const lines = b.answer.split('\n')
          const isLong = lines.length > AGENT_CLAMP_LINES
          const isFull = fullIds.includes(b.id)
          return (
            <Box key={`agent:${b.id}`} flexDirection="column">
              <Text color={link} wrap="wrap">{`› ${b.question}`}</Text>
              {b.answer !== '' && (
                <Text {...inked} wrap="wrap">
                  {isLong && !isFull ? `${lines.slice(0, AGENT_CLAMP_LINES).join('\n')}\n…` : b.answer}
                </Text>
              )}
              {b.status === 'failed' ? (
                <Text color={errorInk} wrap="wrap">
                  {b.note}
                </Text>
              ) : (
                <Text {...dim} wrap="truncate-end">
                  {b.status === 'thinking' ? `${b.note} is working… stops after 10 min · you can keep chatting` : `${b.note} · added to the chat${b.isCut ? ' · cut here' : ''}`}
                </Text>
              )}
              {b.status !== 'thinking' && (
                <Box columnGap={2}>
                  {isLong && (
                    <Button key={`agent:more:${b.id}`} plain onPress={() => void update($, agentFull, l => (l.includes(b.id) ? l.filter(i => i !== b.id) : [...l, b.id]))}>
                      <Text color={link}>{isFull ? '▴ less' : '▾ more'}</Text>
                    </Button>
                  )}
                  <Button key={`agent:close:${b.id}`} plain onPress={() => void update($, agentList, l => l.filter(a => a.id !== b.id))}>
                    <Text color={link}>✕ hide</Text>
                  </Button>
                </Box>
              )}
            </Box>
          )
        }),
        <Box key="agent:row" columnGap={1} alignItems="flex-start" {...fit}>
          {chats.length > 0 && (
            <Button key="agent:toggle" plain label={desk ? undefined : isAgentOpen ? 'hide the conversation' : 'show the conversation'} onPress={() => void update($, agentOpen, o => !o)}>
              <Text {...inked}>{isAgentOpen ? '▾' : `▸ ${chats.length}`}</Text>
            </Button>
          )}
          <Box flexGrow={1} flexShrink={1} {...fit}>
            {Input !== undefined ? (
              <Input key="agent:input" placeholder={`Give ${AGENTS[agentCfg.agent].label} a task`} submitLabel="send" rows={fieldRows} value={draftText} onInput={(v: string) => void update($, agentDraft, () => v)} onSubmit={(v: string) => askIt(v, 'ask')} />
            ) : (
              <Text {...dim} wrap="truncate-end">
                type /agent your task
              </Text>
            )}
          </Box>
        </Box>,
        <Box key="agent:opts" columnGap={2} {...fit}>
          <Button key="agent:model" plain label="pick another model" onPress={() => void wizOpen($).then(() => patchWiz($, () => ({ step: 'connect' })))}>
            <Text color={link} wrap="truncate-end">{`model: ${agentCfg.model || 'default'} ▾`}</Text>
          </Button>
          <Button key="agent:review" plain label="review my uncommitted changes" onPress={() => askIt('', 'review')}>
            <Text color={link}>review changes</Text>
          </Button>
        </Box>,
      ]
    } else {
      body = [<Text key="agent:loading" {...dim}>Loading…</Text>]
    }
    const agentBox = (
      <Box key="agent" flexDirection="column" borderStyle="round" paddingX={1} {...fill} {...fit}>
        {head}
        {tip}
        {body as never}
      </Box>
    )

    // Switches: only the ones whose state this side bar can read. Each switch reads its own mod's state; a mod that is not
    // installed (or not readable) is simply not drawn.
    const flag = (v: unknown, isOff: boolean): boolean | undefined => (typeof v === 'boolean' ? (isOff ? !v : v) : undefined)
    const ons: Record<string, boolean | undefined> = {
      'model-picker': flag(await valueOf($.state.get(SUGGEST_OFF as never)), true),
      reflect: flag(await valueOf($.state.get(REFLECT_OFF as never)), true),
      'secret-guard': flag(await valueOf($.state.get(SECRET_ON as never)), false),
      'data-guard': flag(await valueOf($.state.get(DATA_OFF as never)), true),
      'big-file-guard': flag(await valueOf($.state.get(BIGFILE_OFF as never)), true),
      'repro-log': flag(await valueOf($.state.get(REPRO_OFF as never)), true),
      'auto-test': flag(await valueOf($.state.get(AUTOTEST_OFF as never)), true),
      'long-run-ping': flag(await valueOf($.state.get(PING_OFF as never)), true),
      'review-cost': flag(await valueOf($.state.get(REVIEW_OFF as never)), true),
      'format-on-edit': flag(await valueOf($.state.get(FORMAT_OFF as never)), true),
      'test-ledger': flag(await valueOf($.state.get(LEDGER_OFF as never)), true),
      'error-inbox': flag(await valueOf($.state.get(INBOX_OFF as never)), true),
      concise: flag(await valueOf($.state.get(CONCISE_OFF as never)), true),
      'method-review': flag(await valueOf($.state.get(METHOD_OFF as never)), true),
      'verify-before-done': flag(await valueOf($.state.get(VERIFY_OFF as never)), true),
      'skill-router': flag(await valueOf($.state.get(ROUTER_OFF as never)), true),
      'prompt-upgrade': flag(await valueOf($.state.get(UPGRADE_AUTO as never)), false),
      tldr: flag(await valueOf($.state.get(TLDR_OFF as never)), true),
      'branch-janitor': flag(await valueOf($.state.get(JANITOR_OFF as never)), true), // null outside a repository: not drawn
      'progress': flag(await valueOf($.state.get(BAND_HIDDEN as never)), true),
      // cache-guard's switch is keep-warm: on while /keepwarm runs (its state holds the run), off when it is null.
      'cache-guard': await (async () => { const kw = await valueOf($.state.get(KEEPWARM as never)); return kw === undefined ? undefined : kw !== null })(),
    }
    const blast = await valueOf($.state.get(BLAST_LEVEL as never))
    const chosen = await read($, picks)
    // The level the dropdown shows: the person's last pick, else the mod's own state; undefined = the mod is not readable.
    // The advisor is Claude Code's own (/advisor): its model is the advisorModel setting; two variables keep it off.
    const settingsNow = (await attempt(() => $.settings.read())) as { advisorModel?: unknown; env?: Record<string, string> } | undefined
    const savedAdvisor = typeof settingsNow?.advisorModel === 'string' && settingsNow.advisorModel !== '' ? settingsNow.advisorModel : 'off'
    const envOf = (v: string | undefined, fromSettings: string | undefined) => (v !== undefined && v !== "" ? v : fromSettings)
    const noTelemetry = envOf(await attempt(() => $.env.get('DISABLE_TELEMETRY')), settingsNow?.env?.DISABLE_TELEMETRY)
    const noAdvisor = envOf(await attempt(() => $.env.get('CLAUDE_CODE_DISABLE_ADVISOR_TOOL')), settingsNow?.env?.CLAUDE_CODE_DISABLE_ADVISOR_TOOL)
    const advisorBlock = noAdvisor === '1' ? 'CLAUDE_CODE_DISABLE_ADVISOR_TOOL' : noTelemetry === '1' ? 'DISABLE_TELEMETRY' : undefined
    // tldr's level: off, or the mode it is in (highlight or summary); undefined while the mod is not readable.
    const tldrModeNow = await valueOf($.state.get(TLDR_MODE as never))
    // skins' level is the skin in use (or off); undefined while the mod is not readable.
    const skinPrefs = await valueOf($.state.get(SKINS_PREFS as never))
    const skinNow = typeof (skinPrefs as { skin?: unknown } | undefined)?.skin === 'string' ? (skinPrefs as { skin: string }).skin : undefined
    const levelOf: Record<string, string | undefined> = {
      skins: skinNow,
      'command-guard': chosen['command-guard'] ?? (typeof blast === 'string' ? blast : undefined),
      advisor: savedAdvisor, // the setting: /advisor writes it, a pick here only fills the prompt box
      tldr: ons.tldr === undefined ? undefined : ons.tldr ? (tldrModeNow === 'highlight' ? 'highlight' : 'summary') : 'off',
    }
    // A level the list does not name (a saved "sonnet") is still shown as picked.
    const levelsOf = (t: Tool): string[] => (t.levels !== undefined && levelOf[t.id] !== undefined && !t.levels.includes(levelOf[t.id]!) ? [...t.levels, levelOf[t.id]!] : (t.levels ?? []))
    const descOf = (t: Tool): string | undefined =>
      t.id === 'advisor' && advisorBlock !== undefined ? `Kept off by ${advisorBlock}=1 · pick a model to see the fix` : t.desc

    // One line per tool: its name (a green or red pill when it is a switch), its controls, then its description, which
    // takes what is left and is cut with "…". The descriptions, icons and groups are presentation only.
    const isOnOf = (t: Tool): boolean | undefined => (t.levels !== undefined ? (levelOf[t.id] === undefined ? undefined : levelOf[t.id] !== 'off') : ons[t.id])
    const visible = (t: Tool): boolean => (t.isSwitch || t.levels !== undefined ? isOnOf(t) !== undefined : true)
    const actionsShown = (t: Tool): Option[] => (t.isSwitch && !isOnOf(t) ? [] : (t.options ?? []))
    // Text that a line cuts off ("…") shows in full on hover: the tip is a card laid over the line just below it, lit by
    // the "tip:<id>" hover group that the line's name, buttons and description all belong to (like the Side Question tip).
    const tipHover = (id: string) => ({ scope: `tip:${id}` })
    const tipCard = (id: string, text: string) => (
      <Box key={`tip:${id}`} position="absolute" top={1} left={0} right={0} display="none" hover={{ scope: `tip:${id}`, display: 'flex' }} borderStyle="round" paddingX={1} {...fill}>
        <Text {...(ink ? { color: ink.text } : {})} wrap="wrap">
          {text}
        </Text>
      </Box>
    )
    const howRuns = (a: Action) => (a.run ? `Runs ${a.text.trim()}` : `Puts ${a.text.trimEnd()} in the prompt box`)
    const action = (key: string, label: string, act1: Action, costs?: boolean) => (
      <Box key={`hover:${key}`} flexShrink={0} hover={tipHover(key)}>
        <Button key={key} plain onPress={() => act($, act1)}>
          <Text color={link}>{`[${priced(label, costs)}]`}</Text>
        </Button>
      </Box>
    )
    const nameOf = (t: Tool) => priced(t.label, t.costs)
    const openRows = await openedPicked($)
    // The ▸ / ▾ button that opens a row's full description under it; the row itself stays one line.
    const expander = (key: string, label: string) => (
      <Box key={`open:${key}`} flexShrink={0}>
        <Button key={`expand:${key}`} plain label={desk ? undefined : `${openRows.includes(key) ? 'collapse' : 'expand'} ${label}`} onPress={() => void flipOpen($, key)}>
          <Text color={link}>{openRows.includes(key) ? '▾' : '▸'}</Text>
        </Button>
      </Box>
    )
    const detail = (key: string, text: string) =>
      openRows.includes(key) && (
        <Box key={`detail:${key}`} paddingLeft={2} {...fit}>
          <Text {...dim} wrap="wrap">
            {text}
          </Text>
        </Box>
      )
    const line = (t: Tool, nameWidth: number) => {
      const isOn = isOnOf(t)
      const text = pillText(nameOf(t), nameWidth)
      const press = () => (t.levels !== undefined ? flipLevel($, t, levelOf[t.id]!, chosen, t.id === 'advisor' ? advisorBlock : undefined) : flip($, t, isOn!))
      const run = () => (t.click ? act($, t.click) : undefined)
      // In the app every name is a pill (INK): green or red for a switch, gray for a command that runs on click. The pill box
      // has no padding of its own, so the whole coloured area is the button (its text carries the air on each side).
      // The name in a small box drawn like the group cards, tight around the name (no padding), its line dimmed for a
      // lighter stroke. The box itself lights on hover, so the box and the hover highlight are one area.
      const pillOf = (key: string, color: string, onPress: () => unknown) => (
        <Box key={`pill:${t.id}`} borderStyle="round" borderColor="inactive" borderDimColor backgroundColor={color} hover={{ backgroundColor: ink?.run }} paddingX={0} paddingY={0} margin={0} flexShrink={0}>
          <Button key={key} plain onPress={onPress as () => void}>
            <Text bold color={ink?.text}>
              {nameOf(t)}
            </Text>
          </Button>
        </Box>
      )
      // Every name sits in the same neutral box; a switch says on or off only by the dot after it (green on, red off).
      const name = desk ? (
        pillOf(isOn === undefined ? `tool:${t.id}` : `switch:${t.id}`, ink!.fill, isOn === undefined ? run : press)
      ) : (
        <Button key={isOn === undefined ? `tool:${t.id}` : `switch:${t.id}`} plain label={isOn === undefined ? undefined : `${t.label} switch, ${isOn ? 'on' : 'off'}`} onPress={isOn === undefined ? run : press}>
          <Text bold inverse>
            {text}
          </Text>
        </Button>
      )
      const dot = isOn !== undefined && (
        <Box key={`dot:${t.id}`} flexShrink={0}>
          <Text color={isOn ? (ink?.dotOn ?? 'success') : (ink?.dotOff ?? 'error')}>●</Text>
        </Box>
      )
      const level = t.levels !== undefined && (
        <Select key={`level:${t.id}`} value={levelOf[t.id]!} options={levelsOf(t).map(v => ({ value: v }))} onSelect={(v: string) => pick($, t.id, t.command ?? t.id, v, t.fillsPrompt === true, t.id === 'advisor' ? advisorBlock : undefined)} />
      )
      const full = descOf(t) ?? t.note
      return (
        <Box key={`row:${t.id}`} flexDirection="column" {...fit}>
        <Box columnGap={1} {...fit}>
          {full !== undefined && expander(`tool:${t.id}`, t.label)}
          <Box flexShrink={0} columnGap={1} hover={tipHover(t.id)}>
            {name}
            {dot as never}
            {level as never}
          </Box>
          <Box flexShrink={0} columnGap={1}>
            {actionsShown(t).map(o => action(`option:${t.id}:${o.text}`, o.label, o, o.costs))}
          </Box>
          <Box flexGrow={1} flexShrink={1} {...fit} hover={tipHover(t.id)}>
            <Text {...dim} wrap="truncate-end">
              {full === undefined ? '' : shortDesc(full)}
            </Text>
          </Box>
          {actionsShown(t).map(o => tipCard(`option:${t.id}:${o.text}`, howRuns(o)))}
        </Box>
        {full !== undefined && detail(`tool:${t.id}`, `${full}${t.costs ? ' ($ spends model tokens)' : ''}`)}
        </Box>
      )
    }
    const groupTools = GROUPS.map(g => ({ g, tools: TOOLS.filter(t => t.group === g && visible(t)) })).filter(x => x.tools.length > 0)
    // One column: every card on its own line, the full width of the pane.
    // A group with more than GROUP_SCROLL_AT tools gets stars: starred tools first, the card sized to fit them (at least
    // MIN_LIST_ROWS, GROUP_SCROLL_AT when none is starred), and ▲ ▼ to scroll the rest.
    const groupTops = await read($, tops)
    const groupStars = await starsPicked($)
    const starOf = (t: Tool) => `tool:${t.id}`
    const toolCards = groupTools.map(({ g, tools: listed }) => {
      const nameWidth = Math.max(...listed.map(t => nameOf(t).length))
      const isBig = listed.length > GROUP_SCROLL_AT
      // Starred tools first (only big groups have stars), then switches that are on; redone on every draw.
      const tools = rankTools(listed, t => isBig && groupStars.includes(starOf(t)), t => isOnOf(t) === true)
      if (!isBig) return card(`group:${g}`, g, tools.map(t => line(t, nameWidth)), { count: tools.length })
      const starredCount = tools.filter(t => groupStars.includes(starOf(t))).length
      const shown = listSize(starredCount, GROUP_SCROLL_AT, tools.length)
      const listId = `group:${g}`
      const top = clampTop(groupTops[listId] ?? 0, tools.length, shown)
      const moveTo = (to: number) => void update($, tops, t => ({ ...t, [listId]: to }))
      const rowsShown = tools.slice(top, top + shown).map(t => (
        <Box key={`${listId}:row:${t.id}`} columnGap={1} {...fit}>
          <Box flexShrink={0}>
            <Button key={`star:${starOf(t)}`} plain label={desk ? undefined : `star ${t.id}`} onPress={() => void flipStar($, starOf(t))}>
              <Text color={groupStars.includes(starOf(t)) ? link : (ink?.desc ?? 'inactive')}>{groupStars.includes(starOf(t)) ? '★' : '☆'}</Text>
            </Button>
          </Box>
          <Box flexGrow={1} flexShrink={1} {...fit}>
            {line(t, nameWidth) as never}
          </Box>
        </Box>
      ))
      const arrow = (dir: 'up' | 'down') => (
        <Button key={`${listId}:${dir}`} plain label={desk ? undefined : `${g} ${dir}`} onPress={() => moveTo(stepTop(top, dir === 'up' ? -1 : 1, shown, tools.length))}>
          <Text color={(dir === 'up' ? top > 0 : top + shown < tools.length) ? link : (ink?.desc ?? 'inactive')}>{dir === 'up' ? '▲' : '▼'}</Text>
        </Button>
      )
      return card(listId, `${g} · ${tools.length}`, [
        <Box key={`${listId}:window`} columnGap={1} {...fit}>
          <Box flexDirection="column" flexGrow={1} flexShrink={1} {...fit}>
            {rowsShown.flatMap((r, i) => (i === 0 ? [r] : [rule(`${listId}:rule:${i}`), r])) as never}
          </Box>
          <Box key={`${listId}:arrows`} flexDirection="column" justifyContent="space-between" flexShrink={0}>
            {arrow('up')}
            {arrow('down')}
          </Box>
        </Box>,
      ])
    })

    // Skills and saved prompts: a card each, `rows` lines at a time, with a scroll bar on the right when there are more.
    // A click on the bar's track moves a page; the wheel over the list moves it a line.
    const scrolled = await read($, tops)
    const picked = await rowsPicked($)
    const stars = await starsPicked($)
    const rowsOf = (id: string) => listRowsOf(picked, id, rows)
    const queries = await read($, listQuery)
    const listCard = <T,>(id: string, title: string, listed: readonly T[], keyOf: (item: T) => string, label: (item: T) => string, desc: (item: T) => string, text: (item: T) => string, star?: (item: T) => string) => {
      // Typing in the search field moves the names that match to the top (those that start with it first); Enter picks the first.
      const query = queries[id] ?? ''
      const found = searchFirst(listed, query, label)
      const items = found.items
      const isSearching = query.trim() !== ''
      const starredCount = star === undefined ? 0 : items.filter(i => stars.includes(star(i))).length
      const want = rowsOf(id)
      const shown = listSize(starredCount, want, items.length)
      const top = isSearching ? 0 : clampTop(scrolled[id] ?? 0, items.length, shown)
      const isHit = (n: number) => isSearching && top + n < found.matches
      // In the app a name starts with "/": a click puts its command in the prompt box.
      const nameOf = (item: T) => (desk ? `/${label(item)}` : label(item))
      const nameWidth = Math.max(...items.map(i => nameOf(i).length))
      const lines = items.slice(top, top + shown).map((item, n) => (
        <Box key={`${id}:line:${keyOf(item)}`} flexDirection="column" {...fit}>
        <Box columnGap={1} {...fit}>
          {desc(item) !== '' ? expander(keyOf(item), label(item)) : null}
          {star !== undefined && (
            <Box flexShrink={0}>
              <Button key={`star:${star(item)}`} plain label={desk ? undefined : `star ${label(item)}`} onPress={() => void flipStar($, star(item))}>
                <Text color={stars.includes(star(item)) ? link : (ink?.desc ?? 'inactive')}>{stars.includes(star(item)) ? '★' : '☆'}</Text>
              </Button>
            </Box>
          )}
          <Box flexShrink={0} hover={tipHover(keyOf(item))}>
            <Button key={keyOf(item)} plain onPress={() => act($, { text: text(item), run: false })}>
              <Text bold color={link} underline={isHit(n) && n === 0}>
                {nameOf(item).padEnd(nameWidth)}
              </Text>
            </Button>
          </Box>
          <Box flexGrow={1} flexShrink={1} {...fit} hover={tipHover(keyOf(item))}>
            <Text {...dim} wrap="truncate-end">
              {shortDesc(desc(item))}
            </Text>
          </Box>
        </Box>
        {desc(item) !== '' && detail(keyOf(item), desc(item))}
        </Box>
      ))
      const cells = trackCells(shown)
      const arrows = cells < shown
      const moveTo = (to: number) => void update($, tops, t => ({ ...t, [id]: to }))
      const arrow = (dir: 'up' | 'down') => (
        <Button key={`${id}:${dir}`} plain label={desk ? undefined : `${title} ${dir}`} onPress={() => moveTo(stepTop(top, dir === 'up' ? -1 : 1, shown, items.length))}>
          <Text color={link}>{dir === 'up' ? '▲' : '▼'}</Text>
        </Button>
      )
      const bar = items.length > shown && (
        <Box key={`${id}:bar`} flexDirection="column" flexShrink={0}>
          {arrows && arrow('up')}
          {scrollBar(top, shown, items.length, cells).map((cell, i) => (
            <Button key={`${id}:bar:${i}`} plain label={desk ? undefined : `${title} scroll bar`} onPress={() => moveTo(barTarget(top, shown, items.length, i, cells))}>
              <Text color={cell === 'thumb' ? link : (ink?.desc ?? 'inactive')}>{cell === 'thumb' ? '┃' : '│'}</Text>
            </Button>
          ))}
          {arrows && arrow('down')}
        </Box>
      )
      const heading = isSearching ? `${title} · ${found.matches === 0 ? 'no match' : `${found.matches} found`}` : items.length > shown ? `${title} · ${items.length}` : title
      return card(`group:${id}`, heading, [
        <Box key={`${id}:window`} columnGap={1} {...fit}>
          <Box flexDirection="column" flexGrow={1} flexShrink={1} {...fit}>
            {lines}
          </Box>
          {bar as never}
        </Box>,
        <Box key={`${id}:size`} columnGap={1} {...fit}>
          <Box flexGrow={1} flexShrink={1} {...fit}>
            {Input !== undefined ? (
              <Input
                key={`${id}:search`}
                placeholder={`Search ${title.toLowerCase()}`}
                submitLabel="use"
                value={query}
                onInput={(v: string) => void update($, listQuery, q => ({ ...q, [id]: v }))}
                onSubmit={() => {
                  const first = isSearching && found.matches > 0 ? items[0] : undefined
                  if (first !== undefined) void act($, { text: text(first), run: false })
                  void update($, listQuery, q => ({ ...q, [id]: '' }))
                }}
              />
            ) : (
              <Text {...dim}> </Text>
            )}
          </Box>
          {starredCount === 0 && !isSearching && want < Math.min(items.length, MAX_LIST_ROWS) && (
            <Button key={`${id}:more`} plain label={desk ? undefined : 'more lines'} onPress={() => void setRows($, id, want + 1)}>
              <Text {...dim}>＋</Text>
            </Button>
          )}
          {starredCount === 0 && !isSearching && shown > MIN_LIST_ROWS && (
            <Button key={`${id}:fewer`} plain label={desk ? undefined : 'fewer lines'} onPress={() => void setRows($, id, shown - 1)}>
              <Text {...dim}>−</Text>
            </Button>
          )}
        </Box>,
      ])
    }
    if (!skillsAsked && (await read($, installed)) === null) defer($, () => readSkills($))
    const skills = starFirst(allSkills((await read($, installed)) ?? []), stars, k => k.id)
    const skillCard = skills.length > 0 ? listCard('skills', 'Skills', skills, k => `skill:${k.id}`, k => k.label, k => k.desc, k => k.text, k => k.id) : null
    // Saved prompts (prompt-library): a click puts the text in the prompt box. Not drawn while that mod is not readable.
    const saved = await valueOf($.state.get(PROMPTS as never))
    const savedPrompts: SavedPrompt[] = Array.isArray(saved)
      ? (saved as unknown[]).filter((p): p is SavedPrompt => typeof (p as SavedPrompt)?.name === 'string' && typeof (p as SavedPrompt)?.text === 'string')
      : []
    const prompts = starFirst(savedPrompts, stars, p => `prompt:${p.name}`)
    const promptCard = prompts.length > 0 ? listCard('prompts', 'Prompts', prompts, p => `prompt:${p.name}`, p => p.name, p => p.text, p => p.text, p => `prompt:${p.name}`) : null
    // Where the lists sit, counted from the bottom, for the wheel: the lowest first.
    const skillShown = listSize(skills.filter(k => stars.includes(k.id)).length, rowsOf('skills'), skills.length)
    const promptShown = listSize(prompts.filter(p => stars.includes(`prompt:${p.name}`)).length, rowsOf('prompts'), prompts.length)
    const listFor = (id: string, shown: number) => (foldedNow.includes(`group:${id}`) ? { id, shown: 0, folded: true } : { id, shown, under: 2 })
    bottomLists = [...(prompts.length > 0 ? [listFor('prompts', promptShown)] : []), ...(skills.length > 0 ? [listFor('skills', skillShown)] : [])]
    scrollables = { skills: { total: skills.length, shown: skillShown }, prompts: { total: prompts.length, shown: promptShown } }

    const wideNow = await read($, wide)
    const updateNow = await read($, updateAvail)
    return (
      <Box flexDirection="column" gap={1} {...fit}>
        {/* The desktop's own frame already has the title, an expand and a close button; under it, the sun and the moon
            pick the light or dark colours (the one in use at full strength, the other dim). */}
        {desk && (
          <Box key="themes" columnGap={2} {...fit}>
            <Button key="theme:light" plain dimColor={ink === INK.light ? undefined : true} onPress={() => void setTheme($, 'light')}>
              ☀
            </Button>
            <Button key="theme:dark" plain dimColor={ink === INK.dark ? undefined : true} onPress={() => void setTheme($, 'dark')}>
              ☾
            </Button>
          </Box>
        )}
        {!desk && (
          <Box justifyContent="space-between">
            <Text bold>Moddeck</Text>
            <Button key="expand" plain label={wideNow ? 'Narrow the panel' : 'Expand the panel'} onPress={() => expand($)}>
              <Text color="suggestion">{wideNow ? '⤡' : '⤢'}</Text>
            </Button>
          </Box>
        )}
        {updateNow !== null && (
          <Button key="update" plain onPress={() => void offerUpdate($, updateNow)}>
            <Text color="warning" wrap="truncate-end">{`⬆ Moddeck ${updateNow} is available · click to update`}</Text>
          </Button>
        )}
        {sessionBox as never}
        {btwBox as never}
        {agentBox as never}
        {toolCards}
        {skillCard as never}
        {promptCard as never}
        <Text dimColor wrap="truncate-end">
          green on · red off · click a name · $ = spends model tokens
        </Text>
      </Box>
    )
  })
}
