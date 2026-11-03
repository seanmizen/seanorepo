import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import { type Auth, audit } from '../../auth';
import { addContact } from '../../contacts';
import { contactForm } from '../../forms/contact';
import { type FormValues, isBlank, parseForm } from '../../forms/form';
import {
  ORG_COLUMNS,
  organisationForm,
  orgColumnValues,
} from '../../forms/organisation';
import { orgPath, resolveSlug } from '../../org';
import { type PageParts, renderPage } from '../../render';
import { Device } from '../../ui/Device';
import { Key } from '../../ui/Key';
import { Lcd } from '../../ui/Lcd';
import { Module } from '../../ui/Module';
import { RecordForm } from '../../ui/RecordForm';

/** The prefix of the contact fields in the post of the new-lead form. */
const CONTACT = 'contact_';

/**
 * The new-lead page. The device is one form: the organisation form (the
 * Organisation and Address modules), then the contact form (the First
 * contact module), then the `Save` key. Each form is the same as on its
 * edit page (REQ-CRM-FORM-001). On an error, the LCD shows the message,
 * and the form keeps the values that the person typed.
 */
export const newOrgPage = ({
  org,
  contact,
  error,
}: {
  org?: FormValues;
  contact?: FormValues;
  error?: string;
} = {}): PageParts => ({
  title: 'New lead',
  intro: 'Add an organisation and its first contact, at the stage Lead.',
  device: (
    <Device>
      <Lcd alert={error} />
      <form method="post" action="/orgs/new">
        <RecordForm form={organisationForm} values={org} />
        <RecordForm
          form={contactForm}
          values={contact}
          prefix={CONTACT}
          label="First contact"
        />
        <Module>
          <Key>Save</Key>
        </Module>
      </form>
    </Device>
  ),
});

/**
 * Add the organisation at the stage Lead, and its contact if the person
 * typed one, in one transaction, with an audit row for each. The audit row
 * of the organisation has the names of the fields with a value. The demo
 * seed (`demo-seed.ts`) also calls it.
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
    audit(db, actor, 'create', 'organisation', id, {
      stage: 'lead',
      fields: ORG_COLUMNS.filter((name) => org[name]),
    });
    if (contact) addContact(db, actor, id, contact);
  })();

/**
 * Check a new lead, then add it (`addOrg`). `org` is the post of the
 * organisation form, and `contact` the post of the contact form, with its
 * field names after `prefix`. With no name, phone or email, the lead has no
 * contact yet. Returns the slug, or the error and the values to show again.
 * The route `POST /orgs/new` and the MCP tool `create_lead` call it.
 */
export const createLead = (
  db: Database,
  actor: string,
  org: unknown,
  contact: unknown,
  prefix = '',
):
  | { slug: string }
  | { error: string; org: FormValues; contact: FormValues } => {
  const orgForm = parseForm(organisationForm, org);
  const contactPost = parseForm(contactForm, contact, prefix);
  const hasContact = !isBlank(contactForm, contactPost.values);
  const error = orgForm.error ?? (hasContact ? contactPost.error : undefined);
  const slug = error ? { error } : resolveSlug(db, orgForm.values);
  if ('error' in slug) {
    return {
      error: slug.error,
      org: orgForm.values,
      contact: contactPost.values,
    };
  }
  addOrg(
    db,
    actor,
    { ...orgForm.values, slug: slug.slug },
    hasContact ? contactPost.values : null,
  );
  return slug;
};

/** `GET /orgs/new` and `POST /orgs/new` */
export const orgsNewRoute = (app: FastifyInstance, db: Database) => {
  app.get('/orgs/new', { config: { admin: true } }, async (request, reply) =>
    reply
      .type('text/html; charset=utf-8')
      .send(renderPage(request, newOrgPage())),
  );

  app.post('/orgs/new', { config: { admin: true } }, async (request, reply) => {
    const lead = createLead(
      db,
      (request.auth as Auth).personId,
      request.body,
      request.body,
      CONTACT,
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
