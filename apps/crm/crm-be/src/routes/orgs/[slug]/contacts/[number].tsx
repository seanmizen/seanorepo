import type { Database } from 'bun:sqlite';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Auth } from '../../../../auth';
import { type Contact, findContact, saveContact } from '../../../../contacts';
import { contactForm } from '../../../../forms/contact';
import { type FormValues, parseForm } from '../../../../forms/form';
import {
  contactPath,
  findOrg,
  type Org,
  orgPath,
  parseNumber,
} from '../../../../org';
import { type PageParts, renderPage } from '../../../../render';
import { Device } from '../../../../ui/Device';
import { Key } from '../../../../ui/Key';
import { Lcd } from '../../../../ui/Lcd';
import { Module } from '../../../../ui/Module';
import { RecordForm } from '../../../../ui/RecordForm';
import { sendNotFound } from '../../[slug]';

/**
 * The edit page of a contact, at its contact number in the organisation
 * (REQ-CRM-ID-001): the contact form of the Add a contact module, filled
 * in, and one `Save` key. A person can be a contact of more
 * than one organisation. The intro names the others, because a change to
 * the name, the phone or the email shows there too.
 */
export const contactEditPage = ({
  org,
  contact,
  others,
  values,
  error,
}: {
  org: Org;
  contact: Contact;
  others: string[];
  values?: FormValues;
  error?: string;
}): PageParts => ({
  title: `${contact.name || 'Contact'} - ${org.name}`,
  intro:
    others.length > 0
      ? `This person is also a contact of ${others.join(', ')}. A change here shows there too.`
      : undefined,
  device: (
    <Device>
      <Lcd alert={error} />
      <form method="post" action={contactPath(org.slug, contact.number)}>
        <RecordForm
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
        <Module>
          <Key>Save</Key>
        </Module>
      </form>
    </Device>
  ),
});

/** The names of the other organisations of a person. */
const otherOrgs = (db: Database, personId: string, orgId: string) =>
  db
    .query<{ name: string }, [string, string]>(
      `SELECT organisation.name FROM membership
       JOIN organisation ON organisation.id = membership.organisation_id
       WHERE membership.person_id = ? AND membership.organisation_id != ?
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
    failed?: { values: FormValues; error: string },
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
      const { values, error } = parseForm(contactForm, request.body);
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
        return send(request, reply, org, contact, { values, error: failed });
      }
      return reply.redirect(orgPath(org.slug), 303);
    },
  );
};
