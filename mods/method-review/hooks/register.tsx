// method-review: when Claude edits method code (a code file whose path holds a word such as blup, herit, selection,
// variance), the file is remembered as unreviewed. The first `git commit` or `git push` while any is unreviewed is held
// once with a short reason; running the command again goes ahead. A review clears the list: the `review` skill, a Codex
// review (`codex exec` / `codex review`), or `dev/dual.sh`, or `/method-review reviewed`.
// It looks only at tool calls and never edits anything. FAIL OPEN: any error lets the call through unchanged.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { DEFAULT_WORDS, isEditTool, isMethodPath, isReviewCommand, isReviewSkill, isSaveCommand, shortList } from './lib'

type Dollar = EngineInterface

const COMMAND = 'method-review'
const MAX_PENDING = 50

const isOff = atom({ plugin: 'method-review', key: 'isOff' } as const, false)
const pending = atom({ plugin: 'method-review', key: 'pending' } as const, [])

/** The set of files a hold was already shown for: a second try goes ahead. */
let held = ''

async function words($: Dollar): Promise<string[]> {
  try {
    const stored = await $.store.get('words')
    return Array.isArray(stored) ? stored.filter((w): w is string => typeof w === 'string') : [...DEFAULT_WORDS]
  } catch {
    return [...DEFAULT_WORDS]
  }
}

async function relative($: Dollar, file: string): Promise<string> {
  try {
    const cwd = (await $.session.cwd()).replace(/\\/g, '/').replace(/\/$/, '')
    const f = file.replace(/\\/g, '/')
    return f.startsWith(`${cwd}/`) ? f.slice(cwd.length + 1) : f
  } catch {
    return file
  }
}

async function run($: Dollar, args: string): Promise<string> {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const word = rest.join(' ').trim().toLowerCase()
  const list = await words($)
  if (verb === '' || verb === 'status') {
    const files = await read($, pending)
    return `method-review · ${(await read($, isOff)) ? 'off' : 'on'} · ${files.length === 0 ? 'nothing waiting for review' : `${files.length} unreviewed: ${shortList(files, 5)}`}\nWatching paths with: ${list.join(', ')}`
  }
  if (verb === 'on' || verb === 'off') {
    await $.store.set('off', verb === 'off')
    await update($, isOff, () => verb === 'off')
    return `method-review · ${verb}`
  }
  if (verb === 'reviewed') {
    await update($, pending, () => [])
    held = ''
    return 'method-review · marked reviewed'
  }
  if ((verb === 'add' || verb === 'remove') && word !== '') {
    const next = verb === 'add' ? [...new Set([...list, word])] : list.filter(w => w !== word)
    await $.store.set('words', next)
    return `method-review · ${verb === 'add' ? 'now watching' : 'no longer watching'} paths with "${word}"`
  }
  return 'method-review · use /method-review [status|on|off|reviewed|add <word>|remove <word>]; nothing changed'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    held = ''
    try {
      const off = (await $.store.get('off')) === true
      await update($, isOff, () => off)
    } catch {
      // reads as on
    }
    try {
      await $.command.register({ name: COMMAND, description: 'Method code edited without a second-model review is held once at commit or push', argumentHint: '[status|on|off|reviewed|add <word>|remove <word>]', immediate: true })
    } catch {
      // fail-open: the mod still works without its command
    }
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => ({ text: await run($, e.args) })).catch(() => ({ text: 'method-review · that did not work, nothing changed' }))

  on('tool.call', async ($, e, next) => {
      if (await read($, isOff)) return next(e)
      const input = e as unknown as Record<string, unknown>
      const tool = String(e.tool)
      const command = typeof input.command === 'string' ? input.command : ''

      if (tool === 'Bash' && isSaveCommand(command)) {
        const files = await read($, pending)
        const key = files.join('|')
        if (files.length > 0 && held !== key) {
          held = key
          $.ui.toast(`method-review: ${files.length} method file${files.length === 1 ? '' : 's'} not reviewed by a second model`, { timeoutMs: 8000 })
          return { deny: `method-review: held once. ${shortList(files)} ${files.length === 1 ? 'is' : 'are'} method code with no second-model review. Run the review skill (a different model must review it), or run this command again to go ahead.` }
        }
      }

      const ran = await next(e)
      if (ran.deny !== undefined || ran.isError === true) return ran

      if ((tool === 'Bash' && isReviewCommand(command)) || (tool === 'Skill' && typeof input.skill === 'string' && isReviewSkill(input.skill))) {
        await update($, pending, () => [])
        held = ''
        return ran
      }
      const target = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : ''
      if (isEditTool(tool) && target !== '' && isMethodPath(target, await words($))) {
        const shown = await relative($, target)
        const before = await read($, pending)
        if (!before.includes(shown)) {
          await update($, pending, list => [...list, shown].slice(-MAX_PENDING))
          if (before.length === 0) {
            return { ...ran, context: [...(ran.context ?? []), `method-review: ${shown} looks like method code. A different model must review it before it is committed or pushed: use the review skill.`] } as typeof ran
          }
        }
      }
      return ran
  }).catch(($, e, next) => next(e))
}
