# REQ-BRIEF — Briefs and who can see them

A brief is a buyer's posted job. It replaces the enquiry-as-a-separate-object
model: a **private** brief with one invitee *is* an enquiry, a **public** one is
an open tender. One object covers both directions.

Introduced in #155, reshaped in #185, renamed in #189, and given this
visibility model in #158.

---

## REQ-BRIEF-001 — Visibility and publication are separate questions

- **Status:** active
- **Source:** sean
- **Origin:** #158
- **Type:** constraint
- **Priority:** P0
- **Statement:** The system shall decide whether a viewer may read a brief from
  its visibility, its publication state and that viewer's relationship to it.
- **Rationale:** `visibility` is who may EVER see it; `published_at` is whether
  they can see it right now. Conflating them is what made "unpublish"
  ambiguous. The composed rule is: the owner always; otherwise published, and
  then `public` to anyone, `link` to anyone who reaches the URL, `private` to
  users on the invitee list. A viewer who may not see a brief gets the same
  answer as one asking for a brief that does not exist — a distinguishable
  response would confirm it is there, which is the whole thing a private brief
  is avoiding. Kept in a single function so no caller can assemble a slightly
  different version of the rule.
- **Verification:**
  - Test — `apps/inside/inside-be/src/tests/briefs.test.ts` › "a private brief is invisible to a signed-in stranger"
  - Test — `apps/inside/inside-be/src/tests/briefs.test.ts` › "an invitee sees a private brief; a designer may be invited"
  - Test — `apps/inside/inside-be/src/tests/briefs.test.ts` › "the owner always sees their own brief, published or not"
- **Relations:** none

## REQ-BRIEF-006 — The access rule lives in exactly one place

- **Status:** active
- **Source:** sean
- **Origin:** #158
- **Type:** constraint
- **Priority:** P1
- **Statement:** Every read of a brief by a viewer shall resolve its access
  through the same single function.
- **Rationale:** REQ-BRIEF-001 is four conditions composed. Any caller that
  reimplements even part of it will drift — and the drift is silent, because a
  slightly-too-permissive copy still returns a brief and looks like it worked.
  One function means a change to the rule is a change everywhere, and means
  there is one place to read when asking what the rule actually is.
- **Verification:** Analysis — `findVisibleBrief` in `apps/inside/inside-be/src/services/briefs.ts` is the only path from a slug to a brief for a non-owner; the controller passes the viewer to it and returns what it says.
- **Relations:** refines REQ-BRIEF-001

## REQ-BRIEF-002 — Only public briefs are ever listed

- **Status:** active
- **Source:** sean
- **Origin:** #158
- **Type:** constraint
- **Priority:** P0
- **Statement:** The system shall exclude any brief that is not both public and
  published from every listing, search result and count.
- **Rationale:** `link` and `private` mean unlisted before they mean anything
  else, and a leak into a listing is not recoverable — the brief has been seen.
  Enforced as two conditions in the base query rather than as a filter a
  parameter could displace, the same shape as the designer approval gate.
  A brief past its close date also drops off, because a board is a list of
  things you can answer and it takes no more bids.
- **Verification:**
  - Test — `apps/inside/inside-be/src/tests/briefs.test.ts` › "a link brief is readable by anyone but never listed"
  - Test — `apps/inside/inside-be/src/tests/briefs.test.ts` › "changing visibility takes a brief off the board without unpublishing it"
  - Test — `apps/inside/inside-be/src/tests/briefs.test.ts` › "closing a brief takes it off the board but leaves it published"
- **Relations:** depends-on REQ-BRIEF-001

## REQ-BRIEF-003 — Unpublishing hides a brief without forgetting who was invited

- **Status:** active
- **Source:** sean
- **Origin:** #158
- **Type:** constraint
- **Priority:** P1
- **Statement:** When a brief is unpublished, the system shall hide it from
  everyone but its owner while retaining its invitee list.
- **Rationale:** Publication is a switch a buyer flips while a job is on hold;
  the invitee list is a decision they made about people. Dropping the list on
  unpublish would silently require re-inviting everyone to resume, which is the
  behaviour this rules out — and it is why invitees live in their own table
  rather than as state on the brief. Hiding must apply to invitees too, or
  unpublish means nothing to the people most likely to be looking.
- **Verification:**
  - Test — `apps/inside/inside-be/src/tests/briefs.test.ts` › "unpublishing hides the brief and KEEPS the invitee list"
  - Test — `apps/inside/inside-be/src/tests/domain-schema.test.ts` › "an invitee list survives an unpublish"
- **Relations:** refines REQ-BRIEF-001

## REQ-BRIEF-004 — A brief is private until its author says otherwise

- **Status:** active
- **Source:** sean
- **Origin:** #158
- **Type:** constraint
- **Priority:** P0
- **Statement:** Where no visibility is given, the system shall create a brief
  as private and unpublished.
- **Rationale:** The default is the safe answer rather than the common one. A
  brief describes someone's home, budget and timing, and the cost of it being
  public by accident is not recoverable by making it private afterwards. A
  caller that forgets the field gets the harmless outcome; publishing is always
  something someone chose.
- **Verification:** Test — `apps/inside/inside-be/src/tests/briefs.test.ts` › "a brief is private and unpublished unless asked otherwise"
- **Relations:** refines REQ-BRIEF-001

## REQ-BRIEF-005 — `link` is unlisted, and is never described as private

- **Status:** active
- **Source:** sean
- **Origin:** #158
- **Type:** quality
- **Priority:** P1
- **Statement:** The interface shall describe `link` visibility as unlisted
  rather than as private, secret or restricted to people holding the link.
- **Rationale:** Brief slugs are derived from titles and are user-editable, so
  they are guessable by design (REQ-SLUG-001). That trade is deliberate — a
  buyer who chooses anything other than `private` is consenting to a reachable
  URL — but the consent is only real if the option is described accurately.
  "Only people with the link can see this" would be a guarantee the system does
  not provide, which is REQ-STATE-003 one layer up: presenting a guess as a
  fact. `private` is the only value that enforces anything.
- **Verification:** Inspection — the copy accompanying the visibility control, checked when the post-a-project UI lands in #162. No automated check exists; asserting on user-facing wording would need the UI this ticket does not build.
- **Relations:** refines REQ-BRIEF-001
