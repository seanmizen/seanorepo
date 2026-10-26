# REQ-BARE — The page works with no page styles

autosam has a bare theme (`?theme=bare`): browser defaults and
modern-normalize only. A theme changes the look of the page. It must not
change what a person can do or know.

---

## REQ-BARE-001 — Every state shows with no page styles

- **Status:** active
- **Source:** sean
- **Origin:** #966
- **Type:** constraint
- **Priority:** P1
- **Statement:** While the bare theme is on, the autosam page shall show
  each state that it shows in the other themes.
- **Rationale:** In the first bare theme, the playing bar, the beat, and the
  selected key and piano style showed only through CSS classes. With no page
  styles a person could not tell what was playing. Text, native elements
  (`<mark>`, radio buttons) and attributes carry each state. A class only
  gives a state its look in a styled theme.
- **Verification:** Test — `apps/autosam/test/bare.test.ts` › "each state class in app.js has a carrier with no page styles (REQ-BARE-001)"
- **Relations:** none
