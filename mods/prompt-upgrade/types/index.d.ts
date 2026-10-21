/** One multiple-choice question the fast model asked. */
export type UpgradeQuestion = { q: string; options: string[] }

/** What the rewrite step returns. */
export type UpgradeRewrite = { text: string; added: string[] }

/** `reading` and `rewrite` are model calls in flight; `input` waits for typed words; `history` lists the past upgrades. */
export type UpgradeStep = 'input' | 'reading' | 'questions' | 'rewrite' | 'review' | 'error' | 'history'

/** The upgrade on screen. `answers[i]` is the chosen words, `null` for a skipped question, absent while open. */
export type UpgradeSession = {
  runId: number
  step: UpgradeStep
  /** Where a failed call stood, so Try again repeats it. */
  failedAt?: 'reading' | 'rewrite'
  original: string
  questions: UpgradeQuestion[]
  answers: Record<number, string | null>
  /** The question whose "Other" field is open. */
  otherFor: number | null
  rewrite: UpgradeRewrite | null
  isEditing: boolean
  error: string
}

export type UpgradeEntry = { id: number; at: number; original: string; text: string; added: string[] }

declare module 'claude-code' {
  interface PluginState {
    'prompt-upgrade': {
      /** The upgrade on screen; null while the pane is closed. */
      session: UpgradeSession | null
      /** The last 20 upgrades, newest first. Persisted as `$.store` 'history'. */
      history: UpgradeEntry[]
      /** True while automatic mode is on. Persisted as `$.store` 'auto'. */
      isAuto: boolean
    }
  }
}
