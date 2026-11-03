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
 * typed one, in one transaction, with an audit row for each. Returns the
 * slug.
 */
const addOrg = (
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
    audit(db, actor, 'create', 'organisation', id, { stage: 'lead' });
    if (contact) addContact(db, actor, id, contact);
  })();

/** `GET /orgs/new` and `POST /orgs/new` */
export const orgsNewRoute = (app: FastifyInstance, db: Database) => {
  app.get('/orgs/new', { config: { admin: true } }, async (request, reply) =>
    reply
      .type('text/html; charset=utf-8')
      .send(renderPage(request, newOrgPage())),
  );

  app.post('/orgs/new', { config: { admin: true } }, async (request, reply) => {
    const org = parseForm(organisationForm, request.body);
    const contact = parseForm(contactForm, request.body, CONTACT);
    // With no name, phone or email, the lead has no contact yet.
    const hasContact = !isBlank(contactForm, contact.values);
    const error = org.error ?? (hasContact ? contact.error : undefined);
    const slug = error ? { error } : resolveSlug(db, org.values);
    if ('error' in slug) {
      return reply
        .code(400)
        .type('text/html; charset=utf-8')
        .send(
          renderPage(
            request,
            newOrgPage({
              org: org.values,
              contact: contact.values,
              error: slug.error,
            }),
          ),
        );
    }
    addOrg(
      db,
      (request.auth as Auth).personId,
      { ...org.values, slug: slug.slug },
      hasContact ? contact.values : null,
    );
    return reply.redirect(orgPath(slug.slug), 303);
  });
};
