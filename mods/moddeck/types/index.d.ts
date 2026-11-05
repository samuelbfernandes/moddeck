/** One saved prompt, as prompt-library keeps it. */
export type SavedPrompt = { name: string; text: string }
/** An External Agent moddeck knows (hooks/agents.ts declares the same shapes; a contract cannot import). */
export type AgentId = 'codex' | 'gemini' | 'ollama' | 'lmstudio' | 'claude'
export type AgentConfig = { agent: AgentId; model: string; connection?: 'local' | 'api'; access?: 'edit' | 'read'; baseUrl?: string }
export type Found = { isInstalled: boolean; version: string }
/** The External Agent setup wizard: agent → connection → sign-in → model → connection check. */
export type AgentWizard = {
  step: 'agent' | 'connect' | 'signin' | 'model' | 'check'
  agent: AgentId
  /** 'local' (the default): the agent's own program here; 'api': opt-in, answers only. */
  connection: 'local' | 'api'
  /** 'edit' (the default): it may edit files and run commands in the project; 'read': read only. */
  access: 'edit' | 'read'
  /** The API address typed for the API connection ('' = the agent's usual one). */
  baseUrl: string
  /** What detection found per agent; absent = still checking. */
  found: Partial<Record<AgentId, Found>>
  /** Signed in on this machine (no API key needed); null = not checked yet. */
  signedIn: boolean | null
  models: string[]
  /** The model picked; '' = the agent's own default. */
  model: string
  /** What is running now ('' = nothing). */
  busy: string
  /** The last result or problem to show. */
  note: string
  /** The connection check passed. */
  isOk: boolean
}
/** One side question in the Side Question panel. */
export type BtwEntry = { id: number; at: number; question: string; status: 'thinking' | 'done' | 'failed'; answer: string; isCut: boolean; tokens: number | null; note: string }
/** The automatic open of the side bar, once per session. */
export type AutoOpen = 'new' | 'checking' | 'done'
/** How the Session box lays its rows out. */
export type DeckLayout = 'expanded' | 'compact'
/** The latest `session.measure` figures (or `session.usage()` at start); a figure the engine did not give is absent. */
export type DeckMeasure = {
  context: { tokens?: number; window?: number; percent?: number }
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
  cost?: number
}
/** What the Session box's model row shows, plus the window's biggest categories while it is nearly full. */
export type DeckMeta = { model?: string; effort?: string | number; provider?: string; startedAt?: number; breakdown?: { name: string; tokens: number }[] }
/** The working directory's git state (porcelain v2): counts are files, each counted once. */
export type DeckGit = {
  branch: string
  isDetached: boolean
  ahead: number
  behind: number
  hasUpstream: boolean
  modified: number
  added: number
  deleted: number
  untracked: number
  conflicts: number
  worktree?: string
}
/** Session token totals (main loop) and the last turn's output speed. */
export type DeckTokens = { input: number; output: number; cacheRead: number; cacheWrite: number; tokensPerSecond?: number }
/** The last tool calls (bounded), the skills and MCP servers used, and the compactions seen. */
export type DeckActivity = {
  runs: { id: string; name: string; target?: string; state: 'running' | 'done' | 'error' }[]
  skills: string[]
  mcp: Record<string, number>
  compactions: number
}
/** What the environment row counts; a field the engine did not give is absent. */
export type DeckEnv = { claudeMd?: number; rules?: number; mcp?: number; hooks?: number; plugins?: number }

declare module 'claude-code' {
  interface PluginState {
    moddeck: {
      /** The one automatic open: 'new' until tried, 'checking' until the first drawing says whether it docked, then 'done'. */
      autoOpen: AutoOpen
      /** Index of the first row shown in each scrolling list (`skills`, `prompts`): moved by the scroll bar and the wheel. */
      tops: Record<string, number>
      /** What the person last picked in the dropdown (`command-guard`), and the level its switch goes back to (`command-guard:last`). */
      picks: Record<string, string>
      /** The Session box's latest figures; null before any. */
      measure: DeckMeasure | null
      /** Model, effort, provider, start time and (nearly full) breakdown for the model and context rows. */
      meta: DeckMeta
      /** Git state, refreshed at start and after each turn; null = not a repository. */
      git: DeckGit | null
      /** Session token totals; null until a turn reported usage. */
      tokens: DeckTokens | null
      /** Recent tool calls, skills, MCP servers and compactions (in memory only). */
      activity: DeckActivity
      /** Counts for the environment row; null until read. */
      env: DeckEnv | null
      /** Rows shown, a comma list in display order, as `/moddeck rows` set it (also kept in the store as `rows`); null = the settings apply. */
      rows: string | null
      /** The last few side questions and answers of the Side Question panel, newest first (in memory only). */
      btw: BtwEntry[]
      /** A newer release than the installed one, not yet updated to; null = none known. */
      updateAvail: string | null
      /** The newest commit or checkpoint (ms); null = none; undefined = not read. */
      backupAt: number | null | undefined
      /** The permission mode from the settings. */
      permMode: string | undefined
      /** The Side Question panel is expanded. */
      btwOpen: boolean
      /** Cards folded down to their title (`group:<name>`); also kept in the store. null = not loaded. */
      folded: string[] | null
      /** Rows opened by their ▸ button to show the full description (`tool:<id>`, `skill:<id>`, `prompt:<id>`); also kept in the store. null = not loaded. */
      opened: string[] | null
      /** The session's folder, as last read for the git and backup rows. */
      cwd: string
      /** What each list's search field holds (`skills`, `prompts`). */
      listQuery: Record<string, string>
      /** The text in the Side Question's Ask here field, emptied after asking and by ✕ close. */
      btwDraft: string
      /** The External Agent the setup wizard saved (also in the store as `agent`); null = not set up yet. The external-agent mod reads it. */
      agent: AgentConfig | null
      /** The setup wizard while it is open; null = closed. */
      agentWiz: AgentWizard | null
      /** The wizard's API key field: in memory only, emptied as soon as it is handed to the agent's own login. */
      agentKey: string
      /** The External Agent box's answers are shown. */
      agentOpen: boolean
      /** The External Agent box's last questions and answers, newest first (in memory only); `note` holds the agent's name. */
      agentChat: BtwEntry[]
      /** The text in the External Agent box's field. */
      agentDraft: string
      /** Ids of answers shown in full (the others are clamped to 12 lines). */
      agentFull: number[]
      /** Lines each list shows (`skills`, `prompts`), as its more/fewer buttons set it (also kept in the store); null = not loaded. */
      listRows: Record<string, number> | null
      /** Starred skill ids, drawn at the top of the Skills box (also kept in the store); null = not loaded. */
      starred: string[] | null
      /** Every skill the session has (name, and the matching slash command's line), read once from the engine; null = not read yet. */
      installedSkills: { name: string; desc?: string }[] | null
      /** The pane is shown wide (the expand button); false = its usual width. */
      wide: boolean
      /** The Session box layout as `/moddeck rows compact|expanded` set it (also kept in the store as `layout`); null = the settings apply. */
      layout: DeckLayout | null
      /** The desktop app's side bar colours as `/moddeck theme light|dark` set them (also kept in the store as `theme`); null = the `appTheme` setting. */
      theme: 'light' | 'dark' | null
    }
  }
}
