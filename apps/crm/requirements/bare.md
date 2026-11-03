# REQ-CRM-BARE — Every page works with no page styles

The crm has a bare theme (`?theme=bare`): browser defaults only, with no page
styles and no page scripts. A theme changes the look of a page. It must not
change what a person can do or know.

---

## REQ-CRM-BARE-001 — Every page works as raw HTML

- **Status:** active
- **Source:** sean
- **Origin:** #1047
- **Type:** constraint
- **Priority:** P1
- **Statement:** While a page has no page styles and no JavaScript, each crm
  page shall show each state and allow each action that it shows and allows
  in the Pixel-3 theme.
- **Rationale:** The seller uses the crm on a phone at a door, on a bad
  connection. The CSS or the script may not load. Text, native elements (`<select>`,
  `<option selected>`, `<button>`) and attributes carry each state. A class
  only gives a state its look. Each action is a `<form>` with a string
  `action`, so it works with no script.
- **Verification:** Test — `apps/crm/crm-be/src/routes/index.test.ts` › "every page shows each state and allows each action with no page styles and no JavaScript (REQ-CRM-BARE-001)"
- **Relations:** none
