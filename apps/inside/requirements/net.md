# REQ-NET — How the app talks to its API

The transport layer, and what happens when it does not work.

Introduced in #214. `REQ-STATE-001..004` already said a surface must never
assert what it has not verified. This is the machinery that lets it comply.
Before this, the same fetch wrapper existed four times with three incompatible
error shapes, so most pages had no way to know what had actually gone wrong.

---

## REQ-NET-001 — One client for every request

- **Status:** active
- **Source:** sean
- **Origin:** #214
- **Type:** constraint
- **Priority:** P1
- **Statement:** Every request the frontend makes to the API shall go through a
  single shared client.
- **Rationale:** Four copies of the same wrapper produced three error shapes,
  two of which threw the status as unparsed text inside a debug string. The
  result was that exactly one page in the app could tell a 404 from a dead
  backend, and the others could not have been fixed individually — they had
  nothing to branch on. Cross-cutting request behaviour has no natural home in
  a client-rendered app, so it has to be given one deliberately or it is
  re-invented per call site.
- **Verification:** Analysis — `apps/inside/inside-fe/src/lib/http.ts` is the
  only module in `inside-fe/src` containing `fetch`. The one remaining
  `XMLHttpRequest` is the upload path, which exists because `fetch` cannot
  report upload progress.
- **Relations:** none

## REQ-NET-002 — Every request has a deadline

- **Status:** active
- **Source:** sean
- **Origin:** #214
- **Type:** constraint
- **Priority:** P1
- **Statement:** Every request shall fail within a bounded time if no response
  arrives.
- **Rationale:** `fetch` has no default timeout, so a hung backend left the
  query in a pending state forever. That is worse than an error: the retry
  never fired because the promise never settled, so there was no failure state
  to render at all, and the visitor was shown a skeleton indefinitely — the
  app asserting "still loading" about a request that was never coming back.
  The upload path gets a longer deadline because a 50MB photograph over mobile
  legitimately takes minutes, but bounded is the requirement, not the number.
- **Verification:** Test — `apps/inside/inside-fe/tests/e2e/netcode.spec.ts` › "becomes a failure the visitor can see, not a spinner forever"
- **Relations:** none

## REQ-NET-003 — Every request is identifiable afterwards

- **Status:** active
- **Source:** sean
- **Origin:** #214
- **Type:** functional
- **Priority:** P2
- **Statement:** Every response shall carry an identifier that also appears in
  the server log line for that request.
- **Rationale:** The alternative to correlation is telemetry, which was
  considered and rejected: a marketplace holding home addresses and budgets
  should not ship them to a third party by default. An id costs nothing, adds
  no dependency, and turns "it broke" into a line that can be found. It is
  also what makes REQ-NET-005 acceptable — the client can be told nothing
  about a failure precisely because the reference is enough to find everything
  about it.
- **Verification:**
  - Test — `apps/inside/inside-be/src/tests/http-errors.test.ts` › "an inbound id is honoured, so one trace spans the whole request"
  - Test — `apps/inside/inside-fe/tests/e2e/netcode.spec.ts` › "every API response carries an id the logs can be searched by"
- **Relations:** none

## REQ-NET-004 — The client's address is the client's address

- **Status:** active
- **Source:** sean
- **Origin:** #214
- **Type:** constraint
- **Priority:** P1
- **Statement:** The server shall resolve a request's originating address from
  the proxy headers set by the tunnel it sits behind.
- **Rationale:** Without `trustProxy` every request appears to come from
  cloudflared. On its own that is merely useless. As the input to the per-IP
  rate limits in #165 it is dangerous, because every visitor on earth lands in
  one bucket and is throttled collectively. A security control that appears to
  work is worse than an absent one, since nothing prompts anybody to look at
  it. Recorded here rather than in #165 because it is a property of the request
  pipeline, and #165 is a consumer of it.
- **Verification:** Inspection — `trustProxy: true` in `apps/inside/inside-be/src/index.ts`, against the ingress in `apps/cloudflared/config.yml`. No automated check exists. Proving it end-to-end needs a request through the real tunnel, which CI has no access to.
- **Relations:** none

## REQ-NET-005 — One error envelope

- **Status:** active
- **Source:** sean
- **Origin:** #214
- **Type:** constraint
- **Priority:** P0
- **Statement:** Every error response shall use the same envelope, whatever
  produced it.
