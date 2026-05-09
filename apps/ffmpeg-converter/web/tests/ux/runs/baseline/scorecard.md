# UX Scorecard — baseline

This is the regression anchor for SEAN-110 (#114). Future runs of
`yarn test:capture` followed by `/ux-review` will be compared to this
scorecard; any dimension that regresses by ≥1 point is a self-merge
blocker (per SEAN-115).

The scorecard was produced from a manual cold-load of the converter site
on 2026-05-09, scored against the 10-dimension rubric defined in
`apps/ffmpeg-converter/web/tests/ux/rubric.ts`. Screenshots and aria
snapshots were not committed (>1MB total, per the issue notes); only this
markdown is the persistent artefact.

- **Captured**: 2026-05-09T00:00:00Z
- **Base URL**: http://localhost:4050
- **Total**: 38/50

## Per-dimension scores

| Dimension | Score | Rationale |
|---|---|---|
| First-paint clarity (`firstPaintClarity`) | 4/5 | Hero headline names the product and the drop zone is above the fold. The CTA could be louder — the dashed-border drop zone reads as decorative on first glance. |
| CTA salience (`ctaSalience`) | 3/5 | The drop zone is the primary CTA and is identifiable, but it competes visually with the example chips below it. No high-contrast button reinforces the action. |
| Decisions to conversion (`decisionsToConversion`) | 5/5 | Drag-drop on the homepage auto-routes via the matrix. Zero required decisions before the conversion fires. SEAN-105/107/108 work landed this. |
| File picker permissiveness (`filePickerPermissiveness`) | 5/5 | SEAN-105 dropped the `accept=` attribute from the picker. The OS shows every file; routing is decided after the file is in hand. |
| Flow logic (`flowLogic`) | 4/5 | Drop → progress → result block is linear and obvious. Slug-page → cross-category drop swaps the panel without losing the file (SEAN-107). One small wart: the "convert another" affordance lives below the result, not next to the download button. |
| Error legibility (`errorLegibility`) | 4/5 | SEAN-108 added a friendly fallback ("we can't convert .X yet") with a "Clear and try another file" recovery button. Lifts this from a 2 to a 4. Could be 5 with a list of supported formats inline. |
| Time to success (`timeToSuccess`) | 3/5 | Tiny fixtures convert in 2–5s on local dev. No persistent progress signal during the wait — just the "converting" text. Real-world larger files would likely score lower without a percent indicator. |
| Wait-state honesty (`waitStateHonesty`) | 3/5 | "Converting…" text appears but no percent or step counter. The user knows something is happening but not how long is left. |
| Result block sufficiency (`resultBlockSufficiency`) | 4/5 | ResultBlock surfaces a Download link with the output filename. Could be 5 with the file size and a more prominent "convert another file" affordance. |
| Restrictions log (`restrictionsLog`) | 3/5 | One restriction surfaced (unsupported extension on homepage) with a clear suggestion. Cross-category drop on a slug page still leaves a moment of confusion before the panel swaps. |

## Step-by-step observations

### Homepage cold landing (`first-time-visitor / 01-cold-landing`)

- Hero headline is visible above the fold and names the product clearly.
- The drop zone has a dashed border and a "drop a file here" prompt.
- No high-contrast primary button reinforces the CTA — the drop zone IS
  the CTA, which works for desktop drag-drop but is less obvious on
  mobile.

### Drop file (`first-time-visitor / 02-drop-file`)

- Dropping `tiny.mov` triggers the chip-row panel and fires the convert
  request. No interstitial "are you sure" — good for `decisionsToConversion`.
- The wait state shows "Converting…" but no percent or step indicator.

### Result block (`first-time-visitor / 03-result-block`)

- The download anchor's accessible name starts with "Download " (verified
  by the e2e suite). Clicking it serves the converted bytes.
- Filename of the output is visible. File size is not. No prominent
  "convert another" affordance next to the download button.

### Direct slug page (`direct-tool-page / 01-cold-slug-landing`)

- `/convert/mov-to-mp4` shows a clear "MOV to MP4" headline and the same
  drop zone pattern as the homepage. Consistency is good.

### Drop fixture on slug page (`direct-tool-page / 02-drop-fixture`)

- Drop succeeds. If the dropped file mismatches the slug (e.g. PNG on
  mov-to-mp4), the adaptive panel swaps in place (SEAN-107) — no
  silent failure.

### Download (`direct-tool-page / 03-download`)

- Same result block as the homepage flow.

## Recommendations

Ranked by impact:

1. **Add percent or step progress to the wait state** (`waitStateHonesty`,
   `timeToSuccess`). Even a fake-but-monotonic progress bar lifts both
   dimensions.
2. **Add file size + "convert another" button to ResultBlock**
   (`resultBlockSufficiency`). One block, all the user needs.
3. **Inline the list of supported formats in the friendly error**
   (`errorLegibility`). Lifts the recovery action from "try again" to
   "try this specific thing".
4. **Reinforce the drop zone CTA with a high-contrast button**
   (`ctaSalience`, `firstPaintClarity`). Mobile users especially.
