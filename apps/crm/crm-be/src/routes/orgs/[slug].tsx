import type { Database } from 'bun:sqlite';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ReactNode } from 'react';
import { type Activity, listEntries } from '../../activity';
import { type Contact, listContacts, personNames } from '../../contacts';
import { dueWords, today } from '../../dates';
import {
  type History,
  historyOf,
  listOrgEvents,
  type OrgEvent,
} from '../../events';
import { activityForm, LOG_KEYS } from '../../forms/activity';
import { contactForm, ROLES } from '../../forms/contact';
import {
  type FormValues,
  fieldsOf,
  type RecordFormDef,
} from '../../forms/form';
import { organisationForm } from '../../forms/organisation';
import {
  activityPath,
  contactPath,
  findOrg,
  type Org,
  OUTCOMES,
  orgPath,
  STAGES,
} from '../../org';
import { type PageParts, renderPage } from '../../render';
import { Box } from '../../ui/Box';
import { Device } from '../../ui/Device';
import { Field } from '../../ui/Field';
import { Key, Keys } from '../../ui/Key';
import { LatchKey } from '../../ui/LatchKey';
import { Lcd } from '../../ui/Lcd';
import { Module } from '../../ui/Module';
import { RecordForm } from '../../ui/RecordForm';
import { RecordTable } from '../../ui/RecordTable';
import { When } from '../../ui/When';

/** The labels of the fields of `form`, by name. */
const labelsOf = (form: RecordFormDef): Record<string, string> =>
  Object.fromEntries(fieldsOf(form).map((field) => [field.name, field.label]));

const ORG_LABELS = labelsOf(organisationForm);
const CONTACT_LABELS = labelsOf(contactForm);

/** The name of a contact in a line of the Activity list. */
const contactName = (person: string | null) =>
  person === null ? 'a removed contact' : person || 'a contact with no name';

/** The text of a change to the organisation: its details or its pipeline. */
const orgChange = (detail: Record<string, string | null | string[]>) => {
  const fields = Array.isArray(detail.fields) ? detail.fields : undefined;
  const stage = String(detail.stage) as keyof typeof STAGES;
  const from = String(detail.from) as keyof typeof STAGES;
  const parts: ReactNode[] = [];
  if (fields ? fields.includes('stage') : detail.stage) {
    parts.push(
      fields && STAGES[from]
        ? `Stage: ${STAGES[from]} → ${STAGES[stage]}`
        : `Stage: ${STAGES[stage]}`,
    );
  }
  const due =
    typeof detail.next_action_on === 'string' && detail.next_action_on;
  if (fields?.some((name) => name.startsWith('next_action'))) {
    parts.push(
      detail.cleared ? (
        'Next action cleared'
      ) : due ? (
        <>
          Next action due <When value={due} />
        </>
      ) : (
        'Next action changed, with no Due date'
      ),
    );
  } else if (!fields && due) {
    parts.push(
      <>
        Next action due <When value={due} />
      </>,
    );
  }
  const details = (fields ?? []).filter((name) => ORG_LABELS[name]);
  if (details.length > 0) {
    parts.push(
      `Details changed: ${details.map((name) => ORG_LABELS[name]).join(', ')}`,
    );
  }
  return parts.map((part, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: the parts have a fixed order.
    <span key={i}>
      {i > 0 && ' '}
      {part}.
    </span>
  ));
};

/**
 * Everything that the Activity list shows: the events, the visits and the
 * notes by id, the names of the people, and the state of Undo and Redo.
 */
export interface ActivityData {
  /** Each event, oldest first. */
  events: OrgEvent[];
  entries: Map<string, Activity>;
  people: Map<string, string>;
  history: History;
}

/** Read the Activity list of the organisation `orgId`. */
export const readActivity = (db: Database, orgId: string): ActivityData => {
  const events = listOrgEvents(db, orgId);
  const ids = events.flatMap((event) =>
    event.payload.person_id ? [event.payload.person_id] : [],
  );
  return {
    events,
    entries: listEntries(db, orgId),
    people: personNames(db, ids),
    history: historyOf(events),
  };
};

