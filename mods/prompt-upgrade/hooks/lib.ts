// prompt-upgrade: pure helpers. Which prompts the mod takes, the prompts to the models, reading their answers, and the
// three-row numbers and the fitted rows the pane draws.
import type { UpgradeQuestion, UpgradeRewrite } from '../types'

export const MAX_HISTORY = 20
export const MAX_QUESTIONS = 3
export const MAX_PROMPT_CHARS = 8000

export const COLORS = {
  gold: '#F2C46D',
  hairline: '#262B33',
  muted: '#7D8590',
  text: '#E6EDF3',
  green: '#3DD68C',
  amber: '#E3B341',
  ink: '#0D1117',
} as const

const WORDS = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length
export const wordCount = (s: string): number => (s.trim() === '' ? 0 : WORDS(s))

/** Replies that never need an upgrade. */
const SHORT_REPLY = /^(y|n|yes|no|yep|nope|ok|okay|sure|go|go on|go ahead|continue|keep going|proceed|thanks|thank you|do it|sounds good|lgtm|stop|done|next)[.!? ]*$/i

export type Route =
  | { kind: 'take'; text: string }
  | { kind: 'pass' }
  | { kind: 'strip'; text: string }

/** The facts of a submission that decide where it goes. */
export type Submission = {
  text: string
  origin: string
  hasCommand: boolean
  attachments: number
  isMeta: boolean
  /** Typed while a turn was running. */
  isMidTurn: boolean
}

/**
 * Automatic mode: take a typed prompt into the pane, or let it through. Slash commands, attachments, messages sent
 * while Claude works, short replies and anything not typed at the prompt go on untouched; one that starts with ">"
 * goes on with the ">" removed.
 */
export function route(s: Submission, minWords: number): Route {
  const text = s.text.trim()
  if (s.origin !== 'composer' || s.isMeta || s.hasCommand || s.attachments > 0 || s.isMidTurn) return { kind: 'pass' }
  if (text === '' || text.startsWith('/')) return { kind: 'pass' }
  if (text.startsWith('>')) return { kind: 'strip', text: text.replace(/^>\s*/, '') }
  if (SHORT_REPLY.test(text) || wordCount(text) < minWords) return { kind: 'pass' }
  return { kind: 'take', text }
}

export const QUESTIONS_SYSTEM = [
  'You help someone sharpen a rough prompt before they send it to an AI assistant.',
  `Ask at most ${MAX_QUESTIONS} multiple-choice questions whose answers would most improve the result. Ask only what the prompt leaves open and a different answer would change the output (goal, audience, format, scope, what done looks like).`,
  'Each question has 2 to 4 short options (a few words each). Never ask about something the prompt already says.',
  'If no question would help, return an empty list.',
  'Answer with JSON only: {"questions": [{"q": string, "options": string[]}]}.',
].join('\n')

export const REWRITE_SYSTEM = [
  'You rewrite a rough prompt into one great prompt the person could have typed themselves.',
  'Keep exactly what they meant. Add a clear goal, who it is for, the format, and what "done" looks like.',
  'Use what they answered to the questions; leave out what they skipped.',
  'Never invent facts, names, numbers or prices. Where something is unknown, leave a [placeholder] in square brackets.',
  'Write it as one request in plain language, no preamble, no markdown headings.',
  'Answer with JSON only: {"upgraded": string, "added": string[]} where added lists, in a few words each, the details you added (at most 6).',
].join('\n')

const clip = (s: string): string => (s.length > MAX_PROMPT_CHARS ? `${s.slice(0, MAX_PROMPT_CHARS)}\n[cut]` : s)

export const questionsPrompt = (original: string): string => `The rough prompt:\n\n${clip(original)}`

export function rewritePrompt(original: string, questions: readonly UpgradeQuestion[], answers: Readonly<Record<number, string | null>>): string {
  const lines = questions.map((q, i) => {
    const a = answers[i]
    return `- ${q.q} ${a === undefined || a === null ? '(skipped)' : `Answer: ${a}`}`
  })
  const asked = lines.length > 0 ? `\n\nQuestions and answers:\n${lines.join('\n')}` : ''
  return `The rough prompt:\n\n${clip(original)}${asked}`
}

