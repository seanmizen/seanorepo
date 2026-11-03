import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import { type Auth, audit } from '../../auth';
import { findOrg, formText, isOutcome } from '../../org';
import { sendNotFound, sendOrgPage } from '../[slug]';

/**
 * `POST /<slug>/visits`. Log a visit: the `outcome` (from the key that the
 * person tapped) and an optional `note`. The outcome `do_not_knock` also sets
 * the stage to lost and clears the next action, so the organisation leaves
 * the Today page.
 */
export const orgVisitsRoute = (app: FastifyInstance, db: Database) => {
  app.post<{
    Params: { slug: string };
    Body: { outcome?: string; note?: string };
  }>('/:slug/visits', { config: { admin: true } }, async (request, reply) => {
    const org = findOrg(db, request.params.slug);
    if (!org) return sendNotFound(request, reply);
    const outcome = formText(request.body?.outcome);
    if (!isOutcome(outcome)) {
      return sendOrgPage(db, request, reply, org, 'Choose an outcome.');
    }
    const note = formText(request.body?.note) || null;
    const actor = (request.auth as Auth).personId;
    db.transaction(() => {
      const visitId = crypto.randomUUID();
      db.query(
        'INSERT INTO visit (id, organisation_id, outcome, note) VALUES (?, ?, ?, ?);',
      ).run(visitId, org.id, outcome, note);
      audit(db, actor, 'create', 'visit', visitId, {
        organisation_id: org.id,
        outcome,
      });
      if (outcome === 'do_not_knock') {
        db.query(
          `UPDATE organisation SET stage = 'lost', next_action = NULL, next_action_on = NULL,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?;`,
        ).run(org.id);
        audit(db, actor, 'update', 'organisation', org.id, {
          stage: 'lost',
          next_action_on: null,
        });
      }
    })();
    return reply.redirect(`/${org.slug}`, 303);
  });
};
