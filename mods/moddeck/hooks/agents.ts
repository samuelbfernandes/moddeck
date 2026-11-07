// External agents: other coding agents Claude can delegate to, each through its own program on this machine (the default),
// or, only when the person opts in, through an OpenAI-compatible API. No engine access here: every function takes a `run`
// that starts a program by argument array (never a shell string), and API calls take a `post`.
//
// KEEP IN SYNC: mods/external-agent/hooks/agents.ts is a byte-for-byte copy (tests/test_agents_sync.py checks it).
//
// Access: 'edit' (the default) lets the agent change files and run commands inside the project, each agent under its own
// guard: Codex's workspace-write sandbox (no network), Gemini's sandbox, Claude Code's acceptEdits mode. 'read' keeps it
// read-only. No `--dangerously-*` / bypass flag is ever passed. The prompt goes on standard input. No API key is stored
// here: a CLI agent signs in with its own login; the API connection reads its key from the external-agent mod's secure
// option.

export type AgentId = 'codex' | 'gemini' | 'ollama' | 'lmstudio' | 'claude'
export type Connection = 'local' | 'api'
export type Access = 'edit' | 'read'
export type Mode = 'ask' | 'review'
export type AgentConfig = { agent: AgentId; model: string; connection?: Connection; access?: Access; baseUrl?: string }
export type RunResult = { exitCode: number; stdout: string; stderr: string }
export type Run = (argv: string[], init?: { stdin?: string; timeoutMs?: number }) => Promise<RunResult>
export type Post = (url: string, body: string, headers: Record<string, string>) => Promise<{ status: number; text: string }>
export type Found = { isInstalled: boolean; version: string }
export type Answer = { isOk: boolean; text: string }

export const DEFAULT_AGENT: AgentId = 'codex'
export const ASK_TIMEOUT_MS = 10 * 60_000
export const MAX_ANSWER_CHARS = 60_000
const PROBE_MS = 15_000
const MAX_DIFF_CHARS = 100_000
/** What the connection check asks, and the word it expects back. */
export const CHECK_PROMPT = 'Reply with exactly one word: ok'

type Info = {
  label: string
  /** The program that must be on this machine for the local connection. */
  program: string
  /** How to sign in for the local connection ('' = nothing to sign in to). */
  signIn: string
  takesApiKey: boolean
  /** The OpenAI-compatible base URL the opt-in API connection starts from. */
  apiBase: string
  /** The flags were checked on a real install (false: written from the agent's docs, not run here). */
  isVerified: boolean
}
export const AGENTS: Record<AgentId, Info> = {
  codex: { label: 'Codex (OpenAI)', program: 'codex', signIn: 'codex login', takesApiKey: true, apiBase: 'https://api.openai.com/v1', isVerified: true },
  gemini: { label: 'Gemini CLI', program: 'gemini', signIn: 'gemini (first run signs in)', takesApiKey: false, apiBase: 'https://generativelanguage.googleapis.com/v1beta/openai', isVerified: false },
  ollama: { label: 'Ollama (local model)', program: 'ollama', signIn: '', takesApiKey: false, apiBase: 'http://127.0.0.1:11434/v1', isVerified: false },
  lmstudio: { label: 'LM Studio (local model)', program: 'lms', signIn: '', takesApiKey: false, apiBase: 'http://127.0.0.1:1234/v1', isVerified: true },
  claude: { label: 'Claude Code', program: 'claude', signIn: 'claude auth login', takesApiKey: false, apiBase: 'https://api.anthropic.com/v1', isVerified: true },
}
export const AGENT_IDS: AgentId[] = ['codex', 'gemini', 'ollama', 'lmstudio', 'claude']
/** Local models run inside Codex's agent (`codex exec --oss`), so they can edit files and run commands too. */
export const isLocalModel = (id: AgentId): boolean => id === 'ollama' || id === 'lmstudio'
/** Claude Code takes these model aliases; it has no command that lists models. */
const CLAUDE_MODELS = ['sonnet', 'opus', 'haiku']

export const isAgentId = (v: unknown): v is AgentId => typeof v === 'string' && (AGENT_IDS as string[]).includes(v)
export const isConfig = (v: unknown): v is AgentConfig =>
  typeof v === 'object' && v !== null && isAgentId((v as AgentConfig).agent) && typeof (v as AgentConfig).model === 'string'
export const connectionOf = (c: AgentConfig): Connection => (c.connection === 'api' ? 'api' : 'local')
export const accessOf = (c: AgentConfig): Access => (c.access === 'read' ? 'read' : 'edit')

async function tryRun(run: Run, argv: string[], init?: { stdin?: string; timeoutMs?: number }): Promise<RunResult | undefined> {
  try {
    return await run(argv, init)
  } catch {
    return undefined // a missing program rejects
  }
}

