// External agents: the other coding agents Claude can ask, each through its own command-line program on this machine.
// No engine access here: every function takes a `run` that starts a program by argument array (never a shell string).
//
// KEEP IN SYNC: mods/external-agent/hooks/agents.ts is a byte-for-byte copy (tests/test_agents_sync.py checks it).
//
// Safety: every agent runs read-only. Codex: `--sandbox read-only` and `sandbox_mode="read-only"`, `--ephemeral`.
// Claude Code: `--permission-mode plan` and only the Read, Grep and Glob tools. The question goes on standard input.
// No API key is stored here: when an agent is not signed in, its own login command stores the credential.

export type AgentId = 'codex' | 'claude'
export type Mode = 'ask' | 'review'
export type AgentConfig = { agent: AgentId; model: string }
export type RunResult = { exitCode: number; stdout: string; stderr: string }
export type Run = (argv: string[], init?: { stdin?: string; timeoutMs?: number }) => Promise<RunResult>
export type Found = { isInstalled: boolean; version: string }
export type Answer = { isOk: boolean; text: string }

export const DEFAULT_AGENT: AgentId = 'codex'
export const ASK_TIMEOUT_MS = 10 * 60_000
export const MAX_ANSWER_CHARS = 60_000
const PROBE_MS = 15_000
const MAX_DIFF_CHARS = 100_000
/** What the connection check asks, and the word it expects back. */
export const CHECK_PROMPT = 'Reply with exactly one word: ok'

export const AGENTS: Record<AgentId, { label: string; signIn: string; takesApiKey: boolean }> = {
  codex: { label: 'Codex (OpenAI)', signIn: 'codex login', takesApiKey: true },
  claude: { label: 'Claude Code', signIn: 'claude auth login', takesApiKey: false },
}
export const AGENT_IDS: AgentId[] = ['codex', 'claude']
/** Claude Code takes these model aliases; it has no command that lists models. */
const CLAUDE_MODELS = ['sonnet', 'opus', 'haiku']

export const isAgentId = (v: unknown): v is AgentId => v === 'codex' || v === 'claude'
export const isConfig = (v: unknown): v is AgentConfig =>
  typeof v === 'object' && v !== null && isAgentId((v as AgentConfig).agent) && typeof (v as AgentConfig).model === 'string'

async function tryRun(run: Run, argv: string[], init?: { stdin?: string; timeoutMs?: number }): Promise<RunResult | undefined> {
  try {
    return await run(argv, init)
  } catch {
    return undefined // a missing program rejects
  }
}

/** Is the agent's program on this machine, and which version. */
export async function detect(run: Run, id: AgentId): Promise<Found> {
  const r = await tryRun(run, id === 'codex' ? ['codex', '--version'] : ['claude', '--version'], { timeoutMs: PROBE_MS })
  return r && r.exitCode === 0 ? { isInstalled: true, version: r.stdout.trim().split('\n')[0] ?? '' } : { isInstalled: false, version: '' }
}

/** Signed in already (subscription or a stored key): no API key needed. */
export async function isSignedIn(run: Run, id: AgentId): Promise<boolean> {
  if (id === 'codex') {
    const r = await tryRun(run, ['codex', 'login', 'status'], { timeoutMs: PROBE_MS })
    return r !== undefined && r.exitCode === 0 && /logged in/i.test(`${r.stdout}\n${r.stderr}`)
  }
  const r = await tryRun(run, ['claude', 'auth', 'status'], { timeoutMs: PROBE_MS })
  return r !== undefined && r.exitCode === 0 && /"loggedIn"\s*:\s*true/.test(r.stdout)
}

/** Codex's model catalog (`codex debug models`): the slugs it lists, hidden ones left out. */
export function parseCodexModels(json: string): string[] {
  try {
    const d = JSON.parse(json) as { models?: unknown }
    const list = Array.isArray(d.models) ? d.models : []
    return list
      .filter((m): m is { slug?: unknown; id?: unknown; visibility?: unknown } => typeof m === 'object' && m !== null)
      .filter(m => m.visibility !== 'hide')
      .map(m => String(m.slug ?? m.id ?? ''))
      .filter(s => s !== '')
  } catch {
    return []
  }
}

