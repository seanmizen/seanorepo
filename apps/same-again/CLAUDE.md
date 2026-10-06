# CLAUDE.md: same-again

These instructions apply to agents that work in `apps/same-again`. The rules in
the root `CLAUDE.md` also apply.

## What this app is

The working title is **Same Again Please**. The logo shows "SAP" to tell players
that the title has three words. The folder name `same-again` stays until Sean
says otherwise.

The game is a café and bar game. Regulars come back to the bar. The player must
remember the usual order of each regular. Correct recall without asking gives a
big tip and a new part of the regular's story. Asking for the order gives a
small tip.

A spaced-repetition scheduler (FSRS) controls when each regular comes back. A
regular returns when the player's memory of that regular starts to fade. The
memory science is the core loop, and the player never sees it.

Read `concept.md` before you start. It holds Sean's own words and is the
source of truth for intent.

## Rules for this folder

1. **`concept.md` is append-only.** Each entry is a prompt from Sean. Do not
   edit, correct, summarize or reorder an entry. When Sean gives a new
   load-bearing prompt, append it word for word under a dated heading.
2. **Do not write your notes in `concept.md`.** Put design notes in
   `docs/`. Put binding requirements in `requirements/`.
3. **The hook writes `LINEAGE.md`.** Do not edit `LINEAGE.md`. Before you open a
   PR, look for your session ID in it. If your session has no row, write that
   in the PR body.
4. **Do not use AI-generated art, voice or music.** The game takes art and voice
   lines from human contributors only. Until those exist, use placeholders:
   flat shapes, text labels, and silence. Code and tests can come from an agent.
5. **Do not write payment, advert or revenue-share code.** These are open
   decisions (see below).
6. Use the `workflow` skill for each issue, branch and PR.
7. **The game is proprietary.** `LICENSE` reserves all rights. Do not change
   `LICENSE` without asking Sean. Each `package.json` in this folder must have
   `"private": true` and `"license": "SEE LICENSE IN LICENSE"`.
8. **Record all third-party code.** Before you add a dependency, or copy or port
   code, examine its licence. Use only MIT, BSD, ISC, Apache-2.0 or zlib code.
   For other licences (GPL, AGPL, LGPL, MPL, CC-BY-SA, no licence), ask Sean.
   Add the full licence notice to `THIRD_PARTY_NOTICES.md`. In each ported
   file, keep the copyright line of the source at the top.
9. **Do not accept outside contributions** until a contributor agreement exists
   (open decision 4).

## Locked decisions

Do not change these without asking Sean.

- **Core loop.** Regulars, usual orders, a tip for correct recall. FSRS sets
  the return time of each regular.
- **Hidden learning.** Never call any part of the game "flashcards", "study",
  "quiz" or "brain training". Never claim that the game improves memory in
  general. The research says that claim is false.
- **Keyboard first.** The player can do every action with the keyboard only.
  The game draws a visible focus ring. The mouse is optional.
- **Canvas UI.** The game draws its whole UI on a canvas. The native build and
  the web build look and feel the same.
- **Accessibility from the start.** The UI is one tree in code. The tree draws
  the canvas and also produces a semantic tree. The web build mirrors the
  semantic tree into hidden DOM elements and an `aria-live` region. The native
  build sends it to AccessKit. Every voice line has a caption. A setting turns
  off all timers.
- **Text input uses the platform IME.** On the web, keep a hidden `<input>`
  element in focus and read its composition events. Do not build your own
  input method for accents or non-Latin scripts.
- **Language mode.** The mode is optional and off by default. The answer format
  changes per item: multiple choice while a memory is weak, typed recall when
  FSRS rates the memory as stable. Lower difficulty levels accept answers with
  missing accents.

## Open decisions

Do not decide these alone. For each one, open a GitHub issue with the `idea`
label. Give the options and one recommendation. Then stop the work that
depends on the decision, and continue with other work.

1. **Stack.** The two candidates are `utils/swindowzig` (Zig, SDL2 for native,
   canvas and WASM for the web) and a TypeScript canvas app. Do not write game
   code until Sean selects one.
2. **Final name and folder name.** Sean intends to buy `sameagainplease.com` and
   `sameagainplease.io`. A trademark search is not done.
3. **Business model.** Product placement in orders, and a reward pool that pays
   contributors from advert revenue.
4. **Contributor pipeline.** How people submit art and voice lines, how a
   person checks them, and how the game credits them.
5. **Art direction.**
6. **The first target language** for language mode.

## Milestone 0: start here

You can do this milestone before the stack decision.

1. Read `concept.md`, `requirements/README.md` and `apps/inside/requirements/`
   as an example.
2. Write the app requirements in `apps/same-again/requirements/`. Use one file
   for each area, for example `loop.md`, `sched.md`, `a11y.md`, `lang.md` and
   `assets.md`. Make each locked decision above into one or more requirements.
3. Run `yarn requirements:check` and fix every error.
4. Write `docs/design.md`. Include the day loop, the regular data model, the
   tip rules, the FSRS inputs and outputs, and the keyboard map.
5. Open one `idea` issue for each open decision.

## Milestone 1: playable prototype

Start this milestone only after Sean selects the stack.

- One web build. No backend. Local save only.
- Ten regulars with placeholder art, names, one usual order each, and three
  story fragments each.
- One in-game day has a fixed number of customers. Each customer is a new
  regular or a regular that FSRS selected.
- The player serves each customer. The player can recall the order or ask for
  it.
- FSRS updates after each recall. Unit tests cover the scheduler.
- The player can play the full day with the keyboard only.
- The timer-off setting works.

## Before you finish

1. Run `yarn fix` from the repository root.
2. Run the type checker and the tests for the stack you use. Fix every error.
3. Run `.claude/skills/ste/scripts/ste-lint.py` on new prose.
4. Look for your session ID in `LINEAGE.md`.