/** Is the agent's program on this machine, and which version. Local models also need Codex, which runs them. */
export async function detect(run: Run, id: AgentId): Promise<Found> {
  const r = await tryRun(run, [AGENTS[id].program, '--version'], { timeoutMs: PROBE_MS })
  if (!r || r.exitCode !== 0) return { isInstalled: false, version: '' }
  const version = (r.stdout.trim().split('\n').filter(l => l.trim() !== '').pop() ?? '').trim() // lms prints a banner first
  if (isLocalModel(id) && !(await detect(run, 'codex')).isInstalled) return { isInstalled: false, version: `${version} (needs Codex to run it)` }
  return { isInstalled: true, version }
}

/** Signed in already (subscription or a stored key): no API key needed. Local models need no sign-in. */
export async function isSignedIn(run: Run, id: AgentId): Promise<boolean> {
  if (id === 'codex') {
    const r = await tryRun(run, ['codex', 'login', 'status'], { timeoutMs: PROBE_MS })
    return r !== undefined && r.exitCode === 0 && /logged in/i.test(`${r.stdout}\n${r.stderr}`)
  }
  if (id === 'claude') {
    const r = await tryRun(run, ['claude', 'auth', 'status'], { timeoutMs: PROBE_MS })
    return r !== undefined && r.exitCode === 0 && /"loggedIn"\s*:\s*true/.test(r.stdout)
  }
  return true // gemini signs in on its own first run (the connection check shows it); local models need none
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

/** `lms ls --json`: the chat models (embedding models left out). */
export function parseLmsModels(json: string): string[] {
  try {
    const d = JSON.parse(json) as unknown
    return (Array.isArray(d) ? d : [])
      .filter((m): m is { modelKey?: unknown; type?: unknown } => typeof m === 'object' && m !== null)
      .filter(m => m.type !== 'embedding')
      .map(m => String(m.modelKey ?? ''))
      .filter(s => s !== '')
  } catch {
    return []
  }
}

/** `ollama list`: the first column after the header. */
export const parseOllamaModels = (text: string): string[] =>
  text
    .split('\n')
    .slice(1)
    .map(l => l.trim().split(/\s+/)[0] ?? '')
    .filter(s => s !== '')

export async function listModels(run: Run, id: AgentId): Promise<string[]> {
  if (id === 'claude') return [...CLAUDE_MODELS]
  if (id === 'gemini') return [] // no list command checked here: the agent's default, or a typed name
  const argv = id === 'codex' ? ['codex', 'debug', 'models'] : id === 'lmstudio' ? ['lms', 'ls', '--json'] : ['ollama', 'list']
  const r = await tryRun(run, argv, { timeoutMs: PROBE_MS })
  if (!r || r.exitCode !== 0) return []
  return id === 'codex' ? parseCodexModels(r.stdout) : id === 'lmstudio' ? parseLmsModels(r.stdout) : parseOllamaModels(r.stdout)
}

/** Only for an agent that takes a key on its own login (Codex): its login stores it; nothing is kept here. */
export async function signInWithKey(run: Run, id: AgentId, key: string): Promise<boolean> {
  if (!AGENTS[id].takesApiKey || key.trim() === '') return false
  const r = await tryRun(run, ['codex', 'login', '--with-api-key'], { stdin: key.trim(), timeoutMs: PROBE_MS })
  return r !== undefined && r.exitCode === 0
}

/** The command line for a local run; the prompt goes on stdin. */
export function askArgv(conf: AgentConfig, mode: Mode, hasInstructions: boolean): string[] {
  const m = conf.model.trim()
  const edit = accessOf(conf) === 'edit'
  if (conf.agent === 'claude') {
    return edit
      ? ['claude', '-p', '--model', m || 'sonnet', '--permission-mode', 'acceptEdits']
      : ['claude', '-p', '--model', m || 'sonnet', '--permission-mode', 'plan', '--tools', 'Read', 'Grep', 'Glob']
  }
  if (conf.agent === 'gemini') {
    // UNVERIFIED: Gemini CLI was not installed here; flags from its documentation.
    return ['gemini', ...(m ? ['-m', m] : []), '--approval-mode', edit ? 'yolo' : 'default', ...(edit ? ['--sandbox'] : [])]
  }
  const sandbox = edit ? 'workspace-write' : 'read-only'
  const model = m ? ['-m', m] : []
  const oss = isLocalModel(conf.agent) ? ['--oss', '--local-provider', conf.agent] : []
  if (mode === 'review' && conf.agent === 'codex') {
    return ['codex', 'exec', 'review', '-c', `sandbox_mode="${sandbox}"`, ...model, '--uncommitted', '--ephemeral', ...(hasInstructions ? ['-'] : [])]
  }
  return ['codex', 'exec', '-s', sandbox, '-c', `sandbox_mode="${sandbox}"`, ...oss, ...model, '--ephemeral', '--skip-git-repo-check', '--color', 'never', '-']
}

function clip(text: string): string {
  return text.length > MAX_ANSWER_CHARS ? `${text.slice(0, MAX_ANSWER_CHARS)}\n…(answer cut at ${MAX_ANSWER_CHARS} characters)` : text
}

/** The shared conversation, newest last, as plain lines the agent reads before the request. */
export function withContext(context: string, request: string): string {
  if (context.trim() === '') return request
  return `You are working with Claude in the same project and conversation. The conversation so far (newest last):\n\n${context}\n\n---\n\nYour task now:\n${request}`
}

/** The newest user and assistant text, oldest first, as "User:"/"Claude:" lines, up to `max` characters. */
export function digest(messages: readonly { role: string; text: string }[], max = 30_000): string {
  const out: string[] = []
  let used = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    const body = m.text.trim()
    if (body === '') continue
    const line = `${m.role === 'user' ? 'User' : 'Claude'}: ${body.length > 4000 ? `${body.slice(0, 4000)}…` : body}`
    if (used + line.length > max) break
    out.push(line)
    used += line.length + 2
  }
  return out.reverse().join('\n\n')
}

