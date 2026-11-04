import type { Database } from 'bun:sqlite';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Auth } from '../../../../auth';
import { type Contact, findContact, saveContact } from '../../../../contacts';
import { contactForm, ROLES } from '../../../../forms/contact';
import {
  type FieldProblem,
  type FormValues,
  parseForm,
} from '../../../../forms/form';
import {
  contactPath,
  findOrg,
  type Org,
  orgPath,
  parseNumber,
} from '../../../../org';
import { type PageParts, renderPage } from '../../../../render';
import { ControlUnit } from '../../../../ui/ControlUnit';
import { DisplayUnit } from '../../../../ui/DisplayUnit';
import { Rack } from '../../../../ui/Rack';
import { RecordForm } from '../../../../ui/RecordForm';
import { orderSearch, parseOrder } from '../../../index';
import { orderBack, sendNotFound } from '../../[slug]';

/** The id of the form of the edit page. The Save key on the plate submits it. */
const FORM_ID = 'contact-edit';

/**
 * The edit page of a contact, at its contact number in the organisation
 * (REQ-CRM-ID-001). It is a rack, as the organisation page: the glass reads
 * the contact as it is saved (the one large value is the name), and the
 * control unit holds the contact form of the Add contact row, filled in
 * (REQ-CRM-FORM-001). The plate keys are Save (it submits the form) and
 * Cancel (back to the organisation). An error is the first line of the
 * glass, and the field with the problem has a thick outline and a word.
 * A person can be a contact of more than one organisation. The intro names
 * the others, because a change to the name, the phone or the email shows
 * there too.
 */
export const contactEditPage = ({
  org,
  contact,
  others,
  values,
  error,
  problem,
  search = '',
}: {
  org: Org;
  contact: Contact;
  others: string[];
  values?: FormValues;
  error?: string;
  problem?: FieldProblem;
  /**
   * The query string of the running order of the organisation page
   * (`orderSearch`). The form posts with it, and Save and Cancel go back
   * to the organisation page in the same order.
   */
  search?: string;
}): PageParts => ({
  title: `${contact.name || 'Contact'} - ${org.name}`,
  intro:
    others.length > 0
      ? `This person is also a contact of ${others.join(', ')}. A change here shows there too.`
      : undefined,
  rack: (
    <Rack>
      <DisplayUnit
        alert={error ?? null}
        readings={[
          {
            label: `Contact ${contact.number}`,
            kind: 'name',
            value: contact.name || 'No name',
            lines: [{ value: org.name }],
          },
          {
            label: 'Role',
            value: ROLES[contact.role as keyof typeof ROLES] ?? contact.role,
          },
          { label: 'Phone', value: contact.phone || 'None' },
          { label: 'Email', value: contact.email || 'None' },
        ]}
        keys={[
          {
            id: 'save',
            label: 'Save',
            caption: `Contact ${contact.number}`,
            formId: FORM_ID,
          },
          {
            id: 'cancel',
            label: 'Cancel',
            caption: 'Back to the org',
            href: `${orgPath(org.slug)}${search}`,
          },
        ]}
      />
      <ControlUnit>
        <form
          id={FORM_ID}
          method="post"
          action={`${contactPath(org.slug, contact.number)}${search}`}
        >
          <RecordForm
            span={12}
            problem={problem}
            form={contactForm}
            values={
              values ?? {
                name: contact.name,
                phone: contact.phone ?? '',
                email: contact.email ?? '',
                role: contact.role,
              }
            }
          />
        </form>
      </ControlUnit>
    </Rack>
  ),
});

/** The names of the other organisations of a person. */
const otherOrgs = (db: Database, personId: string, orgId: string) =>
  db
    .query<{ name: string }, [string, string]>(
      `SELECT organisation.name FROM membership
       JOIN organisation ON organisation.id = membership.organisation_id
       WHERE membership.person_id = ? AND membership.organisation_id != ?
         AND membership.hidden_at IS NULL
       ORDER BY organisation.name;`,
    )
    .all(personId, orgId)
    .map((row) => row.name);

/**
 * `GET` and `POST /orgs/<slug>/contacts/<number>`: edit a contact. A number
 * that the organisation does not have, or a segment that is not a number,
 * gets 404.
 */
export const orgContactEditRoute = (app: FastifyInstance, db: Database) => {
  const send = (
    request: FastifyRequest,
    reply: FastifyReply,
    org: Org,
    contact: Contact,
    failed?: { values: FormValues; error: string; problem?: FieldProblem },
  ) =>
    reply
      .code(failed ? 400 : 200)
      .type('text/html; charset=utf-8')
      .send(
        renderPage(
          request,
          contactEditPage({
            org,
            contact,
            others: otherOrgs(db, contact.id, org.id),
            search: orderSearch(parseOrder(request.query)),
            ...failed,
          }),
        ),
      );

  const find = (params: { slug: string; number: string }) => {
    const org = findOrg(db, params.slug);
    const number = parseNumber(params.number);
    const contact = org && number && findContact(db, org.id, number);
    return org && contact ? { org, contact } : null;
  };

  app.get<{ Params: { slug: string; number: string } }>(
    '/orgs/:slug/contacts/:number',
    { config: { admin: true } },
    async (request, reply) => {
      const found = find(request.params);
      if (!found) return sendNotFound(request, reply);
      return send(request, reply, found.org, found.contact);
    },
  );

  app.post<{ Params: { slug: string; number: string } }>(
    '/orgs/:slug/contacts/:number',
    { config: { admin: true } },
    async (request, reply) => {
      const found = find(request.params);
      if (!found) return sendNotFound(request, reply);
      const { org, contact } = found;
      const { values, error, problem } = parseForm(contactForm, request.body);
      const failed =
        error ??
        saveContact(
          db,
          (request.auth as Auth).personId,
          org.id,
          contact,
          values,
        );
      if (failed) {
        return send(request, reply, org, contact, {
          values,
          error: failed,
          // An error of saveContact is about the email address.
          problem: problem ?? { field: 'email', word: 'in use' },
        });
      }
      return reply.redirect(orderBack(org.slug, request), 303);
    },
  );
};
