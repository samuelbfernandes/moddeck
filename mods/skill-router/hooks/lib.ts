// Pure helpers for skill-router: which skill a prompt clearly asks for. Local keyword rules, first match wins.

export type Rule = { skill: string; test: (text: string, words: number) => boolean }

export const RULES: Rule[] = [
  { skill: 'ahpcc', test: t => /\b(ahpcc|pinnacle|slurm|sbatch|squeue|on the (hpc|cluster)|hpc cluster)\b/i.test(t) },
  { skill: 'assess-plugin', test: t => /\b(assess|vet|audit|is it safe|worth installing|safe to install|should i install)\b[^.?!]*\b(plugin|mod|mcp|skill)s?\b/i.test(t) },
  { skill: 'agents-md-scaffold', test: t => /\bagents\.md\b|\b(bootstrap|scaffold|set ?up|start|create)\b[^.?!]*\b(new )?(repo|repository|project)\b/i.test(t) && /\b(rules|agents|guard|new)\b/i.test(t) },
  { skill: 'review', test: t => /\b(review|second opinion|theory review|check (this|my|the)|look (this|it) over|before (i |we )?(commit|push))\b/i.test(t) },
  { skill: 'plan-first', test: (t, n) => (n >= 12 && /\b(build|implement|create|design|develop|write)\b[^.?!]{0,60}\b(app|portal|pipeline|package|dashboard|tool|feature|workflow|simulation|analysis|framework)\b/i.test(t)) || /\b(plan|scope|align|spec)\b[^.?!]*\b(first|before)\b/i.test(t) },
  { skill: 'writing', test: t => /\b(email|e-mail|abstract|cover letter|tagline|rewrite|reword|humani[sz]e|de-?slop|sounds? like (ai|chatgpt)|draft (a|an|the|my))\b/i.test(t) },
]

const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length

/** The skill to hint at: none for a slash command, a short reply, or a prompt that already names the skill. */
export function pick(text: string, already: readonly string[]): string | undefined {
  const t = text.trim()
  const n = wordCount(t)
  if (t.startsWith('/') || t.startsWith('>') || n < 5) return undefined
  for (const r of RULES) {
    if (already.includes(r.skill) || new RegExp(`\\b${r.skill}\\s+skill\\b|\\bskill\\s+${r.skill}\\b`, 'i').test(t)) continue
    if (r.test(t, n)) return r.skill
  }
  return undefined
}

export const hintFor = (skill: string): string =>
  `skill-router: this looks like a job for the ${skill} skill. Load it with the Skill tool and follow it, unless the request clearly is not that.`
