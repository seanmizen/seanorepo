# intentional-design

This project studies how to build UIs with intent. The goal is to depart from
the most probable answer: the generic patterns that a model reproduces from
its training data. Every design decision must have a reason that belongs to
this product and its users.

## Hard rule

**Do not create a numbered file until Sean asks for one.** Each request gives
permission for one file. This rule has no exceptions. A good idea, a long
reply or a related task does not give permission. This `CLAUDE.md` is the
only file in the folder that has no number.

You can change an existing numbered file when Sean asks for the change.

## Format

- Documents only. No code, no `package.json`, no build step.
- Markdown files with a two-digit prefix: `01-<slug>.md`, `02-<slug>.md`.
  Use the next free number.
- Less is more. Keep each file short. Do not add a README or an index.

## Test case

`apps/autosam` is the first test case. Its theme switch
(`apps/autosam/public/themes.css`) applies these documents. Code stays in the
app. This folder holds only the documents.

A theme changes the look, never the function (REQ-BARE-001). With no page
styles (the bare theme), the page still shows each state and each fact. A
design that needs CSS to say what plays is a broken design.
`.claude/rules/autosam.md` says how to build to this rule.

## Source

Katie Dill (Stripe), "How to scale intent, quality, and artistry with AI":
https://www.youtube.com/watch?v=GLvFTMtw4Jk