/** The opt-in API connection: one OpenAI-compatible chat completion. It answers; it cannot edit files or run commands. */
export async function askApi(post: Post, conf: AgentConfig, key: string, prompt: string): Promise<Answer> {
  const label = AGENTS[conf.agent].label
  const base = (conf.baseUrl || AGENTS[conf.agent].apiBase).replace(/\/+$/, '')
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }
  const body = JSON.stringify({ model: conf.model || undefined, messages: [{ role: 'user', content: prompt }] })
  try {
    const r = await post(`${base}/chat/completions`, body, headers)
    if (r.status < 200 || r.status >= 300) return { isOk: false, text: `${label} API answered ${r.status}${r.status === 401 ? ' (check the API key)' : ''}` }
    const d = JSON.parse(r.text) as { choices?: { message?: { content?: unknown } }[] }
    const text = d.choices?.[0]?.message?.content
    return typeof text === 'string' && text.trim() !== '' ? { isOk: true, text: clip(text.trim()) } : { isOk: false, text: `${label} API sent no text` }
  } catch {
    return { isOk: false, text: `${label} API could not be reached at ${base}` }
  }
}

/** Ask the configured agent. Never throws: a failure comes back as `isOk: false` with the reason. */
export async function ask(run: Run, conf: AgentConfig, mode: Mode, prompt: string, extra: { context?: string; post?: Post; key?: string } = {}): Promise<Answer> {
  const label = AGENTS[conf.agent].label
  let request = prompt.trim()
  const nativeReview = mode === 'review' && conf.agent === 'codex' && connectionOf(conf) === 'local'
  if (mode === 'review' && !nativeReview) {
    // No review command (or an API): send the diff along.
    const diff = await tryRun(run, ['git', 'diff', 'HEAD'], { timeoutMs: 20_000 })
    if (!diff || diff.exitCode !== 0) return { isOk: false, text: 'Review needs a git repository with a commit.' }
    if (diff.stdout.trim() === '') return { isOk: false, text: 'No uncommitted changes to review.' }
    request = `Review these uncommitted changes for bugs and risks. Be specific and brief.${request ? `\nAlso: ${request}` : ''}\n\n${diff.stdout.slice(0, MAX_DIFF_CHARS)}`
  }
  const stdin = nativeReview ? request : withContext(extra.context ?? '', request)
  if (connectionOf(conf) === 'api') {
    if (!extra.post) return { isOk: false, text: 'The API connection is not available here.' }
    return askApi(extra.post, conf, extra.key ?? '', stdin)
  }
  const r = await tryRun(run, askArgv(conf, mode, stdin.length > 0), { stdin, timeoutMs: ASK_TIMEOUT_MS })
  if (r === undefined) return { isOk: false, text: `${label} could not run: is it installed and signed in?` }
  if (r.exitCode !== 0) return { isOk: false, text: `${label} failed (exit ${r.exitCode}): ${clip(r.stderr.trim().slice(-4000)) || 'no message'}` }
  return { isOk: true, text: clip(r.stdout.trim() || `(${label} returned no text)`) }
}

/** The wizard's last step: a tiny question that must come back with "ok". */
export async function connectionCheck(run: Run, conf: AgentConfig, extra: { post?: Post; key?: string } = {}): Promise<Answer> {
  const a = await ask(run, { ...conf, access: 'read' }, 'ask', CHECK_PROMPT, extra)
  if (!a.isOk) return a
  return /\bok\b/i.test(a.text) ? { isOk: true, text: 'Connected' } : { isOk: false, text: `Unexpected reply: ${a.text.slice(0, 200)}` }
}