export async function listModels(run: Run, id: AgentId): Promise<string[]> {
  if (id === 'claude') return [...CLAUDE_MODELS]
  const r = await tryRun(run, ['codex', 'debug', 'models'], { timeoutMs: PROBE_MS })
  return r && r.exitCode === 0 ? parseCodexModels(r.stdout) : []
}

/** Only for an agent that takes a key (Codex): its own login stores it; nothing is kept here. */
export async function signInWithKey(run: Run, id: AgentId, key: string): Promise<boolean> {
  if (!AGENTS[id].takesApiKey || key.trim() === '') return false
  const r = await tryRun(run, ['codex', 'login', '--with-api-key'], { stdin: key.trim(), timeoutMs: PROBE_MS })
  return r !== undefined && r.exitCode === 0
}

/** The read-only command line for a question; the prompt goes on stdin. */
export function askArgv(conf: AgentConfig, mode: Mode, hasInstructions: boolean): string[] {
  const m = conf.model.trim()
  if (conf.agent === 'claude') {
    return ['claude', '-p', '--model', m || 'sonnet', '--permission-mode', 'plan', '--tools', 'Read', 'Grep', 'Glob']
  }
  const model = m ? ['-m', m] : []
  if (mode === 'review') {
    return ['codex', 'exec', 'review', '-c', 'sandbox_mode="read-only"', ...model, '--uncommitted', '--ephemeral', ...(hasInstructions ? ['-'] : [])]
  }
  return ['codex', 'exec', '-s', 'read-only', '-c', 'sandbox_mode="read-only"', ...model, '--ephemeral', '--skip-git-repo-check', '--color', 'never', '-']
}

function clip(text: string): string {
  return text.length > MAX_ANSWER_CHARS ? `${text.slice(0, MAX_ANSWER_CHARS)}\n…(answer cut at ${MAX_ANSWER_CHARS} characters)` : text
}

/** Ask the configured agent. Never throws: a failure comes back as `isOk: false` with the reason. */
export async function ask(run: Run, conf: AgentConfig, mode: Mode, prompt: string): Promise<Answer> {
  const label = AGENTS[conf.agent].label
  let stdin = prompt.trim()
  if (conf.agent === 'claude' && mode === 'review') {
    // Claude Code has no review command: send it the diff (it has no shell to run git itself).
    const diff = await tryRun(run, ['git', 'diff', 'HEAD'], { timeoutMs: 20_000 })
    if (!diff || diff.exitCode !== 0) return { isOk: false, text: 'Review needs a git repository with a commit.' }
    if (diff.stdout.trim() === '') return { isOk: false, text: 'No uncommitted changes to review.' }
    stdin = `Review these uncommitted changes for bugs and risks. Be specific and brief.${stdin ? `\nAlso: ${stdin}` : ''}\n\n${diff.stdout.slice(0, MAX_DIFF_CHARS)}`
  }
  const r = await tryRun(run, askArgv(conf, mode, stdin.length > 0), { stdin, timeoutMs: ASK_TIMEOUT_MS })
  if (r === undefined) return { isOk: false, text: `${label} could not run: is it installed and signed in?` }
  if (r.exitCode !== 0) return { isOk: false, text: `${label} failed (exit ${r.exitCode}): ${clip(r.stderr.trim().slice(-4000)) || 'no message'}` }
  return { isOk: true, text: clip(r.stdout.trim() || `(${label} returned no text)`) }
}

/** The wizard's last step: a tiny question that must come back with "ok". */
export async function connectionCheck(run: Run, conf: AgentConfig): Promise<Answer> {
  const a = await ask(run, conf, 'ask', CHECK_PROMPT)
  if (!a.isOk) return a
  return /\bok\b/i.test(a.text) ? { isOk: true, text: 'Connected' } : { isOk: false, text: `Unexpected reply: ${a.text.slice(0, 200)}` }
}
