import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import type { Auth } from '../../../../../auth';
import { findContact, removeContact } from '../../../../../contacts';
import { findOrg, orgPath } from '../../../../../org';
import { sendNotFound } from '../../../[slug]';

/**
 * `POST /<slug>/contacts/<person-id>/remove`: the `Remove` button of a
 * contact (`removeContact` in `contacts.ts`).
 */
export const orgContactRemoveRoute = (app: FastifyInstance, db: Database) => {
  app.post<{ Params: { slug: string; id: string } }>(
    '/orgs/:slug/contacts/:id/remove',
    { config: { admin: true } },
    async (request, reply) => {
      const org = findOrg(db, request.params.slug);
      const contact = org && findContact(db, org.id, request.params.id);
      if (!org || !contact) return sendNotFound(request, reply);
      removeContact(db, (request.auth as Auth).personId, org.id, contact);
      return reply.redirect(orgPath(org.slug), 303);
    },
  );
};
