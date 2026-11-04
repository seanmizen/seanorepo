# REQ-CRM-BUTTON — A button stays in its place

A button that cannot act now stays where it is, greyed out, and says why.
The layout does not move, and a person does not have to look for a button
that sometimes shows.

---

## REQ-CRM-BUTTON-001 — A button that cannot act is off, with its reason

- **Status:** active
- **Source:** sean
- **Origin:** #1089, #1091
- **Type:** constraint
- **Priority:** P2
- **Statement:** While a button of the crm cannot act, the crm shall show
  it in its usual place with the native `disabled` attribute, and with the
  reason in its `title` and in its accessible description
  (`aria-describedby`). This applies to each button except `Enter as
  admin (demo)` on `/login`, which shows only while the demo switch is on.
- **Rationale:** Sean: "buttons should generally exist always to preserve
  layout and reduce user fatigue. greyed-out should come with a hover
  tooltip explaining why they are disabled." The `title` is the hover
  text. The same reason is a text that `aria-describedby` names, so a
  screen reader reads it, and the bare theme (REQ-CRM-BARE-001) shows it
  after the button. `ui/Key.tsx` holds the rule: a key with `off` (the
  reason) is off. The buttons that can be off are `Undo`, `Redo` and
  `Show hidden` (Activity box), `Prev` and `Next` (the pager of the list,
  on the plate of the display unit, where the caption under each key is
  its reason), `Everywhere else` and the `Revoke` of this session
  (`/account/sessions`), `Reset demo data` (`/account`), `Add a passkey`
  (`/account/passkeys` and the 403 page), `Delete` (`/account/passkeys`),
  `Sign in with a passkey`, `Sign in` (`/login/verify`), `Start recovery`
  (`/login/recover`), and `Allow` and `Deny` (the consent page). With no
  JavaScript, each passkey key is off, and its reason is the note that
  says passkeys need JavaScript: the passkey script turns it on. The live
  `/login` is public, so it does not show a demo sign-in to a stranger.
- **Verification:**
  - Test — `apps/crm/crm-be/src/events.test.ts` › "Undo, Redo and Show hidden are present in each state, and an off key has its reason in title and in its accessible description (REQ-CRM-BUTTON-001)"
  - Test — `apps/crm/crm-be/src/buttons.test.ts` › "each button is present in each state, and an off button has the native disabled, and its reason in title and in its accessible description (REQ-CRM-BUTTON-001)"
  - Test — `apps/crm/crm-be/src/demo.test.ts` › "no page shows the demo line, and Reset demo data is off (REQ-CRM-BUTTON-001)"
- **Relations:** none
