import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import type { Auth } from '../../../auth';
import { undoOrRedo } from '../../../events';
import { findOrg, formText, parseNumber } from '../../../org';
import { activityBack, sendNotFound, sendOrgPage } from '../[slug]';

/**
 * The post of the Undo or the Redo key on the plate of the organisation page
 * (REQ-CRM-UNDO-002). `event` is the number of the event that the page
 * offered to reverse or apply. When the newest event is a different one
 * now, for example after a second tap, the post changes nothing.
 * `hidden=1` keeps the hidden records on view.
 *
 * Undo and Redo write the old values back. When another organisation or
 * person has one of those values now (a URL slug or an email address),
 * the database refuses it, and the page shows why.
 */
export const undoRedoRoute =
  (kind: 'undo' | 'redo') => (app: FastifyInstance, db: Database) => {
    app.post<{
      Params: { slug: string };
      Body: { event?: string; hidden?: string };
    }>(
      `/orgs/:slug/${kind}`,
      { config: { admin: true } },
      async (request, reply) => {
        const org = findOrg(db, request.params.slug);
        if (!org) return sendNotFound(request, reply);
        const expected = parseNumber(formText(request.body?.event)) ?? 0;
        try {
          undoOrRedo(
            db,
            (request.auth as Auth).personId,
            org.id,
            kind,
            expected,
          );
        } catch (error) {
          const taken =
            /UNIQUE constraint failed: (organisation\.slug|person\.email)/.exec(
              String(error),
            )?.[1];
          if (!taken) throw error;
          const label = kind === 'undo' ? 'Undo' : 'Redo';
          return sendOrgPage(db, request, reply, org, {
            problem: {
              part: 'undo',
              text:
                taken === 'person.email'
                  ? `${label} did not change anything. Another person has the email address.`
                  : `${label} did not change anything. Another organisation has the URL slug.`,
            },
          });
        }
        // An Undo or a Redo of a change to the details can change the slug.
        const slug =
          db
            .query<{ slug: string }, [string]>(
              'SELECT slug FROM organisation WHERE id = ?;',
            )
            .get(org.id)?.slug ?? org.slug;
        return reply.redirect(
          activityBack(slug, formText(request.body?.hidden) === '1'),
          303,
        );
      },
    );
  };

/** `POST /orgs/<slug>/undo`: the Undo key. */
export const orgUndoRoute = undoRedoRoute('undo');
