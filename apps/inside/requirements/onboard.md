# REQ-ONBOARD — Designer onboarding

The designer-facing side of the marketplace: setting up a studio, adding work,
and getting it in front of a reviewer.

Introduced in #159. This is the funnel that decides whether good designers join
at all, which is why the requirements here are about *not losing people* rather
than about features.

---

## REQ-ONBOARD-001 — A studio can be set up without leaving the app

- **Status:** active
- **Source:** sean
- **Origin:** #159
- **Type:** functional
- **Priority:** P1
- **Statement:** A signed-in designer shall be able to take a studio from
  nothing to submitted for review without leaving the application.
- **Rationale:** Every hand-off — an email to send details, a form somewhere
  else, a person to chase — is a place the funnel leaks, and the designers most
  worth having are the ones with the least patience for it. The profile is
  created on first save and updated after, so a half-finished studio is a real
  row rather than something held hostage in the browser.
- **Verification:** Test — `apps/inside/inside-fe/tests/e2e/onboarding.spec.ts` › "an empty studio can be taken all the way to submitted"
- **Relations:** none

## REQ-ONBOARD-002 — Work in progress survives a refresh

- **Status:** active
- **Source:** sean
- **Origin:** #159
- **Type:** quality
- **Priority:** P1
- **Statement:** Unsaved edits to a profile shall still be present after the
  page is reloaded.
- **Rationale:** Onboarding is long — a name, a headline worth reading, a bio,
  a location, several pieces of work — and it is done on a phone, where a
  reload is a phone call, a low battery or a stray gesture. Losing half of it
  is the point at which somebody gives up and does not come back. The server
  holds what is saved. A local draft holds the keystrokes since, and the draft
  wins on load because it is newer by construction.
- **Verification:** Test — `apps/inside/inside-fe/tests/e2e/onboarding.spec.ts` › "work in progress survives a refresh mid-edit"
- **Relations:** none

## REQ-ONBOARD-003 — A rejection says what to do about it

- **Status:** active
- **Source:** sean
- **Origin:** #159
- **Type:** functional
- **Priority:** P1
- **Statement:** Where a profile has been rejected, the app shall show the
  reviewer's note alongside the status and allow the designer to resubmit.
- **Rationale:** A rejection the designer cannot act on is a dead end, and a
  dead end in a two-sided marketplace costs supply. The admin side already
  refuses to reject without a reason. This is the other half of that decision —
  the reason has to reach the person who can act on it, and resubmitting must
  not require starting again.
- **Verification:** Test — `apps/inside/inside-fe/tests/e2e/onboarding.spec.ts` › "a rejected designer sees the reason and can resubmit"
- **Relations:** none

## REQ-ONBOARD-004 — A refused upload says what was wrong with the file

- **Status:** active
- **Source:** sean
- **Origin:** #159
- **Type:** quality
- **Priority:** P2
- **Statement:** Where the server refuses an upload, the app shall show the
  server's own explanation rather than a generic failure message.
- **Rationale:** "Upload failed" tells a designer nothing they can act on, so
  they retry the same file and fail again. The server already knows whether the
  problem was the type, the size or the quota, and says so — discarding that
  and substituting a generic message is throwing away the only part of the
  response that helps. Progress is reported for the same reason: an upload with
  no visible progress is indistinguishable from a hung page.
- **Verification:** Test — `apps/inside/inside-fe/tests/e2e/onboarding.spec.ts` › "a rejected upload says what was wrong with the file"
- **Relations:** refines REQ-STATE-001

## REQ-ONBOARD-005 — Portfolio order is set by the designer and is what the public sees

- **Status:** active
- **Source:** sean
- **Origin:** #159
- **Type:** functional
- **Priority:** P2
- **Statement:** The order in which a designer arranges a piece's images shall
  be the order the public page renders them in.
- **Rationale:** Which image comes first is a curatorial decision, not a
  database artefact — it is the one a buyer judges the studio on. Reordering is
  persisted immediately rather than behind a save button, because an order that
  looks applied but was never saved is worse than one that cannot be changed.
  The drag handles carry a keyboard sensor so the order can be changed without
  a pointer, which is where drag-and-drop usually fails REQ-A11Y-002.
- **Verification:** Test — `apps/inside/inside-fe/tests/e2e/onboarding.spec.ts` › "a piece can be created, given an image, and published"
- **Relations:** depends-on REQ-A11Y-002
