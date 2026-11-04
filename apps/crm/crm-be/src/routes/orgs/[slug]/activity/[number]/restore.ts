import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import { findActivity, findHiddenActivity } from '../../../../../activity';
import type { Auth } from '../../../../../auth';
import { restore } from '../../../../../events';
import { findOrg, formText, parseNumber } from '../../../../../org';
import { activityBack, sendNotFound } from '../../../[slug]';

/**
 * `POST /orgs/<slug>/activity/<number>/restore`: the Restore button of a
 * hidden visit or note (REQ-CRM-UNDO-003). It shows the row that was
 * hidden last. When the entry shows already, the post changes nothing and
 * records nothing. A number that the organisation does not have gets 404.
 */
export const orgActivityRestoreRoute = (app: FastifyInstance, db: Database) => {
  app.post<{
    Params: { slug: string; number: string };
    Body: { hidden?: string };
  }>(
    '/orgs/:slug/activity/:number/restore',
    { config: { admin: true } },
    async (request, reply) => {
      const org = findOrg(db, request.params.slug);
      const number = parseNumber(request.params.number);
      if (!org || !number) return sendNotFound(request, reply);
      const entry = findHiddenActivity(db, org.id, number);
      if (entry) {
        restore(db, (request.auth as Auth).personId, org.id, {
          table: entry.kind,
          id: entry.id,
        });
      } else if (!findActivity(db, org.id, number)) {
        return sendNotFound(request, reply);
      }
      return reply.redirect(
        activityBack(org.slug, formText(request.body?.hidden) === '1', request),
        303,
      );
    },
  );
};
