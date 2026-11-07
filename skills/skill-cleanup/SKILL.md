---
name: skill-cleanup
description: Use to audit and clean up installed skills, plugins, MCP servers and hooks once skill-doctor has reported usage. Covers copies and drift across skill folders, skills to merge, privacy and security risks, telemetry, hook order, stale records and private forks. It writes a report, lets the person pick, and applies only their picks, reversibly. Does not measure per-skill context cost, use counts, last use or never-used skills and plugins, which is skill-doctor's job (run it first). Not for judging a plugin before install (assess-plugin).
---

# Skill cleanup

This skill builds on skill-doctor and does not repeat it.

| Job | Owner |
|---|---|
| Context cost of each skill per turn, use count, last use, never-used skills and plugins, a listing over budget | **skill-doctor** |
| Everything below | this skill |

> Assumption about skill-doctor (checked against code.claude.com docs and Claude Code 2.1.318 on 2026-11-05):
> - `/skill-doctor` now lives in the Stats tab of `/plugin`. That tab is interactive, so the person must open it.
> - `/doctor` → Extensions shows the same per-skill usage data and can be run in its place.
> - On another version, check where skill-doctor lives before relying on this. [placeholder: update if skill-doctor's scope changes]
>
> `/octo:skill-doctor` is a different tool. It checks Octopus's own providers and setup, not your skills. Run it only if the person uses octo.

## Rules for the whole run

1. **Read-only until the person decides.** Write the report, give the full list of recommendations, then wait. Apply only the items they pick.
2. **Everything must be reversible.**
   - Move removed items to `~/.Trash/claude-cleanup-<YYYYMMDD>[-tag]/`. Never `rm`.
   - Back up each config file to `<file>.bak-<YYYYMMDD>` before you edit it.
   - Never leave a backup inside a skills folder: a `.bak` skill folder loads as a live skill.
3. **Check before you claim.**
   - Read a skill's files before you say what it does or recommend removing it.
   - Measure each folder's own size. Never report the whole cache as reclaimable space.
   - Mark anything you could not check as `UNVERIFIED` and say why.
4. **Read a skill before you remove it.** A short slash-only shortcut that calls another skill costs no context, so keep it. One example is `grill-me`, which only calls `grilling`.
5. **Never print secrets** (tokens, peppers, keys). If one reaches the output, say so at once and rotate it.
6. **Correct wrong findings in the report where they appear.** Label each one **Correction:** and keep the original text.
7. **Ask before every push.** Never answer a risky-command guard prompt for the person.
8. Settings files may be sandbox-protected. Change them through the `update-config` skill, or ask the person.
9. Put long scan pipelines in a script file in the scratchpad. Command guards may block long inline commands.

## Step 0: Run skill-doctor first

1. Ask the person to open `/plugin` → Stats, or run `/doctor` and read its Extensions section.
2. Take from that output:
   - the never-used skills and plugins;
   - each skill's description cost;
   - whether the skill listing is over budget and how many descriptions are cut.
3. Use these as inputs. Do not recompute them.
4. Never-used items go straight into the "Turn off or remove" candidates in Step 8.

## Step 1: Inventory where skills live

1. List every skill source:
   - `~/.claude/skills`, the personal skills Claude Code reads;
   - `~/.agents/skills`, read by Codex;
   - the project's `.claude/skills`;
   - `~/.claude/plugins/cache/*`;
   - marketplace or mod folders that ship their own skills (for example `~/.claude/moddeck/skills`);
   - `~/.claude/agents`.
2. Read the lock and record files:
   - `~/.agents/.skill-lock.json` (used by `npx skills`);
   - `~/.claude/plugins/installed_plugins.json`;
   - `enabledPlugins`, `prependPlugins` and `env` in `~/.claude/settings.json`.
3. For each skill, record:
   - its path, and whether it is a real folder or a symlink (with the target);
   - a hash of its SKILL.md;
   - its frontmatter `name`;
   - whether it has `disable-model-invocation`;
   - its owner: personal, plugin, synced from the org, or managed by an installer.
4. Check which folders Claude Code actually reads. Pick a skill that exists in only one folder and see whether it appears in the session's skill list. Do not assume.

## Step 2: Find copies and drift, and pick one source of truth

1. Find exact copies, meaning the same skill as real files in two or more places. Diff them and flag the copies that have drifted.
2. Find skills that load twice. Typical cases:
   - one repository vendored by several plugins;
   - personal copies of skills a mod also ships.
3. Find MCP servers reached by two or more routes, such as a plugin plus a claude.ai connector. Flag any route through a third-party host.
4. Propose one source of truth: one real folder, with symlinks everywhere else.
5. Exceptions:
   - the app's `synced` folder;
   - any skill whose installer writes separate builds for each agent on purpose.

## Step 3: Find overlapping skills and propose merges

1. Group skills that do the same job, for example stress-testing a plan, handoff, code review, TDD, debugging, spec → build, architecture, writing, skill authoring, UI design, memory.
2. Read each skill before you judge it.
3. Output one row per job:

   | Job | Competing skills | Suggestion |
   |---|---|---|
   | Stress-test a plan | grilling, grill-me, … | Keep X; drop Y; why |

4. Prefer, in this order:
   1. the skill that already runs automatically (injected each session, or hook-driven);
   2. the person's own skill;
   3. the plugin skill the model can invoke.
5. Flag domain sets that are probably unused, such as large SEO, vendor or cloud sets. Mark them "confirm before removing".

## Step 4: Find stale and broken records

- `.bak.*` and `.trash` folders inside skills folders. They still load as skills.
- Plugins listed in `enabledPlugins` that are not installed.
- Local-scope plugin records for project folders that no longer exist.
- Old version folders in the plugin cache. Measure them with `du` per folder and report the true reclaimable size.
- MCP servers that fail to connect (closed connection, bad endpoint).
- Broken frontmatter or manifests. Run `claude plugin validate <real folder>` on the real folder, not the symlink folder: the validator does not follow symlinks.

## Step 5: Review privacy and security

Use the `security-audit` skill in guidance mode, limited to plugins, hooks and MCP servers. For each plugin, hook and MCP server, check:

| Check | What counts as a finding |
|---|---|
| Version pinning | `npx …@latest`, `uvx …@latest`, unpinned `pip install` in a hook |
| File reach | Whole-disk access (for example `allowedDirectories: []`); reads paths the sandbox denies (`~/.ssh`, `.env`, keys) |
| Sandbox | Runs a shell or reads files outside Claude Code's sandbox |
| Telemetry | Usage telemetry on by default (PostHog, vendor endpoints) |
| Data leaving the machine | Prompts, code or sessions sent to a third party, even through an optional backend |
| Local logs | Logs every prompt or tool output with no retention limit |
| Secrets handling | Tokens passed through `launchctl setenv` or env vars every app can read; secrets printed in output |
| Real-world reach | Drives the person's logged-in browser, or can act on the machine during replays |
| Hooks | Rewrites `settings.json`; runs on every prompt or tool call |

Write the results most severe first:

| Sev | Item | Issue | Fix |
|---|---|---|---|

- End with a "Clean:" line that lists what you reviewed and found no problem in.
- Optional static scan, local analyzers only: `skill-scanner scan-all <real skills folder> --recursive` (Cisco). Review the critical and high findings and label each as real or a false positive (vendored `node_modules`, test fixtures, a plugin's own workflow wording, masked sample keys).
- Do not send private skills to scanners that upload skill content (Snyk agent-scan, unless you pass `--no-skills`).

## Step 6: Check hooks

1. Find order conflicts. A notice like "X: its SessionStart hook was skipped. Y runs first …" means a feature is silently off. To fix it, list the skipped plugins before the blocking one in `prependPlugins`.
2. List the hooks that fire on every tool call and every prompt. They add latency to each action, so report them.

## Step 7: Optional value checks

- `claude plugin eval <name>@<marketplace> --max-cost-usd <cap>` shows whether a plugin helps. It uses model calls, so ask first.
- Skill-optimizing tools that replay past tasks (for example SkillOpt):
  - only use backends that stay local or go to Anthropic;
  - pass a reviewed, read-only task subset (`--tasks-file`, `--max-tasks 5`), because replay agents can install or uninstall things for real;
  - nothing is adopted without the person's yes.

## Step 8: Write the report and let the person decide

Write `SKILLS_AUDIT.md` in the working folder with these sections:

0. Status of the requested tools (what ran, what could not run, and why)
1. Delete: safe, no loss
2. Merge or consolidate (copies, then the overlap table)
3. Privacy and security (the severity table)
4. Other things worth knowing (hook conflicts, hook load, failed MCP servers, replay risk)
5. Checks to rerun (check | what it tells you | cost), with skill-doctor first
6. Not verified

For each plugin still in question, add a decision table:

| Plugin | Installed | Keep because | Disable because |
|---|---|---|---|

When the person asks what a plugin is, or what a finding means (for example "upsell text", "third-party images"), explain it in plain words. Then stop and wait for their choices.

## Step 9: Apply only the chosen items

Work in rounds. After each round, add "Applied <date> (round N)" to the report, listing every change and where its backup is.

| Action | How |
|---|---|
| Remove a skill | Move it to the dated Trash folder. Drop its entry from the skill lock so `npx skills update` does not reinstall it. |
| One source of truth | Move the real folder to the source location; replace the other copies with symlinks; keep the originals in Trash. |
| Merge skills | Turn each merged skill into a mode of the kept skill, with a mode table in SKILL.md and one reference file per mode when it is long. Credit the source skills. Widen the kept skill's description to cover the new modes. Remove the originals as in "Remove a skill". If the kept skill lives in a repo, change it there, run the repo's checks, and ask before pushing. |
| Merge a plugin's abilities into a skill | Add them as a new branch with its own reference file. Add `FORK.md` listing the changes and the upstream version. Drop the skill from the lock so updates leave it alone. |
| Disable or uninstall a plugin | Use `claude plugin disable <id>` (reversible) or `claude plugin uninstall <id>`. Org-synced plugins can only be disabled; tell the person where to remove them (claude.ai plugin settings). Give the command that reverts each change. |
| Private fork without ads or branding | Copy the skill to the skills source folder under a new name. Remove sponsored sections, upgrade prompts, tracking links and branding. Keep LICENSE. If the examples or media are not redistributable, say so and keep the fork private. List any external hosts that remain. Add `FORK.md`; drop the skill from the lock. |
| Turn telemetry off | Set it both in settings `env` (`DO_NOT_TRACK=1` and each tool's own variable) and in each tool's own config file. Whether `env` reaches MCP child processes is UNVERIFIED. |
| Lock down an MCP server or plugin | Pin the version, limit directories, deny secret paths after resolving symlinks, and run its self-test if it has one. |
| Set a retention limit on local logs | Back up the data first, because changing retention deletes old records. |
| Rotate a leaked secret | Rotate it. Then check every client that uses it and fix any that broke (for example a bridge needing a new flag). |
| Descriptions cut off (reported by skill-doctor or `/context`) | Prune first. Otherwise raise `skillListingBudgetFraction` (for example 0.02) and say the new token budget. |
| Hook order | Set `prependPlugins` as in Step 6. |
| Stale records | Remove records for deleted folders and plugins enabled but not installed; trash old cache versions. |

After any installer run (mods, `npx skills`), check that it did not replace a symlink with a copy or rename it to `.bak`. Relink if it did.

## Step 10: Verify after a restart

1. Ask the person to restart, then check in a fresh session:
   - the skill count, and that every personal skill is present;
   - no `.bak` skills, and removed items are gone;
   - no "hook was skipped" notices;
   - descriptions are not cut (`/context`, Skills row);
   - `claude plugin validate <real folder>` passes;
   - each changed MCP server answers (for example a memory handoff round trip, or a connector now authorized).
2. Hand the usage view back to skill-doctor. Ask the person to reopen it and confirm the context cost went down.
3. Record what you could not check under "Not verified".

## Step 11: End with the remaining actions

End the report with this table:

| # | Item | Who (you / decide) |
|---|---|---|

Keep it current each round. Never act on a "decide" row without the person's yes.
