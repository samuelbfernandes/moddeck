# skill-router

Install: `/plugin install skill-router --marketplace samuelbfernandes/moddeck`

Makes sure a skill is used when the task calls for it. A prompt that clearly asks for one of the toolkit's skills gets one
added line naming it; the model then loads the skill with the Skill tool.

## What it does
Local keyword rules, first match wins, no model call:

| Skill | A prompt that mentions |
|---|---|
| ahpcc | ahpcc, pinnacle, slurm, sbatch, squeue, "on the cluster" |
| assess-plugin | assess / vet / "safe to install" with plugin, mod, mcp or skill |
| agents-md-scaffold | AGENTS.md, or starting a new repo with rules |
| review | review, second opinion, "check this", "before I commit/push" |
| plan-first | a long request to build an app, portal, pipeline or package; "plan/scope/align first" |
| writing | email, abstract, cover letter, rewrite, humanize, "sounds like AI", "draft a..." |

Each skill is hinted once per session. Slash commands, `>` prompts, replies under five words, and prompts that already say
"the <skill> skill" get nothing. About 30 tokens on a matching prompt.

## Use
    /skill-router           status: skills hinted this session
    /skill-router on | off

## Limits
Keywords are a guess at intent: a hint is advice ("unless the request clearly is not that"), not a command. The skills'
own descriptions still let the model choose them without a hint.

## State for the moddeck side bar
`skill-router` → `isOff`, `hinted` (see `types/index.d.ts`).
