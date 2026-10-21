// skill-router: a prompt that clearly matches one of the toolkit's skills gets one added line telling the model which
// skill to load. Local keyword rules (no model call); each skill is hinted once per session; slash commands, short
// replies and prompts that already name the skill get nothing. /skill-router on|off|status.
// FAIL OPEN: any error sends the prompt unchanged.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { hintFor, pick } from './lib'

type Dollar = EngineInterface

const COMMAND = 'skill-router'

const isOff = atom({ plugin: 'skill-router', key: 'isOff' } as const, false)
const hinted = atom({ plugin: 'skill-router', key: 'hinted' } as const, [])

async function run($: Dollar, args: string): Promise<string> {
  const word = args.trim().toLowerCase()
  if (word === 'on' || word === 'off') {
    await $.store.set('off', word === 'off')
    await update($, isOff, () => word === 'off')
    return `skill-router · ${word}`
  }
  if (word === '' || word === 'status') {
    const list = await read($, hinted)
    return `skill-router · ${(await read($, isOff)) ? 'off' : 'on'} · hinted this session: ${list.length === 0 ? 'none' : list.join(', ')}`
  }
  return 'skill-router · use /skill-router [on|off|status]; nothing changed'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      const off = (await $.store.get('off')) === true
      await update($, isOff, () => off)
      await update($, hinted, () => [])
    } catch {
      // reads as on
    }
    try {
      await $.command.register({ name: COMMAND, description: 'Hints the matching skill on a prompt that clearly asks for it: /skill-router [on|off|status]', argumentHint: '[on|off|status]', immediate: true })
    } catch {
      // fail-open: the mod still works without its command
    }
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => ({ text: await run($, e.args) })).catch(() => ({ text: 'skill-router · that did not work, nothing changed' }))

  on('prompt.submit', async ($, e, next) => {
    if ((await read($, isOff)) || e.origin?.kind !== 'user') return next(e)
    const skill = pick(e.text, await read($, hinted))
    if (skill === undefined) return next(e)
    await update($, hinted, list => [...list, skill])
    return next({ ...e, context: [...(e.context ?? []), hintFor(skill)] })
  }).catch(($, e, next) => next(e))
}
