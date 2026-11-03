import type { Database } from 'bun:sqlite';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Auth } from '../../../auth';
import { writeEvent } from '../../../events';
import { changedFields, type FormValues, parseForm } from '../../../forms/form';
import {
  ORG_COLUMNS,
  organisationForm,
  orgColumnValues,
} from '../../../forms/organisation';
import { findOrg, type Org, orgPath, resolveSlug } from '../../../org';
import { type PageParts, renderPage } from '../../../render';
import { Device } from '../../../ui/Device';
import { Key } from '../../../ui/Key';
import { Lcd } from '../../../ui/Lcd';
import { Module } from '../../../ui/Module';
import { RecordForm } from '../../../ui/RecordForm';
import { sendNotFound } from '../[slug]';

/**
 * The edit page of an organisation: the organisation form of `/orgs/new`,
 * filled in, and one `Save` key. The URL slug stays the same unless the
 * person changes it, and the intro says that old links stop working then.
 */
export const orgEditPage = ({
  org,
  values,
  error,
}: {
  org: Org;
  values?: FormValues;
  error?: string;
}): PageParts => ({
  title: `Edit ${org.name}`,
  intro:
    'When the URL slug changes, old links to this organisation stop working.',
  device: (
    <Device>
      <Lcd alert={error} />
      <form method="post" action={orgPath(org.slug, 'edit')}>
        <RecordForm
          form={organisationForm}
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
        <Module>
          <Key>Save</Key>
        </Module>
      </form>
    </Device>
  ),
});

/**
 * Check the post of the organisation form, then save it over `org`, as one
 * `details` event with the names of the changed fields and their values
 * before and after. With no change, nothing is written. Returns the slug and the changed fields, or the error and the
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
  | { error: string; values: FormValues } => {
  const { values, error } = parseForm(organisationForm, post);
  if (error) return { error, values };
  const slug = resolveSlug(db, values, org.id);
  if ('error' in slug) return { error: slug.error, values };
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
    props: Parameters<typeof orgEditPage>[0],
  ) =>
    reply
      .code(props.error ? 400 : 200)
      .type('text/html; charset=utf-8')
      .send(renderPage(request, orgEditPage(props)));

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
      return reply.redirect(orgPath(saved.slug), 303);
    },
  );
};
