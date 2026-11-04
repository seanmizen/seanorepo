import type { Database } from 'bun:sqlite';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { type ActivityData, readActivity } from '../../../activity';
import type { Auth } from '../../../auth';
import { type Contact, listContacts } from '../../../contacts';
import { writeEvent } from '../../../events';
import {
  changedFields,
  type FieldProblem,
  type FormValues,
  parseForm,
} from '../../../forms/form';
import {
  ORG_COLUMNS,
  organisationForm,
  orgColumnValues,
} from '../../../forms/organisation';
import { findOrg, type Org, orgPath, resolveSlug } from '../../../org';
import { type PageParts, renderPage } from '../../../render';
import { ControlUnit } from '../../../ui/ControlUnit';
import { DisplayUnit } from '../../../ui/DisplayUnit';
import { Rack } from '../../../ui/Rack';
import { RecordForm } from '../../../ui/RecordForm';
import { orderSearch, parseOrder } from '../../index';
import { orderBack, orgReadings, sendNotFound } from '../[slug]';

/** The id of the form of the edit page. The Save key on the plate submits it. */
const FORM_ID = 'org-edit';

/**
 * The edit page of an organisation: the same rack as the organisation page
 * (its read-out in the glass, `orgReadings`), with the organisation form of
 * `/orgs/new` in the control unit, filled in (REQ-CRM-FORM-001). The plate
 * keys are Save (it submits the form) and Cancel (back to the
 * organisation). An error is the first line of the glass, and the field
 * with the problem has a thick outline and a word. The URL slug stays the
 * same unless the person changes it, and the intro says that old links
 * stop working then.
 */
export const orgEditPage = ({
  org,
  contacts,
  activity,
  values,
  error,
  problem,
  search = '',
}: {
  org: Org;
  contacts: Contact[];
  activity: ActivityData;
  values?: FormValues;
  error?: string;
  problem?: FieldProblem;
  /**
   * The query string of the running order of the organisation page
   * (`orderSearch`). The form posts with it, and Save and Cancel go back
   * to the organisation page in the same order.
   */
  search?: string;
}): PageParts => ({
  title: `Edit ${org.name}`,
  intro:
    'When the URL slug changes, old links to this organisation stop working.',
  rack: (
    <Rack>
      <DisplayUnit
        alert={error ?? null}
        readings={orgReadings({ org, contacts, activity })}
        keys={[
          { id: 'save', label: 'Save', caption: 'Details', formId: FORM_ID },
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
          action={`${orgPath(org.slug, 'edit')}${search}`}
        >
          <RecordForm
            form={organisationForm}
            problem={problem}
            values={
              values ?? {
                name: org.name,
                source: org.source ?? '',
                slug: org.slug,
                address_line_1: org.address_line_1 ?? '',
                address_line_2: org.address_line_2 ?? '',
                postcode: org.postcode ?? '',
              }
            }
          />
        </form>
      </ControlUnit>
    </Rack>
  ),
});

/**
 * Check the post of the organisation form, then save it over `org`, as one
 * `details` event with the names of the changed fields and their values
 * before and after. With no change, nothing is written. Returns the slug
 * and the changed fields, or the error, the field that it marks and the
 * values to show again. The route `POST /<slug>/edit` and the MCP tool
 * `update_organisation` call it.
 */
export const updateOrg = (
  db: Database,
  actor: string,
  org: Org,
  post: unknown,
):
  | { slug: string; fields: string[] }
  | { error: string; problem?: FieldProblem; values: FormValues } => {
  const { values, error, problem } = parseForm(organisationForm, post);
  if (error) return { error, problem, values };
  const slug = resolveSlug(db, values, org.id);
  if ('error' in slug) {
    return {
      error: slug.error,
      problem: { field: 'slug', word: 'in use' },
      values,
    };
  }
  const next = { ...values, slug: slug.slug };
  const fields = changedFields(organisationForm, { ...org }, next);
  if (fields.length > 0) {
    const after = orgColumnValues(next);
    const value = (name: string) => org[name as keyof Org] as string | null;
    db.transaction(() =>
      writeEvent(db, actor, org.id, 'details', {
        fields,
        changes: [
          {
            table: 'organisation',
            id: org.id,
            before: Object.fromEntries(
              fields.map((name) => [name, value(name)]),
            ),
            after: Object.fromEntries(
              fields.map((name) => [name, after[ORG_COLUMNS.indexOf(name)]]),
            ),
          },
        ],
      }),
    )();
  }
  return { slug: next.slug, fields };
};

/**
 * `GET` and `POST /<slug>/edit`. A save writes one `details` event with the
 * names of the changed fields and their values before and after
 * (`updateOrg`), then opens the organisation at its URL slug.
 */
export const orgEditRoute = (app: FastifyInstance, db: Database) => {
  const send = (
    request: FastifyRequest,
    reply: FastifyReply,
    props: Omit<
      Parameters<typeof orgEditPage>[0],
      'contacts' | 'activity' | 'search'
    >,
  ) =>
    reply
      .code(props.error ? 400 : 200)
      .type('text/html; charset=utf-8')
      .send(
        renderPage(
          request,
          orgEditPage({
            ...props,
            search: orderSearch(parseOrder(request.query)),
            contacts: listContacts(db, props.org.id),
            activity: readActivity(db, props.org.id),
          }),
        ),
      );

  app.get<{ Params: { slug: string } }>(
    '/orgs/:slug/edit',
    { config: { admin: true } },
    async (request, reply) => {
      const org = findOrg(db, request.params.slug);
      if (!org) return sendNotFound(request, reply);
      return send(request, reply, { org });
    },
  );

  app.post<{ Params: { slug: string } }>(
    '/orgs/:slug/edit',
    { config: { admin: true } },
    async (request, reply) => {
      const org = findOrg(db, request.params.slug);
      if (!org) return sendNotFound(request, reply);
      const saved = updateOrg(
        db,
        (request.auth as Auth).personId,
        org,
        request.body,
      );
      if ('error' in saved) return send(request, reply, { org, ...saved });
      return reply.redirect(orderBack(saved.slug, request), 303);
    },
  );
};
