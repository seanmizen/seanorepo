import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import { logActivity } from '../../activity';
import type { Auth } from '../../auth';
import { insertContact } from '../../contacts';
import { writeEvent } from '../../events';
import { activityForm, LOG_KEYS } from '../../forms/activity';
import { contactForm } from '../../forms/contact';
import {
  type FieldProblem,
  type FormValues,
  isBlank,
  parseForm,
} from '../../forms/form';
import {
  ORG_COLUMNS,
  organisationForm,
  orgColumnValues,
} from '../../forms/organisation';
import { findOrg, formText, orgPath, resolveSlug } from '../../org';
import { type PageParts, renderPage } from '../../render';
import { ControlUnit, type WindowTab } from '../../ui/ControlUnit';
import { DisplayUnit } from '../../ui/DisplayUnit';
import { Rack } from '../../ui/Rack';
import { RecordForm } from '../../ui/RecordForm';

/** The prefix of the contact fields in the post of the new-lead form. */
const CONTACT = 'contact_';

/** The prefix of the visit fields in the post of the new-lead form. */
const VISIT = 'visit_';

/** The id of the new-lead form. Save lead on the plate submits it. */
const FORM_ID = 'new-lead';

/** The tabs of the phone window: one for each module, in order. */
const NEW_LEAD_TABS: WindowTab[] = [
  { id: 'organisation', label: 'Organisation' },
  { id: 'address', label: 'Address' },
  { id: 'first-contact', label: 'Contact' },
  { id: 'first-visit', label: 'Visit' },
];

/** The form of a new lead with the problem of the last post. */
export type LeadForm = 'org' | 'contact' | 'visit';

/**
 * The new-lead page (`apps/crm/docs/002-rack.md`): a rack, with no band.
 *
 * - The display unit. The glass reads what the save sets: the name (the
 *   one large value) and the address, the stage Lead, the source, the
 *   lawful basis, the first contact and the first visit. The first line
 *   is the error of the last post. The plate keys are Save lead (it
 *   submits the form) and Cancel (back to the address book).
 * - The control unit. One form with four modules side by side:
 *   Organisation and Address (the organisation form), First contact (the
 *   contact form) and First visit (the Log form, with each Save as visit
 *   key a choice and `None` on by default). Each form is the same as on
 *   its edit page (REQ-CRM-FORM-001).
 *
 * Save lead adds the organisation, its contact and its first visit in one
 * press. On an error, the form keeps the values that the person typed,
 * and the field with the problem has a thick outline and a word.
 * `org.name` can come from the search of the list (`?name=`).
 */
export const newOrgPage = ({
  org = {},
  contact = {},
  visit = {},
  error,
  problem,
}: {
  org?: FormValues;
  contact?: FormValues;
  visit?: FormValues;
  error?: string;
  problem?: { form: LeadForm; field?: FieldProblem };
} = {}): PageParts => {
  const marked = (form: LeadForm) =>
    problem?.form === form ? problem.field : undefined;
  const address = [org.address_line_1, org.address_line_2, org.postcode]
    .filter(Boolean)
    .join(', ');
  return {
    title: 'New lead',
    rack: (
      <Rack>
        <DisplayUnit
          alert={error ?? null}
          readings={[
            {
              label: 'New lead',
              kind: 'name',
              value: org.name || 'No name',
              lines: [{ value: address || 'No address' }],
            },
            { label: 'Stage', value: 'Lead' },
            { label: 'Source', value: org.source || 'None' },
            { label: 'Lawful basis', value: 'legitimate interests' },
            { label: 'First contact', value: contact.name || 'None' },
            {
              label: 'First visit',
              value: LOG_KEYS[visit.outcome ?? ''] ?? 'None',
            },
          ]}
          keys={[
            {
              id: 'save-lead',
              label: 'Save lead',
              caption: 'Stage Lead',
              formId: FORM_ID,
            },
            {
              id: 'cancel',
              label: 'Cancel',
              caption: 'Back to orgs',
              href: '/orgs',
            },
          ]}
        />
        <ControlUnit tabs={NEW_LEAD_TABS}>
          <form id={FORM_ID} method="post" action="/orgs/new">
            <RecordForm
              form={organisationForm}
              ids={['organisation', 'address']}
              values={org}
              span={3}
              problem={marked('org')}
            />
            <RecordForm
              form={contactForm}
              values={contact}
              prefix={CONTACT}
              id="first-contact"
              label="First contact"
              span={3}
              problem={marked('contact')}
            />
            <RecordForm
              form={activityForm}
              values={visit}
              prefix={VISIT}
              id="first-visit"
              label="First visit"
              span={3}
              problem={marked('visit')}
              choose
            />
          </form>
        </ControlUnit>
      </Rack>
    ),
  };
};

