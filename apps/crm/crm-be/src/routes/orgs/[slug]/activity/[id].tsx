import type { Database } from 'bun:sqlite';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { type Activity, findActivity, saveActivity } from '../../../../activity';
import type { Auth } from '../../../../auth';
import { activityForm, LOG_KEYS, NOTE_ONLY } from '../../../../forms/activity';
import { parseForm } from '../../../../forms/form';
import { findOrg, type Org, orgPath } from '../../../../org';
import { type PageParts, renderPage } from '../../../../render';
import { Device } from '../../../../ui/Device';
import { Lcd } from '../../../../ui/Lcd';
import { RecordForm } from '../../../../ui/RecordForm';
import { When } from '../../../../ui/When';
import { sendNotFound } from '../../[slug]';

/** The value of the key that saved `activity`. */
const keyOf = (activity: Activity) => activity.outcome ?? NOTE_ONLY;

/**
 * The edit page of a visit or a note. The LCD shows when it was logged and
 * how it was saved. Under it is the Log module of the organisation page,
 * filled in: the text, and the LED of the key that saved it. Each key saves
 * again.
 */
export const activityEditPage = ({
  org,
  activity,
  error,
}: {
  org: Org;
  activity: Activity;
  error?: string;
}): PageParts => ({
  title: `Activity - ${org.name}`,
  device: (
    <Device>
      <Lcd
        alert={error}
        rows={[
          { label: 'Organisation', value: org.name },
          { label: 'Logged', value: <When value={activity.at} /> },
          { label: 'Saved as', value: LOG_KEYS[keyOf(activity)] },
        ]}
      />
      <form
        method="post"
        action={`${orgPath(org.slug)}/activity/${encodeURIComponent(activity.id)}`}
      >
        <RecordForm
          form={activityForm}
          values={{ note: activity.note ?? '', outcome: keyOf(activity) }}
        />
      </form>
    </Device>
  ),
});

const sendPage = (
  request: FastifyRequest,
  reply: FastifyReply,
  props: Parameters<typeof activityEditPage>[0],
) =>
  reply
    .code(props.error ? 400 : 200)
    .type('text/html; charset=utf-8')
    .send(renderPage(request, activityEditPage(props)));

/** `GET` and `POST /<slug>/activity/<id>`: edit a visit or a note. */
export const orgActivityEditRoute = (app: FastifyInstance, db: Database) => {
  const find = (params: { slug: string; id: string }) => {
    const org = findOrg(db, params.slug);
    const activity = org && findActivity(db, org.id, params.id);
    return org && activity ? { org, activity } : null;
  };

  app.get<{ Params: { slug: string; id: string } }>(
    '/orgs/:slug/activity/:id',
    { config: { admin: true } },
    async (request, reply) => {
      const found = find(request.params);
      if (!found) return sendNotFound(request, reply);
      return sendPage(request, reply, found);
    },
  );

  app.post<{ Params: { slug: string; id: string } }>(
    '/orgs/:slug/activity/:id',
    { config: { admin: true } },
    async (request, reply) => {
      const found = find(request.params);
      if (!found) return sendNotFound(request, reply);
      const { values, error } = parseForm(activityForm, request.body);
      if (error) return sendPage(request, reply, { ...found, error });
      saveActivity(
        db,
        (request.auth as Auth).personId,
        found.org,
        found.activity,
        values,
      );
      return reply.redirect(orgPath(found.org.slug), 303);
    },
  );
};
