import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import type { Auth } from '../../../../../auth';
import { findContact, findHiddenContact } from '../../../../../contacts';
import { restore } from '../../../../../events';
import { findOrg, formText, parseNumber } from '../../../../../org';
import { activityBack, sendNotFound } from '../../../[slug]';

/**
 * `POST /orgs/<slug>/contacts/<number>/restore`: the Restore button of a
 * removed contact (REQ-CRM-UNDO-003). When the contact shows already, the
 * post changes nothing and records nothing. A number that the organisation
 * does not have gets 404.
 */
export const orgContactRestoreRoute = (app: FastifyInstance, db: Database) => {
  app.post<{
    Params: { slug: string; number: string };
    Body: { hidden?: string };
  }>(
    '/orgs/:slug/contacts/:number/restore',
    { config: { admin: true } },
    async (request, reply) => {
      const org = findOrg(db, request.params.slug);
      const number = parseNumber(request.params.number);
      if (!org || !number) return sendNotFound(request, reply);
      const contact = findHiddenContact(db, org.id, number);
      if (contact) {
        restore(db, (request.auth as Auth).personId, org.id, {
          table: 'membership',
          id: contact.id,
        });
      } else if (!findContact(db, org.id, number)) {
        return sendNotFound(request, reply);
      }
      return reply.redirect(
        activityBack(org.slug, formText(request.body?.hidden) === '1'),
        303,
      );
    },
  );
};
