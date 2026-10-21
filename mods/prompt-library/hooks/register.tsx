import { atom, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PromptItem } from '../types'
import { HELP, MAX_TEXT, STARTERS, checkName, clean, listText, maxOf, storeKey } from './lib'

type Dollar = EngineInterface

const COMMAND = 'prompts'
const FAILED = 'Prompts · that did not work, nothing changed'

/** The list the moddeck side bar reads with $.state.get. */
const items = atom({ plugin: 'prompt-library', key: 'items' } as const, [])

/** One list for every project. */
const KEY = 'items'

/** The folder's own list from before the list was shared (kept in the store, never written again). */
async function legacyOf($: Dollar): Promise<PromptItem[] | undefined> {
  try {
    const cwd = await $.session.cwd()
    const raw = typeof cwd === 'string' && cwd !== '' ? await $.store.get(storeKey(cwd)) : undefined
    return Array.isArray(raw) ? clean(raw) : undefined
  } catch {
    return undefined
  }
}

/** The saved list. The first time the shared list is read it starts from this folder's old list, else the starters. */
async function load($: Dollar): Promise<{ key: string; list: PromptItem[] }> {
  const raw = await $.store.get(KEY)
  if (raw === undefined) {
    const list = (await legacyOf($)) ?? STARTERS.map(s => ({ ...s }))
    await $.store.set(KEY, list)
    return { key: KEY, list }
  }
  return { key: KEY, list: clean(raw) }
}

async function save($: Dollar, key: string, list: PromptItem[]): Promise<void> {
  await $.store.set(key, list)
  await update($, items, () => list)
}

async function mirror($: Dollar): Promise<void> {
  try {
    const { list } = await load($)
    await update($, items, () => list)
  } catch {
    // the side bar then shows nothing
  }
}

async function run($: Dollar, maxItems: number, args: string): Promise<string> {
  const text = (args ?? '').trim()
  const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(text)
  const sub = (m?.[1] ?? 'list').toLowerCase()
  const rest = (m?.[2] ?? '').trim()
  const { key, list } = await load($)
  await update($, items, () => list)

  if (sub === 'list') return listText(list)

  if (sub === 'add') {
    const at = rest.indexOf(' | ')
    if (at < 0) return 'Prompts · use /prompts add <name> | <prompt text>'
    const c = checkName(rest.slice(0, at))
    if ('error' in c) return c.error
    const body = rest.slice(at + 3).trim()
    if (body === '') return 'Prompts · the prompt text is empty'
    if (body.length > MAX_TEXT) return `Prompts · text is too long (most ${MAX_TEXT} characters)`
    if (list.some(i => i.name === c.name)) return `Prompts · "${c.name}" already exists · pick another name or /prompts remove ${c.name}`
    if (list.length >= maxItems) return `Prompts · full (${maxItems}) · remove one first`
    await save($, key, [...list, { name: c.name, text: body }])
    return `Prompts · saved "${c.name}"`
  }

  if (sub === 'remove') {
    const n = rest.toLowerCase()
    if (n === '') return 'Prompts · use /prompts remove <name>'
    if (!list.some(i => i.name === n)) return `Prompts · no prompt named "${n}"`
    await save($, key, list.filter(i => i.name !== n))
    return `Prompts · removed "${n}"`
  }

  if (sub === 'use') {
    const n = rest.toLowerCase()
    if (n === '') return 'Prompts · use /prompts use <name>'
    const it = list.find(i => i.name === n)
    if (!it) return `Prompts · no prompt named "${n}"`
    let filled = false
    try {
      const out = (await $.prompt.fill({ text: it.text })) as { isFilled?: boolean } | undefined
      filled = out?.isFilled === true
    } catch {
      filled = false
    }
    return filled ? `Prompts · "${n}" is in the prompt box · press Enter to send` : 'Prompts · could not fill the box, type it yourself'
  }

  if (sub === 'rename') {
    const parts = rest.split(/\s+/).filter(Boolean)
    if (parts.length !== 2) return 'Prompts · use /prompts rename <old> <new>'
    const old = parts[0].toLowerCase()
    const c = checkName(parts[1])
    if ('error' in c) return c.error
    if (!list.some(i => i.name === old)) return `Prompts · no prompt named "${old}"`
    if (c.name !== old && list.some(i => i.name === c.name)) return `Prompts · "${c.name}" already exists`
    await save($, key, list.map(i => (i.name === old ? { ...i, name: c.name } : i)))
    return `Prompts · renamed "${old}" to "${c.name}"`
  }

  return HELP
}

export const register: Register = (on, options) => {
  const isEnabled = options.enabled !== false
  const maxItems = maxOf(options.maxItems)

  on('session.start', async ($, e, next) => {
    if (isEnabled) {
      await mirror($)
      try {
        await $.command.register({
          name: COMMAND,
          description: 'Your saved prompts: /prompts [list | add <name> | <text> | use <name> | rename <old> <new> | remove <name>]',
          argumentHint: 'list | add | use | rename | remove',
          immediate: true,
        })
      } catch {
        // fail-open: without the command the mod is simply quiet
      }
    }
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    if (!isEnabled) return { text: 'Prompts · disabled · the enabled setting is false (change it in /config)' }
    try {
      return { text: await run($, maxItems, e.args) }
    } catch {
      return { text: FAILED }
    }
  }).catch(() => ({ text: FAILED }))
}
