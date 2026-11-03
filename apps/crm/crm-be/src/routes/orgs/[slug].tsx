import type { Database } from 'bun:sqlite';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ReactNode } from 'react';
import { type Event, listEvents } from '../../activity';
import { type Contact, listContacts } from '../../contacts';
import { dueWords, today } from '../../dates';
import { activityForm, LOG_KEYS } from '../../forms/activity';
import { contactForm, ROLES } from '../../forms/contact';
import {
  type FormValues,
  fieldsOf,
  type RecordFormDef,
} from '../../forms/form';
import { organisationForm } from '../../forms/organisation';
import { findOrg, type Org, OUTCOMES, orgPath, STAGES } from '../../org';
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
 * One line of the Activity list, as text: `what` happened, the `text` of
 * a visit or a note, and the `edit` link of a visit or a note. The words
 * are the words on the page: the labels of the fields, the stages and the
 * Save as buttons.
 */
const describe = (
  org: Org,
  event: Event,
): { what: ReactNode; text?: string; edit?: string } => {
  const edit = `${orgPath(org.slug)}/activity/${encodeURIComponent(event.id)}`;
  if (event.kind === 'visit' && event.outcome) {
    return {
      what: `Visit: ${OUTCOMES[event.outcome]}.`,
      text: event.note ?? undefined,
      edit,
    };
  }
  if (event.kind === 'note') {
    return { what: 'Note:', text: event.note ?? undefined, edit };
  }
  const detail = JSON.parse(event.detail ?? '{}');
  const fields: string[] = Array.isArray(detail.fields) ? detail.fields : [];
  const name = contactName(event.person);
  switch (`${event.action} ${event.entity}`) {
    case 'create organisation':
      return { what: 'Added at the stage Lead.' };
    case 'update organisation':
      return { what: orgChange(detail) };
    case 'create membership':
      return {
        what: `Contact added: ${name}${
          detail.role in ROLES
            ? ` (${ROLES[detail.role as keyof typeof ROLES]})`
            : ''
        }.`,
      };
    case 'update person':
    case 'update membership':
      return {
        what: `Contact changed: ${name} (${fields
          .map((field) => CONTACT_LABELS[field] ?? field)
          .join(', ')}).`,
      };
    case 'delete membership':
      return {
        what:
          event.person === null
            ? 'Contact removed.'
            : `Contact removed: ${name}.`,
      };
    case 'update visit':
    case 'update note': {
      const was = detail.was ?? event.entity;
      const changes = [
        ...(fields.includes('outcome')
          ? [`saved as ${LOG_KEYS[detail.saved_as] ?? detail.saved_as}`]
          : []),
        ...(fields.includes('note') ? ['text changed'] : []),
      ].join(', ');
      return {
        what: event.record_at ? (
          <>
            {was === 'note' ? 'Note' : 'Visit'} of{' '}
            <When value={event.record_at} />: {changes}.
          </>
        ) : (
          `A removed ${was}: ${changes}.`
        ),
      };
    }
    default:
      return { what: `${event.entity}: ${event.action}.` };
  }
};

/**
 * One line of the Activity list: the time, then the text. In the
 * `<summary>`, the line has no Edit link: a tap there opens the list.
 */
const EventLine = ({
  org,
  event,
  summary = false,
}: {
  org: Org;
  event: Event;
  summary?: boolean;
}) => {
  const { what, text, edit } = describe(org, event);
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
    </>
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
 * - The boxes: Activity (every event, newest first, in a closed
 *   `<details>`), Contacts and Details. Each visit, note and contact, and
 *   the details, has an Edit link to its edit page.
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
  events,
  error,
  contact,
}: {
  org: Org;
  contacts: Contact[];
  events: Event[];
  error?: string;
  /** The values of the Add a contact module after an error. */
  contact?: FormValues;
}): PageParts => {
  const path = orgPath(org.slug);
  const lastVisit = events.find((event) => event.kind === 'visit');
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
        <form method="post" action={`${path}/activity`}>
          <RecordForm form={activityForm} />
        </form>
        <Module label="Stage" value={STAGES[org.stage]}>
          <form method="post" action={`${path}/stage`}>
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
          <form method="post" action={`${path}/stage`}>
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
        <form method="post" action={`${path}/contacts`}>
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
        <Box title="Activity">
          {events.length === 0 ? (
            <p>No activity.</p>
          ) : (
            <details className="events">
              <summary>
                <span className="count">
                  {events.length} {events.length === 1 ? 'event' : 'events'}.
                  Newest:
                </span>{' '}
                <span className="newest">
                  <EventLine org={org} event={events[0]} summary />
                </span>
              </summary>
              <ol>
                {events.map((event) => (
                  <li key={event.id}>
                    <EventLine org={org} event={event} />
                  </li>
                ))}
              </ol>
            </details>
          )}
        </Box>
        <Box title="Contacts">
          {contacts.length === 0 ? (
            <p>
              No contacts. <a href="#add-contact">Add a contact</a>.
            </p>
          ) : (
            <RecordTable
              head={['Name', 'Role', 'Phone', 'Email', '']}
              rowHeader
              rows={contacts.map((person) => ({
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
                  <span key="edit" className="row-actions">
                    <a
                      href={`${path}/contacts/${encodeURIComponent(person.id)}`}
                    >
                      Edit
                    </a>{' '}
                    <form
                      method="post"
                      action={`${path}/contacts/${encodeURIComponent(person.id)}/remove`}
                    >
                      <button type="submit" className="link">
                        Remove
                      </button>
                    </form>
                  </span>,
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
            <a href={`${path}/edit`}>Edit</a>
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
  { error, contact }: { error?: string; contact?: FormValues } = {},
) =>
  reply
    .code(error ? 400 : 200)
    .type('text/html; charset=utf-8')
    .send(
      renderPage(
        request,
        orgPage({
          org,
          contacts: listContacts(db, org.id),
          events: listEvents(db, org.id),
          error,
          contact,
        }),
      ),
    );

/**
 * `GET /orgs/<slug>`. The static route `/orgs/new` wins over this one
 * (find-my-way), and no slug is `new` (`RESERVED_SLUG`).
 */
export const orgRoute = (app: FastifyInstance, db: Database) => {
  app.get<{ Params: { slug: string } }>(
    '/orgs/:slug',
    { config: { admin: true } },
    async (request, reply) => {
      const org = findOrg(db, request.params.slug);
      if (!org) return sendNotFound(request, reply);
      return sendOrgPage(db, request, reply, org);
    },
  );
};
