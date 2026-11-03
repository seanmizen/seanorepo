import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import { dueWords, today } from '../dates';
import type { Org } from '../org';
import { type PageParts, renderPage } from '../render';
import { Device } from '../ui/Device';
import { Key } from '../ui/Key';
import { Lcd } from '../ui/Lcd';
import { Module } from '../ui/Module';
import { When } from '../ui/When';

type DueOrg = Pick<Org, 'slug' | 'name' | 'next_action' | 'next_action_on'> & {
  next_action_on: string;
};

/**
 * The Today page. The LCD shows the counts, then the organisations with a
 * next action due today or earlier (oldest first) as a menu. Each row is a
 * link to its organisation, and an overdue row has its LED lit. The device
 * has the "New lead" key.
 */
export const todayPage = (date: string, due: DueOrg[]): PageParts => {
  const overdue = due.filter((org) => org.next_action_on < date).length;
  return {
    title: 'Today',
    intro:
      'The organisations with a next action due today or earlier, oldest first.',
    device: (
      <Device>
        <Lcd
          rows={[
            { label: 'Today', value: <When value={date} /> },
            { label: 'Due', value: String(due.length) },
            { label: 'Overdue', value: String(overdue), led: overdue > 0 },
          ]}
          menu={{
            legend: ['Organisation', 'Due'],
            empty: 'Nothing is due.',
            items: due.map((org) => ({
              href: `/${org.slug}`,
              name: org.name,
              value: <When value={org.next_action_on} />,
              detail: org.next_action || 'No next action',
              status: dueWords(org.next_action_on),
              led: org.next_action_on < date,
            })),
          }}
        />
        <Module label="Leads">
          <form method="get" action="/orgs/new">
            <Key>New lead</Key>
          </form>
        </Module>
      </Device>
    ),
  };
};

/** `GET /` */
export const todayRoute = (app: FastifyInstance, db: Database) => {
  app.get('/', { config: { admin: true } }, async (request, reply) => {
    const date = today();
    const due = db
      .query<DueOrg, [string]>(
        `SELECT slug, name, next_action, next_action_on FROM organisation
         WHERE next_action_on IS NOT NULL AND next_action_on <= ?
         ORDER BY next_action_on, name COLLATE NOCASE;`,
      )
      .all(date);
    return reply
      .type('text/html; charset=utf-8')
      .send(renderPage(request, todayPage(date, due)));
  });
};
