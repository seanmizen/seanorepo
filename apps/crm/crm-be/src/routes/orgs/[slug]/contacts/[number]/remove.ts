import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import type { Auth } from '../../../../../auth';
import { findContact, removeContact } from '../../../../../contacts';
import { findOrg, orgPath, parseNumber } from '../../../../../org';
import { sendNotFound } from '../../../[slug]';

/**
 * `POST /orgs/<slug>/contacts/<number>/remove`: the `Remove` button of a
 * contact (`removeContact` in `contacts.ts`). The number is not used again.
 */
export const orgContactRemoveRoute = (app: FastifyInstance, db: Database) => {
  app.post<{ Params: { slug: string; number: string } }>(
    '/orgs/:slug/contacts/:number/remove',
    { config: { admin: true } },
    async (request, reply) => {
      const org = findOrg(db, request.params.slug);
      const number = parseNumber(request.params.number);
      const contact = org && number && findContact(db, org.id, number);
      if (!org || !contact) return sendNotFound(request, reply);
      removeContact(db, (request.auth as Auth).personId, org.id, contact);
      return reply.redirect(orgPath(org.slug), 303);
    },
  );
};
