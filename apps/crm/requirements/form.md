# REQ-CRM-FORM — One form for create and edit

Each record that a form makes can be opened again in the same form, filled
with its current values, and saved. The form to add a record and the form to
change it are one form.

---

## REQ-CRM-FORM-001 — The create page and the edit page show one form

- **Status:** active
- **Source:** sean
- **Origin:** #1066
- **Type:** constraint
- **Priority:** P1
- **Statement:** For each record type with a form (organisation, contact,
  visit or note), the crm shall render the create page and the edit page,
  and parse the post of each one, from one definition in
  `crm-be/src/forms/`, with the current values in the fields of the edit
  page.
- **Rationale:** Sean: "that 'new lead' form should ideally have parity with
  the 'edit lead' form. if not even the same exact form." When two pages
  list the fields of a record, the two lists drift: a field, a label or a
  check changes on one page and not on the other. One definition holds the
  fields, the labels, the placeholders and the checks of a record.
  `ui/RecordForm.tsx` renders any definition, and `parseForm` in
  `crm-be/src/forms/form.ts` reads any post. No other code lists the fields
  of a record. The stage and the next action are not record fields: the
  modules of the organisation page set them.
- **Verification:**
  - Test — `apps/crm/crm-be/src/forms/form.test.ts` › "the create page and the edit page of each record render the same fields from one definition, and the edit page shows the current values (REQ-CRM-FORM-001)"
  - Test — `apps/crm/crm-be/src/forms/form.test.ts` › "the create route and the edit route parse a post with the same definition (REQ-CRM-FORM-001)"
- **Relations:** none