/** The role of a contact, as ` (Owner)`, or '' for no known role. */
const roleText = (role: unknown) =>
  typeof role === 'string' && role in ROLES
    ? ` (${ROLES[role as keyof typeof ROLES]})`
    : '';

/** The text of a visit or a note: `Visit 17: Spoke.` or `Note 18:`. */
const entryText = (entry: Activity) =>
  entry.outcome
    ? `Visit ${entry.number}: ${OUTCOMES[entry.outcome]}.`
    : `Note ${entry.number}:`;

/**
 * One line of the Activity list, as text: `what` happened, the `text` of
 * a visit or a note, and the `edit` link of a visit or a note. A hidden
 * visit or note has `hidden` and its `restore` path in place of `edit`.
 * The words are the words on the page: the labels of the fields, the
 * stages and the Save as buttons. A visit or a note shows its number, as
 * in its URL (REQ-CRM-ID-001): `Visit 17: Spoke.`, `Note 18:`.
 */
interface Line {
  what: ReactNode;
  text?: string;
  edit?: string;
  restore?: string;
}

const describe = (org: Org, data: ActivityData, event: OrgEvent): Line => {
  const detail = event.payload;
  const entry = detail.record_id
    ? data.entries.get(detail.record_id)
    : undefined;
  const name = contactName(
    detail.person_id ? (data.people.get(detail.person_id) ?? null) : null,
  );
  const pipeline =
    detail.pipeline && typeof detail.pipeline === 'object' ? (
      <>
        {' '}
        {orgChange(detail.pipeline as Record<string, string | null | string[]>)}
      </>
    ) : null;
  const fields = Array.isArray(detail.fields)
    ? (detail.fields as string[])
    : [];
  switch (event.kind) {
    case 'create':
      return {
        what: detail.person_id
          ? `Added at the stage Lead. Contact added: ${name}${roleText(detail.role)}.`
          : 'Added at the stage Lead.',
      };
    case 'visit':
    case 'note': {
      if (!entry) return { what: `A removed ${event.kind}.` };
      const hidden = entry.hidden_at !== null;
      return {
        what: (
          <>
            {entryText(entry)}
            {pipeline}
          </>
        ),
        text: entry.note ?? undefined,
        ...(hidden
          ? { restore: orgPath(org.slug, 'activity', entry.number, 'restore') }
          : { edit: activityPath(org.slug, entry.number) }),
      };
    }
    case 'stage':
    case 'next_action':
    case 'details':
      return {
        what: orgChange(detail as Record<string, string | null | string[]>),
      };
    case 'contact_add':
      return { what: `Contact added: ${name}${roleText(detail.role)}.` };
    case 'contact_edit':
      return {
        what: `Contact changed: ${name} (${fields
          .map((field) => CONTACT_LABELS[field] ?? field)
          .join(', ')}).`,
      };
    case 'contact_remove':
      return {
        what:
          detail.person_id && data.people.has(detail.person_id)
            ? `Contact removed: ${name}.`
            : 'Contact removed.',
      };
    case 'activity_edit': {
      const was = detail.was ?? entry?.kind;
      const saved = String(detail.saved_as);
      const changes = [
        ...(fields.includes('outcome')
          ? [`saved as ${LOG_KEYS[saved] ?? saved}`]
          : []),
        ...(fields.includes('note') ? ['text changed'] : []),
      ].join(', ');
      return {
        what: entry ? (
          <>
            {was === 'note' ? 'Note' : 'Visit'} {entry.number} of{' '}
            <When value={entry.at} />: {changes}.{pipeline}
          </>
        ) : (
          `A removed ${was}: ${changes}.`
        ),
      };
    }
    case 'restore':
      return {
        what: entry
          ? `${entry.kind === 'note' ? 'Note' : 'Visit'} ${entry.number} restored.`
          : `Contact restored: ${name}.`,
      };
    case 'undo':
    case 'redo': {
      const target = data.events.find(
        (other) => other.number === detail.target,
      );
      const verb = event.kind === 'undo' ? 'Undo' : 'Redo';
      return {
        what: target ? (
          <>
            {verb} of {describe(org, data, target).what}
          </>
        ) : (
          `${verb}.`
        ),
      };
    }
    default:
      return { what: `${event.kind}.` };
  }
};

