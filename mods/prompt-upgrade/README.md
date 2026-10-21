# prompt-upgrade

Install (Claude Code 2.1.304 or later): `/plugin install prompt-upgrade --marketplace samuelbfernandes/moddeck`

## What it does
Turns a rough prompt into a great one before it is sent. A pane walks four steps, shown as a tracker across the top:
**Your prompt, Questions, Rewrite, Review**. Nothing runs until you press **Run it**.

1. **Questions**: a fast model asks up to three multiple-choice questions (two to four options each, plus "Other (type it)" and
   "Skip"). If no question would help it goes straight to the rewrite.
2. **Rewrite**: the model writes the upgrade and a short list of what it added. It keeps what you meant, adds a goal, an
   audience, a format and what "done" looks like, uses your answers, and leaves `[placeholders]` where something is unknown.
3. **Review**: words before and after and how many details were added, then the buttons (Run it, Edit, Copy, Cancel), then the
   list of what was added, then your prompt and the upgrade side by side.

## Commands
- `/better <prompt>`: upgrade that prompt. `/better` alone opens a box to type one.
- `/better on` / `/better off`: automatic mode. While on, a prompt typed at the prompt box goes to the pane first.
- `/better history`: your last 20 upgrades; a click reopens its review.

Automatic mode lets these go straight through: slash commands, prompts with files or images, messages sent while Claude is
working, short replies ("yes", "keep going", under `minWords` words), and anything starting with `>` (the `>` is removed).
The upgrade is sent with `$.prompt.submit`, which skips this mod's own hooks, so it cannot loop back into the pane.

## Buttons
**Cancel** closes the pane and puts your original back in the prompt box. **Edit** lets you change the upgrade; Enter runs it.
A failed model call shows a card that says your prompt is safe: Try again, Send my original, Cancel. If the window is too
narrow for the pane, your words go back in the prompt box.

## Cost
Off until `/better on` (the command itself is free until used). Each upgrade is one fast-model call (default `haiku`, at most 600
tokens out) and one rewrite call (default `sonnet`, at most 1800 tokens out). Both models are settings.

## Limits
- Saved in the mod's own store: the switch (`auto`) and the last 20 upgrades (`history`).
- Not verified live: the pane in a real session, in the desktop app, and the model aliases `haiku` and `sonnet`.
