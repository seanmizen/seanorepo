import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import type { Auth } from '../../../auth';
import { addContact } from '../../../contacts';
import { contactForm } from '../../../forms/contact';
import { parseForm } from '../../../forms/form';
import { findOrg, orgPath } from '../../../org';
import { sendNotFound, sendOrgPage } from '../[slug]';

/**
 * `POST /<slug>/contacts`: the Add a contact module. On an error, the
 * page shows the message in the LCD, and the module keeps the values.
 *
 * `GET /<slug>/contacts` opens the organisation page, which lists the
 * contacts. The path title links it.
 */
export const orgContactsRoute = (app: FastifyInstance, db: Database) => {
  app.get<{ Params: { slug: string } }>(
    '/orgs/:slug/contacts',
    { config: { admin: true } },
    async (request, reply) => {
      const org = findOrg(db, request.params.slug);
      if (!org) return sendNotFound(request, reply);
      return reply.redirect(orgPath(org.slug), 303);
    },
  );

  app.post<{ Params: { slug: string } }>(
    '/orgs/:slug/contacts',
    { config: { admin: true } },
    async (request, reply) => {
      const org = findOrg(db, request.params.slug);
      if (!org) return sendNotFound(request, reply);
      const { values, error } = parseForm(contactForm, request.body);
      const failed =
        error ??
        db.transaction(() =>
          addContact(db, (request.auth as Auth).personId, org.id, values),
        )();
      if (failed) {
        return sendOrgPage(db, request, reply, org, {
          error: failed,
          contact: values,
        });
      }
      return reply.redirect(orgPath(org.slug), 303);
    },
  );
};