/**
 * One line of the Activity list: the time, then the text. In the
 * `<summary>`, the line has no Edit link and no Restore button: a tap there
 * opens the list. A hidden visit or note shows `hidden` and Restore.
 */
const EventLine = ({
  org,
  data,
  event,
  hidden,
  summary = false,
}: {
  org: Org;
  data: ActivityData;
  event: OrgEvent;
  /** True when the page shows the hidden records (`?hidden=1`). */
  hidden: boolean;
  summary?: boolean;
}) => {
  const { what, text, edit, restore } = describe(org, data, event);
  return (
    <>
      <When value={event.at} /> <span className="what">{what}</span>
      {text && (
        <>
          {' '}
          <span className="text">{text}</span>
        </>
      )}
      {edit && !summary && (
        <>
          {' '}
          <a className="edit" href={edit}>
            Edit
          </a>
        </>
      )}
      {restore && !summary && (
        <>
          {' '}
          <span className="edit">
            <span className="flag">hidden</span>{' '}
            <RestoreButton action={restore} hidden={hidden} />
          </span>
        </>
      )}
    </>
  );
};

/**
 * The Restore button of a hidden record: a form that posts to `action`. It
 * keeps the page in its mode (`hidden`).
 */
const RestoreButton = ({
  action,
  hidden,
}: {
  action: string;
  hidden: boolean;
}) => (
  <form method="post" action={action}>
    {hidden && <input type="hidden" name="hidden" value="1" />}
    <button type="submit" className="link">
      Restore
    </button>
  </form>
);

/**
 * True when the line of `event` shows: a visit or a note that is hidden
 * shows only with `?hidden=1`.
 */
const shows = (data: ActivityData, event: OrgEvent, hidden: boolean) => {
  if (hidden || (event.kind !== 'visit' && event.kind !== 'note')) return true;
  const entry = event.payload.record_id
    ? data.entries.get(event.payload.record_id)
    : undefined;
  return !entry || entry.hidden_at === null;
};

/**
 * The Activity box: Undo and Redo, then every event, newest first, in a
 * `<details>`. The first part of the open list is `Show hidden` (or
 * `Hide hidden`), a GET form. Undo, Redo and Show hidden are always in
 * their place: a key that cannot act is off, with the reason
 * (REQ-CRM-BUTTON-001). Each one is a plain form (REQ-CRM-BARE-001).
 */
const ActivityBox = ({
  org,
  data,
  hidden,
  hiddenCount,
}: {
  org: Org;
  data: ActivityData;
  hidden: boolean;
  /** The number of hidden visits, notes and contacts. */
  hiddenCount: number;
}) => {
  const lines = [...data.events]
    .reverse()
    .filter((event) => shows(data, event, hidden));
  const { undo, redo } = data.history;
  return (
    <Box title="Activity">
      <div className="history" id="activity">
        {(
          [
            ['undo', 'Undo', undo],
            ['redo', 'Redo', redo],
          ] as const
        ).map(([kind, label, state]) => (
          <form key={kind} method="post" action={orgPath(org.slug, kind)}>
            {'event' in state && (
              <input type="hidden" name="event" value={state.event.number} />
            )}
            {hidden && <input type="hidden" name="hidden" value="1" />}
            <Key id={kind} off={'off' in state ? state.off : undefined}>
              {label}
            </Key>
          </form>
        ))}
      </div>
      {lines.length === 0 ? (
        <p>No activity.</p>
      ) : (
        <details className="events" open={hidden}>
          <summary>
            <span className="count">
              {lines.length} {lines.length === 1 ? 'event' : 'events'}. Newest:
            </span>{' '}
            <span className="newest">
              <EventLine
                org={org}
                data={data}
                event={lines[0]}
                hidden={hidden}
                summary
              />
            </span>
          </summary>
          <form method="get" action={`${orgPath(org.slug)}#activity`}>
            {!hidden && <input type="hidden" name="hidden" value="1" />}
            <Key
              id="show-hidden"
              off={
                !hidden && hiddenCount === 0 ? 'Nothing is hidden.' : undefined
              }
            >
              {hidden ? 'Hide hidden' : 'Show hidden'}
            </Key>
          </form>
          <ol>
            {lines.map((event) => (
              <li key={event.number}>
                <EventLine
                  org={org}
                  data={data}
                  event={event}
                  hidden={hidden}
                />
              </li>
            ))}
          </ol>
        </details>
      )}
    </Box>
  );
};

