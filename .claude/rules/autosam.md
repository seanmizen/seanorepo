---
paths:
  - "apps/autosam/**"
---

# autosam

A piano practice partner: vanilla JS in `public/`, no build step, one Bun
process on port 4090. The theme work comes from
`projects/intentional-design`.

## A theme changes the look, never the function

REQ-BARE-001. The bare theme (`?theme=bare`) turns off every page style. The
page must still show everything the styled themes show: what plays, the beat,
each selection, each message.

- **Carry state in the HTML.** Use text, a native element (`<mark>`,
  `<progress>`, `<meter>`, `<details>`, a radio or a checkbox, `disabled`),
  or the `hidden` attribute. Add ARIA (`aria-current`, `aria-pressed`) for
  assistive technology. A class may give a state its look. A class must never
  be the only thing that shows a state.
- **"Pick one of N" is a radio group.** Use radios in labels, and style the
  label in `app.css`. Do not use buttons with `aria-pressed`, because no
  browser draws `aria-pressed`.
- **Keep words apart in the markup.** A flex or grid `gap` hides a missing
  space. Put a space between inline siblings. In JS, use `spaced()` in
  `app.js`.
- **A new state class needs a carrier.** `test/bare.test.ts` lists each class
  that `app.js` turns on and off, with what shows the same state with no
  page styles. Add the line when you add the class. `yarn test` fails
  without it.
- **Check it by eye.** After a change to what the page shows, open the page
  with `?theme=bare` and use the feature: press Play, change the key, jump
  to a bar.

## Where styles go

- `public/app.css`: every page style, inside
  `:where(:root:not([data-theme="bare"]))`. Bare turns it off.
- `public/chrome.css`: only what every theme needs to work: the morph layer,
  the fixed theme pane, the debug panel. Never a look.
- `public/themes.css`: tokens only.
- A change to `app.css` must leave the other themes the same. Check with a
  pixel diff against `origin/main`.
