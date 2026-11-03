import type { Database } from 'bun:sqlite';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { dueWords, today } from '../dates';
import { findOrg, type Org, OUTCOMES, type Outcome, STAGES } from '../org';
import { type PageParts, renderPage } from '../render';
import { Device } from '../ui/Device';
import { Field } from '../ui/Field';
import { Key, Keys } from '../ui/Key';
import { LatchKey } from '../ui/LatchKey';
import { Lcd } from '../ui/Lcd';
import { Module } from '../ui/Module';
import { Records, RecordTable } from '../ui/Records';
import { When } from '../ui/When';

interface Contact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
}

interface Visit {
  id: string;
  at: string;
  outcome: Outcome;
  note: string | null;
}

interface Note {
  id: string;
  body: string;
  created_at: string;
}

/**
 * The organisation page.
 *
 * - The LCD: the name, the stage, the next action and its due date, and
 *   the last visit. An error from a form shows first.
 * - The modules: log a visit, the stage, the next action, add a note.
 * - The records: the contacts, the visits, the notes and the details.
 *
 * To log a visit takes at most 3 taps. The note is optional: tap the field
 * and type it. Then tap one outcome key. Each outcome key also saves, so a
 * visit with no note is 1 tap, and a visit with a note is 2 taps.
 *
 * Each stage key saves the stage at once. Its form also sends the next
 * action as it is, because `POST /<slug>/stage` sets all three. The next
 * action has its own form, so the Enter key in its date field saves it
 * and does not change the stage.
 */
export const orgPage = ({
  org,
  contacts,
  visits,
  notes,
  error,
}: {
  org: Org;
  contacts: Contact[];
  visits: Visit[];
  notes: Note[];
  error?: string;
}): PageParts => {
  const last = visits[0];
  return {
    title: org.name,
    device: (
      <Device>
        <Lcd
          alert={error}
          rows={[
            { label: 'Name', value: org.name },
            { label: 'Stage', value: STAGES[org.stage] },
            { label: 'Next action', value: org.next_action || 'None' },
            org.next_action_on
              ? {
                  label: 'Due',
                  value: (
                    <>
                      <When value={org.next_action_on} /> ·{' '}
                      {dueWords(org.next_action_on)}
                    </>
                  ),
                  led: org.next_action_on < today(),
                }
              : { label: 'Due', value: 'None' },
            {
              label: 'Last visit',
              value: last ? (
                <>
                  <When value={last.at} time={false} /> ·{' '}
                  {OUTCOMES[last.outcome]}
                </>
              ) : (
                'None'
              ),
            },
          ]}
        />
        <Module label="Log a visit">
          <form method="post" action={`/${org.slug}/visits`}>
            <Field label="Note (optional)">
              <textarea name="note" rows={2} />
            </Field>
            <Keys grid>
              {Object.entries(OUTCOMES).map(([value, text]) => (
                <Key key={value} name="outcome" value={value}>
                  {text}
                </Key>
              ))}
            </Keys>
          </form>
        </Module>
        <Module label="Stage" value={STAGES[org.stage]}>
          <form method="post" action={`/${org.slug}/stage`}>
            <input
              type="hidden"
              name="next_action"
              value={org.next_action ?? ''}
            />
            <input
              type="hidden"
              name="next_action_on"
              value={org.next_action_on ?? ''}
            />
            <Keys grid>
              {Object.entries(STAGES).map(([value, text]) => (
                <LatchKey
                  key={value}
                  name="stage"
                  value={value}
                  on={value === org.stage}
                >
                  {text}
                </LatchKey>
              ))}
            </Keys>
          </form>
        </Module>
        <Module label="Next action">
          <form method="post" action={`/${org.slug}/stage`}>
            <input type="hidden" name="stage" value={org.stage} />
            <Field label="Action">
              <textarea
                name="next_action"
                rows={1}
                defaultValue={org.next_action ?? ''}
              />
            </Field>
            <Field label="Due">
              <input
                name="next_action_on"
                type="date"
                defaultValue={org.next_action_on ?? ''}
              />
            </Field>
            <Key>Save</Key>
          </form>
        </Module>
        <Module label="Add a note">
          <form method="post" action={`/${org.slug}/notes`}>
            <Field label="Note">
              <textarea name="body" rows={2} required />
            </Field>
            <Key>Add note</Key>
          </form>
        </Module>
      </Device>
    ),
    help: (
      <>
        <p>
          Each outcome key saves the visit. "Do not knock" also sets the stage
          to Lost.
        </p>
        <p>Each stage key saves the stage at once.</p>
      </>
    ),
    records: (
      <>
        <Records title="Contacts">
          {contacts.length === 0 ? (
            <p>No contacts.</p>
          ) : (
            <RecordTable
              head={['Name', 'Phone', 'Email', 'Role']}
              rowHeader
              rows={contacts.map((contact) => ({
                key: contact.id,
                cells: [
                  contact.name || 'No name',
                  contact.phone ? (
                    <a key="phone" href={`tel:${contact.phone}`}>
                      {contact.phone}
                    </a>
                  ) : (
                    'None'
                  ),
                  contact.email ? (
                    <a key="email" href={`mailto:${contact.email}`}>
                      {contact.email}
                    </a>
                  ) : (
                    'None'
                  ),
                  contact.role,
                ],
              }))}
            />
          )}
        </Records>
        <Records title="Visits">
          {visits.length === 0 ? (
            <p>No visits.</p>
          ) : (
            <RecordTable
              head={['When', 'Outcome', 'Note']}
              rows={visits.map((visit) => ({
                key: visit.id,
                cells: [
                  <When key="when" value={visit.at} />,
                  OUTCOMES[visit.outcome],
                  visit.note || 'None',
                ],
              }))}
            />
          )}
        </Records>
        <Records title="Notes">
          {notes.length === 0 ? (
            <p>No notes.</p>
          ) : (
            <ul>
              {notes.map((note) => (
                <li key={note.id}>
                  <When value={note.created_at} />: {note.body}
                </li>
              ))}
            </ul>
          )}
        </Records>
        <Records title="Details">
          <dl>
            <dt>Address</dt>
            <dd>
              {[org.address_line_1, org.address_line_2, org.postcode]
                .filter(Boolean)
                .join(', ') || 'None'}
            </dd>
            <dt>Source</dt>
            <dd>{org.source || 'None'}</dd>
            <dt>Lawful basis</dt>
            <dd>{org.lawful_basis?.replaceAll('_', ' ') || 'None'}</dd>
            <dt>Added</dt>
            <dd>
              <When value={org.created_at} />
            </dd>
          </dl>
        </Records>
      </>
    ),
  };
};