/**
 * The organisation page.
 *
 * - The LCD: the name, the stage, the next action and its due date, and
 *   the last visit and its outcome. An error from a form shows first.
 * - The modules: Log (`forms/activity.ts`), Stage, Next action and Add a
 *   contact (`forms/contact.ts`). On a phone, the LCD and Log fill the
 *   first screen.
 * - The boxes: Activity (Undo and Redo, then every event, newest first, in
 *   a closed `<details>`), Contacts and Details. Each visit, note and
 *   contact, and the details, has an Edit link to its edit page. With
 *   `hidden` (`?hidden=1`), the hidden visits, notes and contacts show
 *   too, each with Restore, and the Activity list is open
 *   (REQ-CRM-UNDO-003).
 *
 * To log a visit takes at most 2 taps: type the note (optional), then tap
 * one Save as key. Each key saves.
 *
 * Each Stage key saves the stage at once. Its form also sends the next
 * action as it is, because `POST /orgs/<slug>/stage` sets all three. The
 * next action has its own form, so the Enter key in its date field saves it
 * and does not change the stage.
 */
export const orgPage = ({
  org,
  contacts,
  activity,
  hidden = false,
  error,
  contact,
}: {
  org: Org;
  /** Every contact, with the removed (hidden) ones. */
  contacts: Contact[];
  activity: ActivityData;
  /** True for `?hidden=1`: the page shows the hidden records. */
  hidden?: boolean;
  error?: string;
  /** The values of the Add a contact module after an error. */
  contact?: FormValues;
}): PageParts => {
  const entries = [...activity.entries.values()];
  const lastVisit = entries
    .filter((entry) => entry.kind === 'visit' && entry.hidden_at === null)
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  const hiddenCount =
    entries.filter((entry) => entry.hidden_at !== null).length +
    contacts.filter((person) => person.hidden).length;
  const shown = contacts.filter((person) => hidden || !person.hidden);
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
                  mark: org.next_action_on < today(),
                }
              : { label: 'Due', value: 'None' },
            {
              label: 'Last visit',
              value: lastVisit?.outcome ? (
                <>
                  <When value={lastVisit.at} time={false} /> ·{' '}
                  {OUTCOMES[lastVisit.outcome]}
                </>
              ) : (
                'None'
              ),
            },
          ]}
        />
        <form method="post" action={orgPath(org.slug, 'activity')}>
          <RecordForm form={activityForm} />
        </form>
        <Module label="Stage" value={STAGES[org.stage]}>
          <form method="post" action={orgPath(org.slug, 'stage')}>
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
          <form method="post" action={orgPath(org.slug, 'stage')}>
            <input type="hidden" name="stage" value={org.stage} />
            <Field label="Action">
              <textarea
                name="next_action"
                rows={1}
                defaultValue={org.next_action ?? ''}
              />
            </Field>
            <div className="pair">
              <Field label="Due">
                <input
                  name="next_action_on"
                  type="date"
                  defaultValue={org.next_action_on ?? ''}
                />
              </Field>
              <Key>Save</Key>
            </div>
          </form>
        </Module>
        <form method="post" action={orgPath(org.slug, 'contacts')}>
          <RecordForm
            form={contactForm}
            values={contact}
            label="Add a contact"
            id="add-contact"
          >
            <Key>Save</Key>
          </RecordForm>
        </form>
      </Device>
    ),
    boxes: (
      <>
        <ActivityBox
          org={org}
          data={activity}
          hidden={hidden}
          hiddenCount={hiddenCount}
        />
        <Box title="Contacts">
          {shown.length === 0 ? (
            <p>
              No contacts. <a href="#add-contact">Add a contact</a>.
            </p>
          ) : (
            <RecordTable
              head={['Name', 'Role', 'Phone', 'Email', '']}
              rowHeader
              rows={shown.map((person) => ({
                key: person.id,
                cells: [
                  person.name || 'No name',
                  ROLES[person.role as keyof typeof ROLES] ?? person.role,
                  person.phone ? (
                    <a key="phone" href={`tel:${person.phone}`}>
                      {person.phone}
                    </a>
                  ) : (
                    ''
                  ),
                  person.email ? (
                    <a key="email" href={`mailto:${person.email}`}>
                      {person.email}
                    </a>
                  ) : (
                    ''
                  ),
                  person.hidden ? (
                    <span key="edit" className="row-actions">
                      <span className="flag">hidden</span>{' '}
                      <RestoreButton
                        action={contactPath(org.slug, person.number, 'restore')}
                        hidden={hidden}
                      />
                    </span>
                  ) : (
                    <span key="edit" className="row-actions">
                      <a href={contactPath(org.slug, person.number)}>Edit</a>{' '}
                      <form
                        method="post"
                        action={contactPath(org.slug, person.number, 'remove')}
                      >
                        <button type="submit" className="link">
                          Remove
                        </button>
                      </form>
                    </span>
                  ),
                ],
              }))}
            />
          )}
        </Box>
        <Box title="Details">
          <dl>
            <dt>Address</dt>
            <dd>
              {[org.address_line_1, org.address_line_2, org.postcode]
                .filter(Boolean)
                .join(', ')}
            </dd>
            <dt>Source</dt>
            <dd>{org.source}</dd>
            <dt>Lawful basis</dt>
            <dd>{org.lawful_basis?.replaceAll('_', ' ')}</dd>
            <dt>Added</dt>
            <dd>
              <When value={org.created_at} />
            </dd>
          </dl>
          <p className="row-actions">
            <a href={orgPath(org.slug, 'edit')}>Edit</a>
          </p>
        </Box>
      </>
    ),
  };
};

