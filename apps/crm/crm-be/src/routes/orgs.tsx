import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import { formText, isStage, type Org, STAGES, type Stage } from '../org';
import { renderPage } from '../render';
import { Field } from '../ui/Field';
import { Key } from '../ui/Key';
import { Panel } from '../ui/Panel';

type OrgRow = Pick<
  Org,
  'slug' | 'name' | 'postcode' | 'stage' | 'next_action_on'
>;

/**
 * All organisations, with a search form. The form is a GET form, so the URL
 * holds the search and a person can share it.
 */
export const OrgsPage = ({
  q,
  stage,
  orgs,
}: {
  q: string;
  stage: Stage | '';
  orgs: OrgRow[];
}) => (
  <>
    <Panel label="Search">
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
    </Panel>
    <Panel label="Organisations">
      <form method="get" action="/orgs/new">
        <Key>New lead</Key>
      </form>
      <p>
        {orgs.length === 1 ? '1 organisation' : `${orgs.length} organisations`}
        {!q && !stage
          ? '.'
          : orgs.length === 1
            ? ' matches the search.'
            : ' match the search.'}
      </p>
      {orgs.length > 0 && (
        <table>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Postcode</th>
              <th scope="col">Stage</th>
              <th scope="col">Next action on</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((org) => (
              <tr key={org.slug}>
                <th scope="row">
                  <a href={`/${org.slug}`}>{org.name}</a>
                </th>
                <td>{org.postcode || 'None'}</td>
                <td>{STAGES[org.stage]}</td>
                <td>
                  {org.next_action_on ? (
                    <time dateTime={org.next_action_on}>
                      {org.next_action_on}
                    </time>
                  ) : (
                    'None'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  </>
);

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
          renderPage(
            'Organisations',
            <OrgsPage q={q} stage={stage} orgs={searchOrgs(db, q, stage)} />,
            request,
          ),
        );
    },
  );
};
