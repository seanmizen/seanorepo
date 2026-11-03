import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import type { Auth } from '../../../auth';
import { findOrg, orgPath, parsePipeline, setPipeline } from '../../../org';
import { sendNotFound, sendOrgPage } from '../[slug]';

/**
 * `POST /<slug>/stage`. Set the stage, the next action and its date
 * (`parsePipeline` and `setPipeline` in `org.ts`). An empty next action or
 * date clears it. The Stage module and the Next action module of `/<slug>`
 * both post here. Each one sends the values of the other module as they
 * are.
 */
export const orgStageRoute = (app: FastifyInstance, db: Database) => {
  app.post<{ Params: { slug: string } }>(
    '/orgs/:slug/stage',
    { config: { admin: true } },
    async (request, reply) => {
      const org = findOrg(db, request.params.slug);
      if (!org) return sendNotFound(request, reply);
      const parsed = parsePipeline(request.body);
      if ('error' in parsed) {
        return sendOrgPage(db, request, reply, org, { error: parsed.error });
      }
      db.transaction(() =>
        setPipeline(db, (request.auth as Auth).personId, org, parsed.pipeline),
      )();
      return reply.redirect(orgPath(org.slug), 303);
    },
  );
};
