# REQ-CRM-MORPH — A press changes only its effect

When JavaScript runs, a press does not load the page again. The script sends
the same request with `fetch` and morphs the new HTML into the page, so the
focus and the scroll position stay. With no JavaScript, each form and link
loads the full page, as a plain HTML page does.

---

## REQ-CRM-MORPH-001 — A press updates the page in place, with focus and scroll kept

- **Status:** active
- **Source:** sean
- **Origin:** #1116, #1117
- **Type:** functional
- **Priority:** P2
- **Statement:** When JavaScript runs and a person submits a crm form or
  clicks an in-app link, the crm shall morph the response into the page
  in place, and keep the focused control and the scroll position.
- **Rationale:** Sean: "click a button and the only thing on screen which
  changes is the effect I expected". Design decision 4 of
  `apps/crm/docs/002-rack.md`. A full load resets the scroll, takes the
  focus away and makes the page jump. `crm-fe/src/morph.ts` holds the
  rules:
  - The script sends the request that the browser would send. idiomorph
    morphs the body of the response into the page, so a node that the
    response also has stays the same node.
  - A changed URL goes into history. A post that redirects to the same URL
    replaces the history entry. Back and Forward morph too, and go back to
    the scroll position of their entry.
  - When the morph removes the control that had the focus, the focus goes
    to the same control in the new page: the same id, or else the same
    name, value, form and first text.
  - A link to a different path goes to the top of the new page, or to the
    target of its `#hash`, as a full load does. The scroll position stays
    on the same path.
  - A redirect with no `#hash` keeps the hash of the request, as a full
    load does. So a form with `#next` in its action lands on #next: on a
    phone the window of the control unit moves to Next action
    (`crm-fe/src/window.ts`), and the page does not scroll.
  - On the same path, a text field that the person changed outside the
    submitted form keeps its text, and a `<details>` that the person
    opened stays open.
  - A full load happens for a different origin, a `target`, a `download`
    link, and a form or link with `data-reload`. The consent form of the
    OAuth flow has `data-reload`, because its post redirects to the app.
  - If the fetch fails, or the response is not a crm page, the browser
    sends the same request as a normal submit or load, so no press is
    lost.
  - With no JavaScript, and with `?theme=bare`, the page has no script,
    so each form and link loads the full page (REQ-CRM-BARE-001).
- **Verification:**
  - Test — `apps/crm/scripts/morph-test.mjs` › "ok: a Log press saves in place, with focus and scroll kept"
  - Test — `apps/crm/scripts/morph-test.mjs` › "ok: Call back lands on Next action in the phone window, and a tab moves the window, with no page jump"
  - Test — `apps/crm/crm-be/src/routes/index.test.ts` › "each key of the list is a plain form or link, and the search field has an id (REQ-CRM-MORPH-001)"
- **Relations:**
  - depends-on REQ-CRM-BARE-001
