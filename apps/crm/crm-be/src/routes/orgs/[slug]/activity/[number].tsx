import type { Database } from 'bun:sqlite';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  type Activity,
  findActivity,
  saveActivity,
} from '../../../../activity';
import type { Auth } from '../../../../auth';
import { activityForm, NOTE_ONLY } from '../../../../forms/activity';
import {
  type FieldProblem,
  type FormValues,
  parseForm,
} from '../../../../forms/form';
import {
  activityPath,
  findOrg,
  type Org,
  OUTCOMES,
  orgPath,
  parseNumber,
} from '../../../../org';
import { type PageParts, renderPage } from '../../../../render';
import { ControlUnit } from '../../../../ui/ControlUnit';
import { DisplayUnit } from '../../../../ui/DisplayUnit';
import { Rack } from '../../../../ui/Rack';
import { RecordForm } from '../../../../ui/RecordForm';
import { When } from '../../../../ui/When';
import { orderSearch, parseOrder } from '../../../index';
import { orderBack, sendNotFound } from '../../[slug]';

/** The value of the key that saved `activity`. */
const keyOf = (activity: Activity) => activity.outcome ?? NOTE_ONLY;

/** The type of `activity`, as the glass shows it: `Note`, or `Visit, Spoke`. */
export const typeText = (activity: Activity) =>
  activity.outcome ? `Visit, ${OUTCOMES[activity.outcome]}` : 'Note';

/** The id of the form of the edit page. The Save key on the plate submits it. */
const FORM_ID = 'activity-edit';

/**
 * The edit page of a visit or a note, at its activity number
 * (REQ-CRM-ID-001). It is a rack, as the organisation page and its other
 * edit pages (REQ-CRM-LAYOUT-002):
 *
 * - The display unit. The glass reads the entry as it is saved: the
 *   organisation (the one large value) under the number of the entry,
 *   then when it was logged and its type (`Note`, or `Visit, Spoke`), and
 *   its text. An
 *   error is the first line of the glass. The plate keys are Save and
 *   Cancel. Save submits the form with the type that is lit, so it saves
 *   the text and keeps the type (REQ-CRM-BUTTON-001). Cancel goes back to
 *   the organisation, in its running order.
 * - The control unit holds the Log module of the organisation page,
 *   filled in (REQ-CRM-FORM-001): the text, and the LED of the key that
 *   saved it. Each key of the module saves again, with its own type. The
 *   field with the problem of the last post, and the key that fixes it,
 *   have a thick outline (`apps/crm/docs/002-rack.md`, detail 6).
 */
export const activityEditPage = ({
  org,
  activity,
  error,
  problem,
  fixKey,
  note,
  search = '',
}: {
  org: Org;
  activity: Activity;
  error?: string;
  problem?: FieldProblem;
  /** The text that the person typed, after an error. */
  note?: FormValues['note'];
  /** The value of the key that the person tapped, after an error. */
  fixKey?: string;
  /** The query string of the running order (`orderSearch`). */
  search?: string;
}): PageParts => {
  const name = `${activity.outcome ? 'Visit' : 'Note'} ${activity.number}`;
  return {
    title: `${name} - ${org.name}`,
    rack: (
      <Rack>
        <DisplayUnit
          alert={error ?? null}
          readings={[
            {
              label: name,
              kind: 'name',
              value: org.name,
              lines: [
                {
                  value: (
                    <>
                      <When value={activity.at} /> · {typeText(activity)}
                    </>
                  ),
                },
              ],
            },
            {
              label: 'Text',
              kind: 'wide',
              value: activity.note || 'No note',
            },
          ]}
          keys={[
            {
              id: 'save',
              label: 'Save',
              caption: name,
              formId: FORM_ID,
              name: 'outcome',
              value: keyOf(activity),
            },
            {
              id: 'cancel',
              label: 'Cancel',
              caption: 'Back to the org',
              href: `${orgPath(org.slug)}${search}`,
            },
          ]}
        />
        <ControlUnit>
          <form
            id={FORM_ID}
            method="post"
            action={`${activityPath(org.slug, activity.number)}${search}`}
          >
            <RecordForm
              form={activityForm}
              id="log"
              span={12}
              problem={problem}
              fixKey={fixKey}
              values={{
                note: note ?? activity.note ?? '',
                outcome: keyOf(activity),
              }}
            />
          </form>
        </ControlUnit>
      </Rack>
    ),
  };
};

const sendPage = (
  request: FastifyRequest,
  reply: FastifyReply,
  props: Parameters<typeof activityEditPage>[0],
) =>
  reply
    .code(props.error ? 400 : 200)
    .type('text/html; charset=utf-8')
    .send(
      renderPage(
        request,
        activityEditPage({
          ...props,
          search: orderSearch(parseOrder(request.query)),
        }),
      ),
    );

/**
 * `GET` and `POST /orgs/<slug>/activity/<number>`: edit a visit or a note.
 * A number that the organisation does not have, or a segment that is not
 * a number, gets 404.
 */
export const orgActivityEditRoute = (app: FastifyInstance, db: Database) => {
  const find = (params: { slug: string; number: string }) => {
    const org = findOrg(db, params.slug);
    const number = parseNumber(params.number);
    const activity = org && number && findActivity(db, org.id, number);
    return org && activity ? { org, activity } : null;
  };

  app.get<{ Params: { slug: string; number: string } }>(
    '/orgs/:slug/activity/:number',
    { config: { admin: true } },
    async (request, reply) => {
      const found = find(request.params);
      if (!found) return sendNotFound(request, reply);
      return sendPage(request, reply, found);
    },
  );

  app.post<{ Params: { slug: string; number: string } }>(
    '/orgs/:slug/activity/:number',
    { config: { admin: true } },
    async (request, reply) => {
      const found = find(request.params);
      if (!found) return sendNotFound(request, reply);
      const { values, error, problem } = parseForm(activityForm, request.body);
      if (error) {
        return sendPage(request, reply, {
          ...found,
          error,
          problem,
          fixKey: values.outcome || undefined,
          note: values.note,
        });
      }
      saveActivity(
        db,
        (request.auth as Auth).personId,
        found.org,
        found.activity,
        values,
      );
      return reply.redirect(orderBack(found.org.slug, request), 303);
    },
  );
};
