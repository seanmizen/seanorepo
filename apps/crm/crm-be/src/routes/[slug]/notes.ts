import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import { type Auth, audit } from '../../auth';
import { findOrg, formText } from '../../org';
import { sendNotFound, sendOrgPage } from '../[slug]';

/** `POST /<slug>/notes`. Add a note to the organisation. */
export const orgNotesRoute = (app: FastifyInstance, db: Database) => {
  app.post<{ Params: { slug: string }; Body: { body?: string } }>(
    '/:slug/notes',
    { config: { admin: true } },
    async (request, reply) => {
      const org = findOrg(db, request.params.slug);
      if (!org) return sendNotFound(request, reply);
      const body = formText(request.body?.body);
      if (!body) return sendOrgPage(db, request, reply, org, 'Type the note.');
      db.transaction(() => {
        const noteId = crypto.randomUUID();
        db.query(
          'INSERT INTO note (id, organisation_id, body) VALUES (?, ?, ?);',
        ).run(noteId, org.id, body);
        // The note text is relationship data, so the audit row does not copy it.
        audit(db, (request.auth as Auth).personId, 'create', 'note', noteId, {
          organisation_id: org.id,
        });
      })();
      return reply.redirect(`/${org.slug}`, 303);
    },
  );
};
