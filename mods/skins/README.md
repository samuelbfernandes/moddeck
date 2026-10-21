# skins

Install: `/plugin install skins --marketplace samuelbfernandes/moddeck`

Fifteen colour themes ("skins") for Claude Code, and a nicer drawing of its output: tool-call rows with icons and timings,
diff, table, code, math, Mermaid and shell cards, links, folding and a usage band.

## Credit

**This mod is not my work.** It is [hellosverre/claude-skins](https://github.com/hellosverre/claude-skins) (version 0.5.9,
MIT, © 2026 hellosverre), copied into moddeck unchanged except for the points below. Every skin, every card and the
`/skin` command are the original author's. The original licence is in [LICENSE](LICENSE). If you like it, star the
original repository.

What changed in this copy:
- The daily version check (a request to GitHub) and the one-time "star us" toast were removed: moddeck mods make no network
  calls. Update by updating moddeck.
- `plugin.json` says where it came from. The `skin-designer` skill, the tests and the drawing code are as published.

## Use

Pick a skin from the **skins** dropdown in the moddeck side bar, or type:

    /skin             open the skin settings
    /skin <name>      switch to a skin (noir, tokyo-night, dracula, nord, gruvbox, catppuccin, rose-pine, everforest,
                      one-dark, solarized, github, kanagawa, ayu, night-owl, mono)
    /skin list        list them
    /skin off         go back to Claude Code's own look
    /skin gallery     see them all

Skins follow Claude Code's light or dark theme. The full command list is in the original README.

## Turn off
`/skin off`, or `/plugin disable skins`.

## Costs and limits
No model calls, no network, no programs started. Not tested on every terminal; layout was verified only by the original
author's tests, which are included.
