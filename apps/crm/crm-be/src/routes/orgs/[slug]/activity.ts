import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import { logActivity } from '../../../activity';
import type { Auth } from '../../../auth';
import { activityForm } from '../../../forms/activity';
import { parseForm } from '../../../forms/form';
import { findOrg, orgPath } from '../../../org';
import { sendNotFound, sendOrgPage } from '../[slug]';

/**
 * `POST /<slug>/activity`: the Log module. The key that the person tapped
 * sends the `outcome`, and the field sends the `note`. On an error, the
 * page marks the field with the problem and the key that the person tapped.
 *
 * `GET /<slug>/activity` opens the organisation page, which lists the
 * activity. The path title links it.
 */
export const orgActivityRoute = (app: FastifyInstance, db: Database) => {
  app.get<{ Params: { slug: string } }>(
    '/orgs/:slug/activity',
    { config: { admin: true } },
    async (request, reply) => {
      const org = findOrg(db, request.params.slug);
      if (!org) return sendNotFound(request, reply);
      return reply.redirect(orgPath(org.slug), 303);
    },
  );

  app.post<{ Params: { slug: string } }>(
    '/orgs/:slug/activity',
    { config: { admin: true } },
    async (request, reply) => {
      const org = findOrg(db, request.params.slug);
      if (!org) return sendNotFound(request, reply);
      const { values, error, problem } = parseForm(activityForm, request.body);
      if (error) {
        return sendOrgPage(db, request, reply, org, {
          problem: {
            text: error,
            part: 'log',
            field: problem,
            fixKey: values.outcome || undefined,
          },
        });
      }
      logActivity(db, (request.auth as Auth).personId, org, values);
      return reply.redirect(orgPath(org.slug), 303);
    },
  );
};
