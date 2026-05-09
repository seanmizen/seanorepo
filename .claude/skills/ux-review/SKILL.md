# /ux-review skill — drop into `.claude/skills/ux-review/SKILL.md`

> **Note from the SEAN-110 worker:** the agent sandbox blocked direct
> writes to `.claude/skills/`, so the skill content is parked here. Move
> this file to `.claude/skills/ux-review/SKILL.md` (rename to `SKILL.md`)
> to register the skill — the rest of the harness (rubric, capture,
> flows, baseline) is wired up and ready.

---

```markdown
---
name: ux-review
description: Score a captured UX run against the 10-dimension rubric. Reads each step's screenshot and aria-snapshot, scores 1-5 per dimension, writes scorecard.md.
---

# /ux-review — score a captured UX run

This skill turns a Playwright capture bundle (screenshots + aria
snapshots + console + network) into a scored UX rubric report.

The rubric lives in `apps/ffmpeg-converter/web/tests/ux/rubric.ts` and is
the single source of truth — both the deterministic test suite and this
skill import the same dimension definitions from there.

## When to invoke

- The user asks for a UX review on a specific capture run path.
- A worker agent finished a converter-touching ticket and wants to verify
  UX quality before self-merge (eventual: SEAN-115 wiring).
- Someone says "score the latest run" — pick the most recently modified
  directory under `apps/ffmpeg-converter/web/tests/ux/runs/`.

## Inputs

- **Required**: a path to a run directory, e.g.
  `apps/ffmpeg-converter/web/tests/ux/runs/2026-05-09T12-00-00Z/`.
  This contains one subdirectory per flow (`first-time-visitor/`,
  `direct-tool-page/`), each with numbered step directories
  (`01-cold-landing/`, `02-drop-file/`, ...).

If the user just says "score the latest run" without a path:
1. List `apps/ffmpeg-converter/web/tests/ux/runs/` sorted by mtime.
2. Pick the most recent (skip `baseline/` unless they explicitly ask).

## What to do

For each flow under the run directory:

1. **Read the manifest**: `flow_dir/manifest.json` lists the steps in
   order and their artefact paths.

2. **Load the rubric definitions**: read
   `apps/ffmpeg-converter/web/tests/ux/rubric.ts` and parse the `RUBRIC`
   array. Use the `key`, `name`, `description`, and `anchors` from each
   `RubricDimension`. Never invent dimensions — the rubric file is the
   source of truth.

3. **For each step, ingest the evidence**:
   - The PNG screenshot at `step_dir/screenshot.png` — pass it directly
     into the prompt as a vision input. Claude can see UI hierarchy, CTA
     prominence, error legibility, etc.
   - `step_dir/aria.json` — the accessible name tree. Read this as text;
     it tells you what assistive tech sees, which is the ground truth for
     headings, labels, and roles.
   - `step_dir/console.log` — any client-side errors emitted during the
     step. Empty file means a clean step.
   - `step_dir/network.har` — request/response status codes. A 4xx/5xx
     during the flow is a red flag for `errorLegibility` and `flowLogic`.

4. **Score each rubric dimension 1–5** using the `anchors` from the
   rubric file. Be honest:
   - A dimension is **5** only if the evidence clearly meets the 5-anchor.
   - Default to **3** when evidence is mixed or unclear; reserve **5** for
     "I cannot find a way to improve this step further".
   - Score **1** when the evidence shows a hard failure of the dimension
     (e.g. a stack trace visible in the result block kills
     `errorLegibility`).
   - Each score MUST cite at least one piece of evidence (step name +
     what you saw in the PNG or aria.json or console).

5. **Write `scorecard.md`** in the flow directory (next to manifest.json).
   Format:

   ```markdown
   # UX Scorecard — {flow.name}

   - **Captured**: {manifest.capturedAt}
   - **Base URL**: {manifest.baseURL}
   - **Total**: {sum}/{max}

   ## Per-dimension scores

   | Dimension | Score | Rationale |
   |---|---|---|
   | First-paint clarity | 4/5 | Hero headline visible at 01-cold-landing; CTA above the fold but the file picker label is small. |
   | ... | ... | ... |

   ## Step-by-step observations

   ### 01-cold-landing
   *Screenshot: 01-cold-landing/screenshot.png*

   - What I saw in the screenshot.
   - What I saw in the aria tree.
   - Any console errors.

   ### 02-drop-file
   ...

   ## Recommendations

   - Concrete, actionable suggestions ranked by impact.
   - Each tied to the dimension(s) it would lift.
   ```

6. **Also write `scorecard.json`** alongside `scorecard.md` using the
   `Scorecard` shape from `rubric.ts`. This is what SEAN-115 will use for
   programmatic gating (any dimension < `FAIL_BELOW` blocks self-merge).

7. **Repeat** for every flow in the run directory.

8. **Write a top-level `scorecard.md`** at the run-directory root that
   summarises every flow with a one-line total.

## Scoring discipline

- **No grade inflation.** "It looks fine" is not a 5. The 5-anchor is a
  high bar — most apps will score 3–4 on most dimensions.
- **Cite evidence, not feelings.** Every score has a screenshot reference
  or aria-snapshot quote backing it.
- **Compare to baseline when one exists.** If
  `tests/ux/runs/baseline/scorecard.json` exists, note any dimension
  that regressed by ≥1 point. Regressions are the most actionable signal.
- **The rubric is closed.** Do not invent new dimensions. If you think
  one is missing, file a ticket — do not score against it.

## Tips for vision

- Look at the screenshot at full resolution (1280×800 viewport, fullPage).
- For `firstPaintClarity` and `ctaSalience`, use the first step's
  screenshot only — clarity is a first-impression metric.
- For `waitStateHonesty`, look at intermediate-step screenshots that show
  the spinner/progress text.
- For `resultBlockSufficiency`, check the final step where the download
  link appears.
- The aria tree often reveals issues invisible in screenshots (missing
  `aria-label`, an `<input>` with no label, a `<button>` with empty
  accessible name).

## Output checklist

After running the skill, the run directory contains:

- `{run_dir}/{flow}/scorecard.md` — human-readable, per flow.
- `{run_dir}/{flow}/scorecard.json` — machine-readable, per flow.
- `{run_dir}/scorecard.md` — top-level summary across flows.

These are the inputs SEAN-115 will read to gate self-merges.
```
