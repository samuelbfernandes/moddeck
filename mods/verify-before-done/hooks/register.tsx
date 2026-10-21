// verify-before-done: it watches each turn for code edits (Edit, Write, MultiEdit, NotebookEdit on a code file) and for
// test, check or build commands (Bash). When a turn ends having changed code without running any, the person gets a
// toast at once, and the model gets one reminder line with the person's next prompt, asking it to say what was and was
// not verified. It never blocks and never runs anything. FAIL OPEN: any error leaves the turn and the prompt unchanged.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { MISSED_TOAST, NOTE, isCodeFile, isEditTool, isTestCommand } from './lib'

type Dollar = EngineInterface

const COMMAND = 'verify-before-done'

const isOff = atom({ plugin: 'verify-before-done', key: 'isOff' } as const, false)
const unverified = atom({ plugin: 'verify-before-done', key: 'unverified' } as const, 0)

// This turn's facts and the reminder waiting for the next prompt (the module's own variables: they restart on a reload).
let edited = false
let tested = false
let owed = false

async function run($: Dollar, args: string): Promise<string> {
  const word = args.trim().toLowerCase()
  if (word === 'on' || word === 'off') {
    await $.store.set('off', word === 'off')
    await update($, isOff, () => word === 'off')
    return `verify-before-done · ${word}`
  }
  if (word === '' || word === 'status') {
    const n = await read($, unverified)
    return `verify-before-done · ${(await read($, isOff)) ? 'off' : 'on'} · ${n} turn${n === 1 ? '' : 's'} changed code with no test run this session`
  }
  return 'verify-before-done · use /verify-before-done [on|off|status]; nothing changed'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    edited = tested = owed = false
    try {
      const off = (await $.store.get('off')) === true
      await update($, isOff, () => off)
    } catch {
      // reads as on
    }
    try {
      await $.command.register({ name: COMMAND, description: 'Flags a turn that changed code and ran no test: /verify-before-done [on|off|status]', argumentHint: '[on|off|status]', immediate: true })
    } catch {
      // fail-open: the mod still works without its command
    }
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => ({ text: await run($, e.args) })).catch(() => ({ text: 'verify-before-done · that did not work, nothing changed' }))

  on('turn.start', async (_$, e, next) => {
    if (e.agentId === undefined) edited = tested = false
    return next(e)
  }).catch((_$, e, next) => next(e))

  // Watches only: the call runs first and its result goes back unchanged.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true || (await read($, isOff))) return ran
    const input = e as unknown as Record<string, unknown>
    const tool = String(e.tool)
    if (tool === 'Bash' && typeof input.command === 'string' && isTestCommand(input.command)) tested = true
    const target = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : ''
    if (isEditTool(tool) && isCodeFile(target)) edited = true
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const out = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer' || (await read($, isOff))) return out
    if (edited && !tested) {
      owed = true
      await update($, unverified, n => n + 1)
      $.ui.toast(MISSED_TOAST, { timeoutMs: 8000 })
    }
    edited = tested = false
    return out
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    if (!owed || (await read($, isOff))) return next(e)
    owed = false
    return next({ ...e, context: [...(e.context ?? []), NOTE] })
  }).catch(($, e, next) => next(e))
}