const jsonOf = (raw: string): Record<string, unknown> | undefined => {
  const body = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
  try {
    const v = JSON.parse(body) as unknown
    return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

const short = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : undefined)

/** The questions in the model's JSON (it may wrap it in a fence); undefined when the answer is not usable at all. */
export function parseQuestions(raw: string): UpgradeQuestion[] | undefined {
  const v = jsonOf(raw)
  if (v === undefined || !Array.isArray(v.questions)) return undefined
  const out: UpgradeQuestion[] = []
  for (const item of v.questions as unknown[]) {
    if (item === null || typeof item !== 'object') continue
    const q = short((item as { q?: unknown }).q, 200)
    const opts = (item as { options?: unknown }).options
    if (q === undefined || !Array.isArray(opts)) continue
    const options = [...new Set(opts.map(o => short(o, 40)).filter((o): o is string => o !== undefined))].slice(0, 4)
    if (options.length >= 2) out.push({ q, options })
    if (out.length === MAX_QUESTIONS) break
  }
  return out
}

export function parseRewrite(raw: string): UpgradeRewrite | undefined {
  const v = jsonOf(raw)
  const text = typeof v?.upgraded === 'string' ? v.upgraded.trim() : ''
  if (v === undefined || text === '') return undefined
  const added = Array.isArray(v.added) ? v.added.map(a => short(a, 90)).filter((a): a is string => a !== undefined).slice(0, 6) : []
  return { text, added }
}

/** Every question is answered or skipped. */
export const isDone = (questions: readonly UpgradeQuestion[], answers: Readonly<Record<number, string | null>>): boolean =>
  questions.every((_, i) => answers[i] !== undefined)

export const answeredCount = (questions: readonly UpgradeQuestion[], answers: Readonly<Record<number, string | null>>): number =>
  questions.filter((_, i) => typeof answers[i] === 'string').length

/** Newest first, no repeat of the same upgrade, at most MAX_HISTORY. */
export const addHistory = <T extends { id: number }>(list: readonly T[], entry: T): T[] =>
  [entry, ...list.filter(e => e.id !== entry.id)].slice(0, MAX_HISTORY)

// --- drawing helpers -------------------------------------------------------------------------------------------

/** Heavy box-drawing digits, three cells wide and three rows tall. */
const DIGITS: Record<string, readonly [string, string, string]> = {
  '0': ['┏━┓', '┃ ┃', '┗━┛'],
  '1': ['╺┓ ', ' ┃ ', '╺┻╸'],
  '2': ['╺━┓', '┏━┛', '┗━╸'],
  '3': ['╺━┓', ' ━┫', '╺━┛'],
  '4': ['╻ ╻', '┗━┫', '  ╹'],
  '5': ['┏━╸', '┗━┓', '╺━┛'],
  '6': ['┏━╸', '┣━┓', '┗━┛'],
  '7': ['╺━┓', '  ┃', '  ╹'],
  '8': ['┏━┓', '┣━┫', '┗━┛'],
  '9': ['┏━┓', '┗━┫', '╺━┛'],
}

/** A number as three rows of heavy box-drawing digits, a space between digits. */
export function bigNumber(n: number): [string, string, string] {
  const digits = String(Math.max(0, Math.round(n))).split('')
  return [0, 1, 2].map(r => digits.map(d => (DIGITS[d] ?? DIGITS['0']!)[r]).join(' ')) as [string, string, string]
}

/** A line of `ch` as wide as the pane (never below 1). */
export const rule = (cols: number, ch = '─'): string => ch.repeat(Math.max(1, cols))

/** `LABEL ────────` to the pane's width. */
export const heading = (label: string, cols: number): string => {
  const l = label.toUpperCase()
  return `${l} ${rule(cols - l.length - 1)}`
}

/** The text cut to `max` cells, with an ellipsis. */
export const fit = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`)

export const STEP_NAMES = ['Your prompt', 'Questions', 'Rewrite', 'Review'] as const
export const STEP_NAMES_NARROW = ['Prompt', 'Ask', 'Rewrite', 'Review'] as const

/** Which of the four tracker steps a step belongs to (0 to 3). */
export function trackerIndex(step: string, failedAt?: 'reading' | 'rewrite'): number {
  const at = step === 'error' ? (failedAt === 'rewrite' ? 'rewrite' : 'reading') : step
  switch (at) {
    case 'input':
    case 'reading':
    case 'history':
      return 0
    case 'questions':
      return 1
    case 'rewrite':
      return 2
    default:
      return 3
  }
}

/** The row's width in a pane that is `cols` wide; a pane too narrow for two cards stacks them. */
export const cardWidth = (cols: number): number => Math.max(10, Math.floor((cols - 1) / 2))
export const isNarrow = (cols: number): boolean => cols < 64
