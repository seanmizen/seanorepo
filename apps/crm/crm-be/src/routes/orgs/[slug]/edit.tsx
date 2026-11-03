import type { Database } from 'bun:sqlite';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { type Auth, audit } from '../../../auth';
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
 * `GET` and `POST /<slug>/edit`. A save writes an audit row with the names
 * of the changed fields, then opens the organisation at its URL slug.
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
      const { values, error } = parseForm(organisationForm, request.body);
      if (error) return send(request, reply, { org, values, error });
      const slug = resolveSlug(db, values, org.id);
      if ('error' in slug) {
        return send(request, reply, { org, values, error: slug.error });
      }
      const next = { ...values, slug: slug.slug };
      const fields = changedFields(organisationForm, { ...org }, next);
      if (fields.length > 0) {
        db.transaction(() => {
          db.query(
            `UPDATE organisation SET ${ORG_COLUMNS.map((name) => `${name} = ?`).join(', ')},
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?;`,
          ).run(...orgColumnValues(next), org.id);
          audit(
            db,
            (request.auth as Auth).personId,
            'update',
            'organisation',
            org.id,
            { fields },
          );
        })();
      }
      return reply.redirect(orgPath(next.slug), 303);
    },
  );
};
