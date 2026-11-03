# REQ-CRM-BUTTON — A button stays in its place

A button that cannot act now stays where it is, greyed out, and says why.
The layout does not move, and a person does not have to look for a button
that sometimes shows.

---

## REQ-CRM-BUTTON-001 — A button that cannot act is off, with its reason

- **Status:** active
- **Source:** sean
- **Origin:** #1089
- **Type:** constraint
- **Priority:** P2
- **Statement:** While the `Undo`, `Redo` or `Show hidden` button of the
  Activity box cannot act, the crm shall show it in its usual place with
  the native `disabled` attribute, and with the reason in its `title` and
  in its accessible description (`aria-describedby`).
- **Rationale:** Sean: "buttons should generally exist always to preserve
  layout and reduce user fatigue. greyed-out should come with a hover
  tooltip explaining why they are disabled." The `title` is the hover
  text. The same reason is a text that `aria-describedby` names, so a
  screen reader reads it, and the bare theme (REQ-CRM-BARE-001) shows it
  after the button. `ui/Key.tsx` holds the rule: a key with `off` (the
  reason) is off. The rule is Sean's rule for every button, and this
  requirement covers the first three. A later requirement can amend it
  to cover each button.
- **Verification:** Test — `apps/crm/crm-be/src/events.test.ts` › "Undo, Redo and Show hidden are present in each state, and an off key has its reason in title and in its accessible description (REQ-CRM-BUTTON-001)"
- **Relations:** none
