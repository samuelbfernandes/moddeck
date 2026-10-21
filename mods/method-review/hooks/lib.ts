// Pure helpers for method-review: which paths count as method code, and which commands mean "reviewed" or "about to save".

/** Words in a path that mark method code (the person adds or removes words with /method-review add|remove). */
export const DEFAULT_WORDS = ['blup', 'herit', 'selection', 'meiosis', 'variance', 'kinship', 'relationship', 'likelihood', 'estimat', 'simulat', 'gwas', 'effects']

const CODE = /\.(r|rs|py|jl|cpp|c|h|rmd|qmd)$/i
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

export const isEditTool = (tool: string): boolean => EDIT_TOOLS.has(tool)

/** A code file whose path holds one of the words (case ignored). Tests and docs are not method code. */
export function isMethodPath(path: string, words: readonly string[]): boolean {
  const p = path.replace(/\\/g, '/').toLowerCase()
  if (!CODE.test(p) || /(^|\/)(tests?|testthat|docs?)\//.test(p)) return false
  return words.some(w => w !== '' && p.includes(w.toLowerCase()))
}

/** A command that reviews with another model: Codex, or the repository's dev/dual.sh. */
export const isReviewCommand = (cmd: string): boolean => /\bcodex\s+(exec|review)\b|dev\/dual\.sh/.test(cmd)

/** A command that saves or shares the work. */
export const isSaveCommand = (cmd: string): boolean => /\bgit\b[^|;&\n]*?\b(commit|push)\b/.test(cmd)

/** The review skill, named plainly or with its plugin prefix. */
export const isReviewSkill = (name: string): boolean => name === 'review' || name.endsWith(':review')

export const shortList = (files: readonly string[], n = 3): string => `${files.slice(0, n).join(', ')}${files.length > n ? ` and ${files.length - n} more` : ''}`