/** Send the 404 page for an address that has no page. */
export const sendNotFound = (request: FastifyRequest, reply: FastifyReply) =>
  reply
    .code(404)
    .type('text/html; charset=utf-8')
    .send(
      renderPage(request, {
        title: 'Not found',
        intro: 'No page has this address.',
      }),
    );

/**
 * Send the page of `org`. The forms on the page call this with `error` and
 * the code 400 when a value is not valid, and the Add a contact module with
 * the values that the person typed.
 */
export const sendOrgPage = (
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
  org: Org,
  {
    error,
    contact,
    hidden,
  }: { error?: string; contact?: FormValues; hidden?: boolean } = {},
) =>
  reply
    .code(error ? 400 : 200)
    .type('text/html; charset=utf-8')
    .send(
      renderPage(
        request,
        orgPage({
          org,
          contacts: listContacts(db, org.id, true),
          activity: readActivity(db, org.id),
          hidden,
          error,
          contact,
        }),
      ),
    );

/**
 * The address of the Activity box of the organisation with `slug`, after a
 * post from it. With `hidden`, the page keeps the hidden records on view.
 */
export const activityBack = (slug: string, hidden: boolean) =>
  `${orgPath(slug)}${hidden ? '?hidden=1' : ''}#activity`;

/**
 * `GET /orgs/<slug>`. The static route `/orgs/new` wins over this one
 * (find-my-way), and no slug is `new` (`RESERVED_SLUG`). `?hidden=1` shows
 * the hidden visits, notes and contacts, each with Restore, and opens the
 * Activity list.
 */
export const orgRoute = (app: FastifyInstance, db: Database) => {
  app.get<{ Params: { slug: string }; Querystring: { hidden?: string } }>(
    '/orgs/:slug',
    { config: { admin: true } },
    async (request, reply) => {
      const org = findOrg(db, request.params.slug);
      if (!org) return sendNotFound(request, reply);
      return sendOrgPage(db, request, reply, org, {
        hidden: request.query.hidden === '1',
      });
    },
  );
};
