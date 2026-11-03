import type { Database } from 'bun:sqlite';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  findOrg,
  formatTime,
  type Org,
  OUTCOMES,
  type Outcome,
  STAGES,
} from '../org';
import { renderPage } from '../render';
import { Field } from '../ui/Field';
import { Key } from '../ui/Key';
import { Panel } from '../ui/Panel';

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

/** A time as text that a person reads, in a `<time>` element. */
const Time = ({ iso }: { iso: string }) => (
  <time dateTime={iso}>{formatTime(iso)}</time>
);

/**
 * The organisation page: its details, the forms that log a visit, change the
 * stage and next action, and add a note, then the visits, notes and
 * contacts, newest first.
 *
 * To log a visit takes at most 3 taps. The note is optional: tap the field
 * and type it. Then tap one outcome key. Each outcome key also saves, so a
 * visit with no note is 1 tap, and a visit with a note is 2 taps.
 */
export const OrgPage = ({
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
}) => (
  <>
    {error && (
      <Panel label="Error">
        <p role="alert">{error}</p>
      </Panel>
    )}
    <Panel label="Details">
      <dl>
        <dt>Stage</dt>
        <dd>{STAGES[org.stage]}</dd>
        <dt>Next action</dt>
        <dd>
          {org.next_action || 'None'}
          {org.next_action_on && (
            <>
              {' on '}
              <time dateTime={org.next_action_on}>{org.next_action_on}</time>
            </>
          )}
        </dd>
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
          <Time iso={org.created_at} />
        </dd>
      </dl>
    </Panel>
    <Panel label="Log a visit">
      <form method="post" action={`/${org.slug}/visits`}>
        <Field label="Note (optional)">
          <textarea name="note" rows={2} />
        </Field>
        {Object.entries(OUTCOMES).map(([value, text]) => (
          <Key key={value} name="outcome" value={value}>
            {text}
          </Key>
        ))}
      </form>
      <p>
        Each outcome key saves the visit. "Do not knock" sets the stage to lost.
      </p>
    </Panel>
    <Panel label="Stage and next action">
      <form method="post" action={`/${org.slug}/stage`}>
        <Field label="Stage">
          <select name="stage" defaultValue={org.stage}>
            {Object.entries(STAGES).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Next action">
          <input name="next_action" defaultValue={org.next_action ?? ''} />
        </Field>
        <Field label="On">
          <input
            name="next_action_on"
            type="date"
            defaultValue={org.next_action_on ?? ''}
          />
        </Field>
        <Key>Save</Key>
      </form>
    </Panel>
    <Panel label="Visits">
      {visits.length === 0 ? (
        <p>No visits.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Outcome</th>
              <th scope="col">Note</th>
            </tr>
          </thead>
          <tbody>
            {visits.map((visit) => (
              <tr key={visit.id}>
                <td>
                  <Time iso={visit.at} />
                </td>
                <td>{OUTCOMES[visit.outcome]}</td>
                <td>{visit.note || 'None'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
    <Panel label="Notes">
      <form method="post" action={`/${org.slug}/notes`}>
        <Field label="Note">
          <textarea name="body" rows={2} required />
        </Field>
        <Key>Add note</Key>
      </form>
      {notes.length === 0 ? (
        <p>No notes.</p>
      ) : (
        <ul>
          {notes.map((note) => (
            <li key={note.id}>
              <Time iso={note.created_at} />: {note.body}
            </li>
          ))}
        </ul>
      )}
    </Panel>
    <Panel label="Contacts">
      {contacts.length === 0 ? (
        <p>No contacts.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Phone</th>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((contact) => (
              <tr key={contact.id}>
                <th scope="row">{contact.name || 'No name'}</th>
                <td>
                  {contact.phone ? (
                    <a href={`tel:${contact.phone}`}>{contact.phone}</a>
                  ) : (
                    'None'
                  )}
                </td>
                <td>
                  {contact.email ? (
                    <a href={`mailto:${contact.email}`}>{contact.email}</a>
                  ) : (
                    'None'
                  )}
                </td>
                <td>{contact.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  </>
);

/** Send the 404 page for a slug that no organisation has. */
export const sendNotFound = (request: FastifyRequest, reply: FastifyReply) =>
  reply
    .code(404)
    .type('text/html; charset=utf-8')
    .send(
      renderPage(
        'Not found',
        <Panel label="Not found">
          <p>No organisation has this address.</p>
          <p>
            <a href="/orgs">All organisations</a>
          </p>
        </Panel>,
        request,
      ),
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
      renderPage(
        org.name,
        <OrgPage
          org={org}
          contacts={contacts}
          visits={visits}
          notes={notes}
          error={error}
        />,
        request,
      ),
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
