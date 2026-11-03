import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import type { Auth } from '../../../auth';
import { findOrg, formText, isStage, orgPath, setPipeline } from '../../../org';
import { sendNotFound, sendOrgPage } from '../[slug]';

interface StageBody {
  stage?: string;
  next_action?: string;
  next_action_on?: string;
}

/**
 * `POST /<slug>/stage`. Set the stage, the next action and its date
 * (`setPipeline` in `org.ts`). An empty next action or date clears it. The
 * Stage module and the Next action module of `/<slug>` both post here. Each
 * one sends the values of the other module as they are.
 */
export const orgStageRoute = (app: FastifyInstance, db: Database) => {
  app.post<{ Params: { slug: string }; Body: StageBody }>(
    '/orgs/:slug/stage',
    { config: { admin: true } },
    async (request, reply) => {
      const org = findOrg(db, request.params.slug);
      if (!org) return sendNotFound(request, reply);
      const stage = formText(request.body?.stage);
      const nextAction = formText(request.body?.next_action) || null;
      const nextActionOn = formText(request.body?.next_action_on) || null;
      if (!isStage(stage)) {
        return sendOrgPage(db, request, reply, org, {
          error: 'Choose a stage.',
        });
      }
      if (nextActionOn && !/^\d{4}-\d{2}-\d{2}$/.test(nextActionOn)) {
        return sendOrgPage(db, request, reply, org, {
          error: 'The Due date is not valid.',
        });
      }
      db.transaction(() =>
        setPipeline(db, (request.auth as Auth).personId, org, {
          stage,
          next_action: nextAction,
          next_action_on: nextActionOn,
        }),
      )();
      return reply.redirect(orgPath(org.slug), 303);
    },
  );
};
