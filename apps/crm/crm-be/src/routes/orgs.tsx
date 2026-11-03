import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import { formText, isStage, type Org, STAGES, type Stage } from '../org';
import { type PageParts, renderPage } from '../render';
import { Device } from '../ui/Device';
import { Field } from '../ui/Field';
import { Key } from '../ui/Key';
import { Lcd } from '../ui/Lcd';
import { Module } from '../ui/Module';
import { When } from '../ui/When';

type OrgRow = Pick<
  Org,
  'slug' | 'name' | 'postcode' | 'stage' | 'next_action_on'
>;

/**
 * All organisations. The LCD shows the count, then the results as a menu:
 * each row is a link to the organisation. The search module under it is a
 * GET form, so the URL holds the search and a person can share it.
 */
export const orgsPage = (
  q: string,
  stage: Stage | '',
  orgs: OrgRow[],
): PageParts => ({
  title: 'Organisations',
  intro:
    'Search the organisations by name or postcode, or filter them by stage.',
  device: (
    <Device>
      <Lcd
        rows={[
          {
            label: q || stage ? 'Matches' : 'Organisations',
            value: String(orgs.length),
          },
        ]}
        menu={{
          legend: ['Organisation', 'Next action'],
          empty: q || stage ? 'No organisation matches.' : 'No organisations.',
          items: orgs.map((org) => ({
            href: `/${org.slug}`,
            name: org.name,
            value: org.next_action_on ? (
              <When value={org.next_action_on} />
            ) : undefined,
            detail: [org.postcode, STAGES[org.stage]]
              .filter(Boolean)
              .join(' · '),
          })),
        }}
      />
      <Module label="Search">
        <form method="get" action="/orgs">
          <Field label="Name or postcode">
            <input name="q" type="search" defaultValue={q} />
          </Field>
          <Field label="Stage">
            <select name="stage" defaultValue={stage}>
              <option value="">All stages</option>
              {Object.entries(STAGES).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </Field>
          <Key>Search</Key>
        </form>
      </Module>
    </Device>
  ),
});

/** `%` and `_` in the search text match only themselves. */
const likeText = (text: string) => text.replace(/[\\%_]/g, '\\$&');

/**
 * The organisations whose name or postcode holds `q`, in the stage `stage`.
 * An empty `q` or `stage` does not filter. The postcode match ignores case
 * and spaces, so `sw1a1aa` finds `SW1A 1AA`.
 */
const searchOrgs = (db: Database, q: string, stage: Stage | '') => {
  const name = `%${likeText(q)}%`;
  const postcode = `%${likeText(q.toUpperCase().replace(/\s+/g, ''))}%`;
  return db
    .query<OrgRow, [string, string, string, string, string]>(
      `SELECT slug, name, postcode, stage, next_action_on FROM organisation
       WHERE (? = '' OR name LIKE ? ESCAPE '\\'
              OR replace(upper(coalesce(postcode, '')), ' ', '') LIKE ? ESCAPE '\\')
         AND (? = '' OR stage = ?)
       ORDER BY name COLLATE NOCASE;`,
    )
    .all(q, name, postcode, stage, stage);
};

/** `GET /orgs?q=<text>&stage=<stage>` */
export const orgsRoute = (app: FastifyInstance, db: Database) => {
  app.get<{ Querystring: { q?: string; stage?: string } }>(
    '/orgs',
    { config: { admin: true } },
    async (request, reply) => {
      const q = formText(request.query.q);
      const stageText = formText(request.query.stage);
      const stage = isStage(stageText) ? stageText : '';
      return reply
        .type('text/html; charset=utf-8')
        .send(
          renderPage(request, orgsPage(q, stage, searchOrgs(db, q, stage))),
        );
    },
  );
};