/**
 * Add the organisation at the stage Lead, and its contact if the person
 * typed one, in one transaction, as one `create` event. Undo cannot
 * reverse it: it is the first event of the organisation. The event has the
 * names of the fields with a value (`fields`, and `contact_fields` for the
 * contact). The demo seed (`demo-seed.ts`) also calls it.
 */
export const addOrg = (
  db: Database,
  actor: string,
  org: FormValues,
  contact: FormValues | null,
) =>
  db.transaction(() => {
    const id = crypto.randomUUID();
    db.query(
      `INSERT INTO organisation (id, ${ORG_COLUMNS.join(', ')}, stage, lawful_basis)
       VALUES (?, ${ORG_COLUMNS.map(() => '?').join(', ')}, 'lead', 'legitimate_interests');`,
    ).run(id, ...orgColumnValues(org));
    // A new organisation has no membership, so the contact has no error.
    const added = contact ? insertContact(db, id, contact) : null;
    writeEvent(db, actor, id, 'create', {
      stage: 'lead',
      fields: ORG_COLUMNS.filter((name) => org[name]),
      ...(added && 'person_id' in added
        ? {
            person_id: added.person_id,
            role: added.role,
            contact_fields: added.fields,
          }
        : {}),
    });
  })();

/**
 * Check a new lead, then add it (`addOrg`). `org` is the post of the
 * organisation form, and `contact` the post of the contact form, with its
 * field names after `prefix`. With no name, phone or email, the lead has no
 * contact yet. `visit` is the post of the First visit module, with its
 * field names after `visit.prefix`: with a Save as visit value or a note,
 * the first visit (or note) is logged in the same transaction, after the
 * `create` event, so Undo can reverse it. Returns the slug, or the error,
 * the form and the field with the problem, and the values to show again.
 * The route `POST /orgs/new` and the MCP tool `create_lead` call it.
 */
export const createLead = (
  db: Database,
  actor: string,
  org: unknown,
  contact: unknown,
  prefix = '',
  visit?: { post: unknown; prefix: string },
):
  | { slug: string }
  | {
      error: string;
      problem: { form: LeadForm; field?: FieldProblem };
      org: FormValues;
      contact: FormValues;
      visit: FormValues;
    } => {
  const orgForm = parseForm(organisationForm, org);
  const contactPost = parseForm(contactForm, contact, prefix);
  const visitPost = visit
    ? parseForm(activityForm, visit.post, visit.prefix)
    : undefined;
  const hasContact = !isBlank(contactForm, contactPost.values);
  const hasVisit =
    visitPost !== undefined && !isBlank(activityForm, visitPost.values);
  const values = {
    org: orgForm.values,
    contact: contactPost.values,
    visit: visitPost?.values ?? {},
  };
  const failed: [LeadForm, ReturnType<typeof parseForm>] | undefined =
    orgForm.error
      ? ['org', orgForm]
      : hasContact && contactPost.error
        ? ['contact', contactPost]
        : hasVisit && visitPost?.error
          ? ['visit', visitPost]
          : undefined;
  if (failed) {
    const [form, { error, problem }] = failed;
    return {
      error: String(error),
      problem: { form, field: problem },
      ...values,
    };
  }
  const slug = resolveSlug(db, orgForm.values);
  if ('error' in slug) {
    return {
      error: slug.error,
      problem: { form: 'org', field: { field: 'slug', word: 'in use' } },
      ...values,
    };
  }
  db.transaction(() => {
    addOrg(
      db,
      actor,
      { ...orgForm.values, slug: slug.slug },
      hasContact ? contactPost.values : null,
    );
    const added = findOrg(db, slug.slug);
    if (hasVisit && visitPost && added) {
      logActivity(db, actor, added, visitPost.values);
    }
  })();
  return slug;
};

/**
 * `GET /orgs/new` and `POST /orgs/new`. `?name=` fills the name: New lead
 * on the list carries the search text.
 */
export const orgsNewRoute = (app: FastifyInstance, db: Database) => {
  app.get<{ Querystring: { name?: string } }>(
    '/orgs/new',
    { config: { admin: true } },
    async (request, reply) => {
      const name = formText(request.query.name);
      return reply
        .type('text/html; charset=utf-8')
        .send(renderPage(request, newOrgPage(name ? { org: { name } } : {})));
    },
  );

  app.post('/orgs/new', { config: { admin: true } }, async (request, reply) => {
    const lead = createLead(
      db,
      (request.auth as Auth).personId,
      request.body,
      request.body,
      CONTACT,
      { post: request.body, prefix: VISIT },
    );
    if ('error' in lead) {
      return reply
        .code(400)
        .type('text/html; charset=utf-8')
        .send(renderPage(request, newOrgPage(lead)));
    }
    return reply.redirect(orgPath(lead.slug), 303);
  });
};
