# REQ-CRM-LAYOUT — One layout, with one breakpoint

Each crm page has the same layout: the device (the control panel) and the
data of the page. A wide screen shows them side by side. A narrow screen
shows them in one column. One width sets which layout a screen gets.

---

## REQ-CRM-LAYOUT-001 — One breakpoint, and a 40/60 grid of the device and the boxes

- **Status:** active
- **Source:** sean
- **Origin:** #1074
- **Type:** constraint
- **Priority:** P1
- **Statement:** The crm theme shall change the layout of a page only at
  one breakpoint, written once in `crm-fe/src/theme.css`. At or above the
  breakpoint (wide), the page is a grid of two columns, `2fr 3fr` (40% and
  60%). The left column holds the device only. The right column holds the
  help text and the data of the page, as a stack of boxes. The page has a
  maximum width in px and starts at the top left, and the line of nav
  links is in the footer row, next to `top`. Below the breakpoint
  (narrow), the page is one column in the order of the HTML: the path
  title, the nav links, the device, the boxes and the footer. The outer
  page margin is 1px, and text out of a box has its own side padding. Each
  section of data (for example Activity, Contacts, Details, the passkeys
  and the sessions) is a `ui/Box`: a white box on the surface color with a
  silkscreen title, which can hold buttons and forms, and whose text is
  plain text. No column width depends on the root font size: the columns
  are fractions, and the page width is in px.
- **Rationale:** Sean, between 760px and 784px: "seems you didn't agree on
  the widths for the site. between this site width it's all pretty
  fucked." The layout had two breakpoints that nobody chose together: a
  media query at 760px, and the wrap point of a flex row with widths in
  `rem`, at about 784px. Between them the page was half one layout and
  half the other, and at 760px each `rem` width jumped by 21%. Sean also
  asked for the boxes of autosam: "probably 40/60 relative width when on
  wide screen pls so we have our 'control panel' on the left and
  data-heavy stuff on the right." On a phone: "mobile should have only 1px
  outer margins ... let's use all that space." The nav links are in the
  HTML once, under the path title, so the bare page and a screen reader
  get them at the top. The root font is 14px wide and 17px narrow, because
  17px stops iOS from a zoom into a field. So the column widths are
  fractions, and the font change does not move a column.
- **Verification:**
  - Test — `apps/crm/crm-be/src/layout.test.ts` › "every width media query in theme.css uses the one breakpoint, and no row of the page wraps (REQ-CRM-LAYOUT-001)"
  - Test — `apps/crm/crm-be/src/layout.test.ts` › "the left column holds only the device, and each section of data is a Box in the right column (REQ-CRM-LAYOUT-001)"
  - Test — `apps/crm/crm-be/src/layout.test.ts` › "the nav links are in the HTML once, under the path title (REQ-CRM-LAYOUT-001)"
  - Demonstration — `node apps/crm/scripts/shoot.mjs` shoots each page at six widths: the breakpoint minus 1px, the breakpoint, the breakpoint plus 24px, 390px, 1200px and 1440px. It prints each page that scrolls sideways. Look at each image.
- **Relations:** none