- **Rationale:** There was no error handler at all, so anything unrecognised
  reached Fastify's default, which answers in a shape the app uses nowhere
  else. An unmatched route did the same. A client then has two error shapes to
  know about, and learns the second one exists by hitting a typo in production.
- **Verification:**
  - Test — `apps/inside/inside-be/src/tests/http-errors.test.ts` › "an unmatched route answers in the app shape, not Fastify’s"
  - Test — `apps/inside/inside-be/src/tests/http-errors.test.ts` › "a hand-written 404 carries the same envelope"
- **Relations:** none

## REQ-NET-008 — A 5xx says nothing about our internals

- **Status:** active
- **Source:** sean
- **Origin:** #214
- **Type:** constraint
- **Priority:** P0
- **Statement:** A 5xx response shall never carry the underlying exception's
  message.
- **Rationale:** Split out of REQ-NET-005 in #178, where it should have been in
  #214 — one requirement was carrying two obligations, which is the Singular
  characteristic ISO 29148 asks for and this file's own validator enforces.

  The messages in question are SQLite constraint text, `sharp` decode failures
  and filesystem paths: an attacker's map of the schema and the disk, handed
  over by any request that provokes an exception. A 4xx keeps its message
  because those are written by us for the caller to read. A 5xx was written by
  a library, about our internals, for us. Saying nothing is only acceptable
  because REQ-NET-003 gives the caller a reference that finds everything.
- **Verification:**
  - Test — `apps/inside/inside-be/src/tests/http-errors.test.ts` › "never returns its own message to the client"
  - Test — `apps/inside/inside-be/src/tests/http-errors.test.ts` › "a 4xx keeps its message — those are written for the caller"
- **Relations:** depends-on REQ-NET-003

## REQ-NET-006 — Retry what might work. Never retry an answer

- **Status:** active
- **Source:** sean
- **Origin:** #214
- **Type:** constraint
- **Priority:** P2
- **Statement:** A failed request shall be retried only where the failure is a
  server fault or an unreachable server.
- **Rationale:** Three judgements. A 4xx is an answer, and the previous blanket
  policy retried a 404 twice with backoff before admitting it — latency
  dressed as resilience. A timeout has already cost the visitor the full
  deadline once, so retrying twice means 45 seconds of skeleton instead of
  being told at 15. Failing fast and letting them choose to retry is the better
  trade. A network error fails instantly, so a second attempt costs nothing and
  genuinely rescues a blip.
- **Verification:** Analysis — `isRetryable` in `apps/inside/inside-fe/src/lib/http.ts`, consumed by the single `retry` predicate in `lib/query-client.ts`. The 15-second first-failure assertion in `netcode.spec.ts` › "becomes a failure the visitor can see" would take 45 seconds if timeouts were retried.
- **Relations:** depends-on REQ-NET-002

## REQ-NET-007 — A failure says what actually failed

- **Status:** active
- **Source:** sean
- **Origin:** #214
- **Type:** quality
- **Priority:** P1
- **Statement:** Where a request fails, the surface shall describe the kind of
  failure that occurred rather than assuming the resource is absent.
- **Rationale:** Every public read page rendered the same `severity="info"`
  line — "that studio is not listed" — for a 404, a 500, a dead tunnel and a
  dropped connection. Three of those four are the app stating something it has
  not verified, which is what `REQ-STATE-003` forbids. It was simply happening
  one layer up from where that requirement was being applied. Telling somebody
  a studio does not exist when the truth is that our server is down also sends
  them away permanently, which is the expensive version of the mistake.
- **Verification:**
  - Test — `apps/inside/inside-fe/tests/e2e/netcode.spec.ts` › "does not claim the studio is unlisted"
  - Test — `apps/inside/inside-fe/tests/e2e/netcode.spec.ts` › "an unreachable server reads as a connection problem"
  - Test — `apps/inside/inside-fe/tests/e2e/netcode.spec.ts` › "still says the studio is not listed"
  - Test — `apps/inside/inside-fe/tests/e2e/failure-surfaces.spec.ts` › "an action that cannot reach the server says so, not \"could not be saved\""
  - Test — `apps/inside/inside-fe/tests/e2e/failure-surfaces.spec.ts` › "a validation message the page raised itself is shown as written"
- **Relations:**
  - refines REQ-STATE-003
  - depends-on REQ-NET-001