/** Send the 404 page for a slug that no organisation has. */
export const sendNotFound = (request: FastifyRequest, reply: FastifyReply) =>
  reply
    .code(404)
    .type('text/html; charset=utf-8')
    .send(
      renderPage(request, {
        title: 'Not found',
        intro: 'No organisation has this address.',
      }),
    );

/**
 * Send the page of `org`. The forms on the page call this with `error` and
 * the code 400 when a value is not valid.
 */
export const sendOrgPage = (
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
  org: Org,
  error?: string,
) => {
  const contacts = db
    .query<Contact, [string]>(
      `SELECT person.id, person.name, person.email, person.phone, membership.role
       FROM membership JOIN person ON person.id = membership.person_id
       WHERE membership.organisation_id = ? ORDER BY person.created_at DESC;`,
    )
    .all(org.id);
  const visits = db
    .query<Visit, [string]>(
      'SELECT id, at, outcome, note FROM visit WHERE organisation_id = ? ORDER BY at DESC, rowid DESC;',
    )
    .all(org.id);
  const notes = db
    .query<Note, [string]>(
      'SELECT id, body, created_at FROM note WHERE organisation_id = ? ORDER BY created_at DESC, rowid DESC;',
    )
    .all(org.id);
  return reply
    .code(error ? 400 : 200)
    .type('text/html; charset=utf-8')
    .send(
      renderPage(request, orgPage({ org, contacts, visits, notes, error })),
    );
};

/**
 * `GET /<slug>`. A static route such as `/orgs` or `/login` always wins over
 * this one (find-my-way), and no slug is a reserved word (`RESERVED_SLUGS`).
 */
export const orgRoute = (app: FastifyInstance, db: Database) => {
  app.get<{ Params: { slug: string } }>(
    '/:slug',
    { config: { admin: true } },
    async (request, reply) => {
      const org = findOrg(db, request.params.slug);
      if (!org) return sendNotFound(request, reply);
      return sendOrgPage(db, request, reply, org);
    },
  );
};
