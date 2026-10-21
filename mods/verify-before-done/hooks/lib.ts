// Pure helpers for verify-before-done: what counts as code, and what counts as a test, check or build run.

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const CODE = /\.(r|rs|py|jl|cpp|c|h|ts|tsx|js|jsx|go|sh|sql)$/i

export const isEditTool = (tool: string): boolean => EDIT_TOOLS.has(tool)
export const isCodeFile = (path: string): boolean => CODE.test(path.replace(/\\/g, '/'))

/** A command that runs tests, a check or a build of the project. */
export const isTestCommand = (cmd: string): boolean =>
  /\b(devtools::(test|check)|testthat|R\s+CMD\s+check|rcmdcheck|cargo\s+(test|nextest|clippy|check|build)|pytest|py\.test|npm\s+(run\s+)?(test|build)|pnpm\s+(run\s+)?(test|build)|vitest|jest|go\s+test|make\s+(test|check)|bun\s+test|claude\s+plugin\s+(test|validate)|quarto\s+render|tsc\b)/i.test(cmd)

export const MISSED_TOAST = 'verify-before-done: code changed and no test or check ran this turn'
export const NOTE =
  'verify-before-done: your last turn changed code and ran no test, check or build. In your next reply say what was and was not verified; if you said it was done, run the tests now or retract it.'
