import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import { type Auth, audit } from '../../auth';
import { findOrg, formText, isStage } from '../../org';
import { sendNotFound, sendOrgPage } from '../[slug]';

interface StageBody {
  stage?: string;
  next_action?: string;
  next_action_on?: string;
}

/**
 * `POST /<slug>/stage`. Set the stage, the next action and its date. An empty
 * next action or date clears it.
 */
export const orgStageRoute = (app: FastifyInstance, db: Database) => {
  app.post<{ Params: { slug: string }; Body: StageBody }>(
    '/:slug/stage',
    { config: { admin: true } },
    async (request, reply) => {
      const org = findOrg(db, request.params.slug);
      if (!org) return sendNotFound(request, reply);
      const stage = formText(request.body?.stage);
      const nextAction = formText(request.body?.next_action) || null;
      const nextActionOn = formText(request.body?.next_action_on) || null;
      if (!isStage(stage)) {
        return sendOrgPage(db, request, reply, org, 'Choose a stage.');
      }
      if (nextActionOn && !/^\d{4}-\d{2}-\d{2}$/.test(nextActionOn)) {
        return sendOrgPage(
          db,
          request,
          reply,
          org,
          'The next action date must be YYYY-MM-DD.',
        );
      }
      db.transaction(() => {
        db.query(
          `UPDATE organisation SET stage = ?, next_action = ?, next_action_on = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ?;`,
        ).run(stage, nextAction, nextActionOn, org.id);
        audit(
          db,
          (request.auth as Auth).personId,
          'update',
          'organisation',
          org.id,
          {
            stage,
            next_action_on: nextActionOn,
          },
        );
      })();
      return reply.redirect(`/${org.slug}`, 303);
    },
  );
};
