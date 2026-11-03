import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import { type Org, STAGES, today } from '../org';
import { renderPage, type Theme, themeOf } from '../render';
import { Field } from '../ui/Field';
import { Key } from '../ui/Key';
import { Led } from '../ui/Led';
import { Panel } from '../ui/Panel';

type DueOrg = Pick<
  Org,
  'slug' | 'name' | 'stage' | 'next_action' | 'next_action_on'
> & { next_action_on: string };

/**
 * The Today page: the "New lead" key, the organisations with a next action
 * due today or earlier (oldest first), and a form that sets the theme.
 */
export const TodayPage = ({
  date,
  due,
  theme,
}: {
  date: string;
  due: DueOrg[];
  theme: Theme;
}) => (
  <>
    <Panel label="Leads">
      <form method="get" action="/orgs/new">
        <Key>New lead</Key>
      </form>
      <p>
        <a href="/orgs">All organisations</a>
      </p>
    </Panel>
    <Panel label="Due">
      <p>
        {due.length === 0 ? 'Nothing is due' : `${due.length} due`} on or before{' '}
        <time dateTime={date}>{date}</time>.
      </p>
      {due.length > 0 && (
        <table>
          <thead>
            <tr>
              <th scope="col">Due</th>
              <th scope="col">Organisation</th>
              <th scope="col">Next action</th>
              <th scope="col">Stage</th>
            </tr>
          </thead>
          <tbody>
            {due.map((org) => (
              <tr key={org.slug}>
                <td>
                  <Led on={org.next_action_on < date}>
                    {org.next_action_on < date ? 'Overdue' : 'Today'}
                  </Led>
                  <br />
                  <time dateTime={org.next_action_on}>
                    {org.next_action_on}
                  </time>
                </td>
                <th scope="row">
                  <a href={`/${org.slug}`}>{org.name}</a>
                </th>
                <td>{org.next_action || 'None'}</td>
                <td>{STAGES[org.stage]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
    <Panel label="Display">
      <form method="get" action="/">
        <Field label="Theme">
          <select name="theme" defaultValue={theme}>
            <option value="pixel-3">Pixel-3</option>
            <option value="bare">Bare</option>
          </select>
        </Field>{' '}
        <Key>Apply</Key>
      </form>
    </Panel>
  </>
);

/** `GET /` */
export const todayRoute = (app: FastifyInstance, db: Database) => {
  app.get('/', { config: { admin: true } }, async (request, reply) => {
    const date = today();
    const due = db
      .query<DueOrg, [string]>(
        `SELECT slug, name, stage, next_action, next_action_on FROM organisation
         WHERE next_action_on IS NOT NULL AND next_action_on <= ?
         ORDER BY next_action_on, name COLLATE NOCASE;`,
      )
      .all(date);
    return reply
      .type('text/html; charset=utf-8')
      .send(
        renderPage(
          'Today',
          <TodayPage date={date} due={due} theme={themeOf(request)} />,
          request,
        ),
      );
  });
};
