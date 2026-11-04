import type { Database } from 'bun:sqlite';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ReactNode } from 'react';
import {
  type Activity,
  type ActivityData,
  eventShows,
  readActivity,
} from '../../activity';
import { type Contact, listContacts } from '../../contacts';
import { addDays, dueWords, formatDate, today } from '../../dates';
import type { OrgEvent } from '../../events';
import { activityForm, LOG_KEYS } from '../../forms/activity';
import { contactForm, ROLES } from '../../forms/contact';
import {
  type FieldProblem,
  type FormValues,
  fieldsOf,
  type RecordFormDef,
} from '../../forms/form';
import { organisationForm } from '../../forms/organisation';
import { type ModeCounts, modeCounts, modeKeys } from '../../modes';
import {
  activityPath,
  contactPath,
  findOrg,
  type Org,
  OUTCOMES,
  orgPath,
  STAGES,
  type Stage,
  stageCounts,
} from '../../org';
import { type PageParts, renderPage } from '../../render';
import {
  Band,
  type BandGroup,
  type BandRow,
  BandSection,
  Bands,
} from '../../ui/Band';
import { ControlUnit } from '../../ui/ControlUnit';
import { DisplayUnit, type PlateKey, type Reading } from '../../ui/DisplayUnit';
import { Field } from '../../ui/Field';
import { Key, Keys } from '../../ui/Key';
import { LatchKey } from '../../ui/LatchKey';
import { Module } from '../../ui/Module';
import { Rack } from '../../ui/Rack';
import { RecordForm, RecordFormRow } from '../../ui/RecordForm';
import { When } from '../../ui/When';
import {
  orderHref,
  orderSearch,
  parseOrder,
  type RunningOrder,
  walkOrder,
} from '../index';

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

/** The role of a contact, as ` (Owner)`, or '' for no known role. */
const roleText = (role: unknown) =>
  typeof role === 'string' && role in ROLES
    ? ` (${ROLES[role as keyof typeof ROLES]})`
    : '';

/** The short name of a visit or a note: `Visit 17` or `Note 18`. */
const entryName = (entry: Activity) =>
  `${entry.kind === 'note' ? 'Note' : 'Visit'} ${entry.number}`;

/**
 * One line of the Activity band, as text (REQ-CRM-ID-001: a visit or a
 * note shows its number, as in its URL). The words are the words on the
 * page: the labels of the fields, the stages and the Save as visit keys.
 *
 * - `name`: the event, in the name column: `Visit 17 · Spoke`, `Note 18`,
 *   `Stage`, `Contact`.
 * - `short`: the event in a caption of the plate: `Visit 17`, `Stage`.
 * - `what`: the change, in the text column, for example
 *   `Stage: Lead → Visited.`
 * - `text`: the text of a visit or a note.
 * - `edit`: the edit page of a visit or a note. A hidden visit or note has
 *   `restore`, its Restore path, in its place.
 */
interface Line {
  name: string;
  short: string;
  what?: ReactNode;
  text?: string;
  edit?: string;
  restore?: string;
}

/** The name of each kind of event that is not a visit or a note. */
const EVENT_NAMES: Record<string, string> = {
  create: 'Added',
  stage: 'Stage',
  next_action: 'Next action',
  details: 'Details',
  contact_add: 'Contact',
  contact_edit: 'Contact',
  contact_remove: 'Contact',
  activity_edit: 'Edit',
  restore: 'Restore',
  undo: 'Undo',
  redo: 'Redo',
};

const describe = (org: Org, data: ActivityData, event: OrgEvent): Line => {
  const detail = event.payload;
  const entry = detail.record_id
    ? data.entries.get(detail.record_id)
    : undefined;
  const name = contactName(
    detail.person_id ? (data.people.get(detail.person_id) ?? null) : null,
  );
  const fields = Array.isArray(detail.fields)
    ? (detail.fields as string[])
    : [];
  const kindName = EVENT_NAMES[event.kind] ?? event.kind;
  const plain = (what: ReactNode): Line => ({
    name: kindName,
    short: kindName,
    what,
  });
  switch (event.kind) {
    case 'create':
      return plain(
        detail.person_id
          ? `At the stage Lead. Contact added: ${name}${roleText(detail.role)}.`
          : 'At the stage Lead.',
      );
    case 'visit':
    case 'note': {
      const kind = event.kind === 'note' ? 'Note' : 'Visit';
      if (!entry) {
        return { name: kind, short: kind, what: `A removed ${event.kind}.` };
      }
      const hidden = entry.hidden_at !== null;
      const pipeline =
        detail.pipeline && typeof detail.pipeline === 'object'
          ? orgChange(
              detail.pipeline as Record<string, string | null | string[]>,
            )
          : null;
      return {
        name: entry.outcome
          ? `${entryName(entry)} · ${OUTCOMES[entry.outcome]}`
          : entryName(entry),
        short: entryName(entry),
        what: pipeline?.length ? pipeline : undefined,
        text: entry.note ?? undefined,
        ...(hidden
          ? { restore: orgPath(org.slug, 'activity', entry.number, 'restore') }
          : { edit: activityPath(org.slug, entry.number) }),
      };
    }
    case 'stage':
    case 'next_action':
    case 'details':
      return plain(
        orgChange(detail as Record<string, string | null | string[]>),
      );
    case 'contact_add':
      return plain(`Contact added: ${name}${roleText(detail.role)}.`);
    case 'contact_edit':
      return plain(
        `Contact changed: ${name} (${fields
          .map((field) => CONTACT_LABELS[field] ?? field)
          .join(', ')}).`,
      );
    case 'contact_remove':
      return plain(
        detail.person_id && data.people.has(detail.person_id)
          ? `Contact removed: ${name}.`
          : 'Contact removed.',
      );
    case 'activity_edit': {
      const was = detail.was ?? entry?.kind;
      const saved = String(detail.saved_as);
      const changes = [
        ...(fields.includes('outcome')
          ? [`saved as ${LOG_KEYS[saved] ?? saved}`]
          : []),
        ...(fields.includes('note') ? ['text changed'] : []),
      ].join(', ');
      const pipeline =
        detail.pipeline && typeof detail.pipeline === 'object'
          ? orgChange(
              detail.pipeline as Record<string, string | null | string[]>,
            )
          : null;
      return {
        name: kindName,
        short: entry ? `Edit of ${entryName(entry)}` : kindName,
        what: entry ? (
          <>
            {was === 'note' ? 'Note' : 'Visit'} {entry.number} of{' '}
            <When value={entry.at} />: {changes}.
            {pipeline?.length ? <> {pipeline}</> : null}
          </>
        ) : (
          `A removed ${was}: ${changes}.`
        ),
      };
    }
    case 'restore':
      return plain(
        entry ? `${entryName(entry)} restored.` : `Contact restored: ${name}.`,
      );
    case 'undo':
    case 'redo': {
      const target = data.events.find(
        (other) => other.number === detail.target,
      );
      const verb = event.kind === 'undo' ? 'Undo' : 'Redo';
      if (!target) return plain(`${verb}.`);
      const line = describe(org, data, target);
      const entryKind = target.kind === 'visit' || target.kind === 'note';
      return plain(
        entryKind || !line.what ? (
          `${verb} of ${line.name}.`
        ) : (
          <>
            {verb} of {line.what}
          </>
        ),
      );
    }
    default:
      return plain(`${event.kind}.`);
  }
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
 * The actions of a row of a band: Edit, or the word `hidden` and Restore.
 */
const RowActions = ({
  edit,
  remove,
  restore,
  hidden,
}: {
  edit?: string;
  remove?: string;
  restore?: string;
  hidden: boolean;
}) => (
  <span className="row-actions">
    {restore ? (
      <>
        <span className="flag">hidden</span>{' '}
        <RestoreButton action={restore} hidden={hidden} />
      </>
    ) : (
      <>
        {edit && <a href={edit}>Edit</a>}
        {remove && (
          <>
            {' '}
            <form method="post" action={remove}>
              <button type="submit" className="link">
                Remove
              </button>
            </form>
          </>
        )}
      </>
    )}
  </span>
);

/**
 * The Activity band: every event, newest first, open, in groups by month.
 * The gutter names the month (`2026-Nov`) and its count. `Show hidden` (or
 * `Hide hidden`) is a GET form in the head of the band, and it is always in
 * its place (REQ-CRM-BUTTON-001). With `hidden` the hidden visits and notes
 * show too, each with Restore (REQ-CRM-UNDO-003). Undo and Redo are on the
 * plate of the display unit.
 */
const ActivityBand = ({
  org,
  data,
  hidden,
  hiddenCount,
  order,
}: {
  org: Org;
  data: ActivityData;
  hidden: boolean;
  /** The number of hidden visits, notes and contacts. */
  hiddenCount: number;
  order: RunningOrder;
}) => {
  const search = orderSearch(order);
  const events = [...data.events]
    .reverse()
    .filter((event) => eventShows(data, event, hidden));
  const groups: BandGroup[] = [];
  for (const event of events) {
    const month = formatDate(event.at, { time: false }).slice(0, 8);
    const line = describe(org, data, event);
    const what = line.what ?? (line.text ? null : 'No note.');
    const row: BandRow = {
      key: String(event.number),
      name: line.name,
      cells: [
        { value: <When value={event.at} /> },
        {
          value: (
            <>
              {what && <span className="what">{what}</span>}
              {what && line.text && ' '}
              {line.text && <span className="text">{line.text}</span>}
            </>
          ),
          title: line.text,
        },
        {
          value: (
            <RowActions
              edit={line.edit && `${line.edit}${search}`}
              restore={line.restore && `${line.restore}${search}`}
              hidden={hidden}
            />
          ),
        },
      ],
    };
    const group = groups.at(-1);
    if (group?.name === month) {
      group.rows.push(row);
      group.count += 1;
    } else {
      groups.push({ name: month, count: 1, rows: [row] });
    }
  }
  return (
    <Band
      id="activity"
      title="Activity"
      name="activity"
      info={`${events.length} ${events.length === 1 ? 'event' : 'events'}, newest first. Undo and Redo are on the plate.`}
      tools={
        <form method="get" action={`${orgPath(org.slug)}#activity`}>
          <OrderFields order={order} />
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
      }
      gutter="Month"
      nameLabel="Event"
      columns={[
        { label: 'When', name: 'c-when' },
        { label: 'Text', name: 'c-text' },
        { label: 'Edit', name: 'c-act' },
      ]}
      groups={groups}
      empty="No activity."
    />
  );
};

/** The fields of the contact form after the name, in order. */
const CONTACT_COLUMNS = fieldsOf(contactForm).slice(1);

/**
 * The Contacts band: one row for each contact, with phone and email links,
 * Edit and Remove. A hidden contact shows only with `hidden`, with
 * Restore. The last row adds a contact: the contact form, each field under
 * its column (REQ-CRM-FORM-001), and the Add contact key. Its `<form>` is
 * in the head of the band, because a table row cannot hold a form.
 */
const ContactsBand = ({
  org,
  contacts,
  hidden,
  values,
  problem,
  search,
}: {
  org: Org;
  contacts: Contact[];
  hidden: boolean;
  /** The values of the last row after an error. */
  values?: FormValues;
  problem?: FieldProblem;
  /** The query string of the running order (`orderSearch`). */
  search: string;
}) => (
  <Band
    id="contacts"
    title="Contacts"
    name="contacts"
    span={8}
    info={
      contacts.length === 0
        ? 'No contacts'
        : `${contacts.length} ${contacts.length === 1 ? 'contact' : 'contacts'}`
    }
    tools={
      <form
        id="add-contact"
        method="post"
        action={`${orgPath(org.slug, 'contacts')}${search}`}
      />
    }
    nameLabel={fieldsOf(contactForm)[0].label}
    columns={[
      ...CONTACT_COLUMNS.map((field) => ({
        label: field.label,
        name: `c-${field.name}`,
      })),
      { label: 'Edit', name: 'c-act' },
    ]}
    groups={[
      {
        name: 'Contacts',
        count: contacts.length,
        rows: contacts.map((person) => ({
          key: String(person.number),
          name: person.name || 'No name',
          cells: [
            {
              value: person.phone ? (
                <a href={`tel:${person.phone}`}>{person.phone}</a>
              ) : (
                <span className="none">None</span>
              ),
            },
            {
              value: person.email ? (
                <a href={`mailto:${person.email}`}>{person.email}</a>
              ) : (
                <span className="none">None</span>
              ),
              title: person.email ?? undefined,
            },
            { value: ROLES[person.role as keyof typeof ROLES] ?? person.role },
            {
              value: (
                <RowActions
                  edit={`${contactPath(org.slug, person.number)}${search}`}
                  remove={`${contactPath(org.slug, person.number, 'remove')}${search}`}
                  restore={
                    person.hidden
                      ? `${contactPath(org.slug, person.number, 'restore')}${search}`
                      : undefined
                  }
                  hidden={hidden}
                />
              ),
            },
          ],
        })),
      },
    ]}
    empty="No contacts."
    foot={
      <RecordFormRow
        form={contactForm}
        formId="add-contact"
        values={values}
        problem={problem}
      >
        <Key form="add-contact" fix={problem !== undefined}>
          Add contact
        </Key>
      </RecordFormRow>
    }
  />
);

/** The address of an organisation on one line, or null. */
const addressOf = (org: Org) =>
  [org.address_line_1, org.address_line_2, org.postcode]
    .filter(Boolean)
    .join(', ') || null;

/**
 * The Details band: the address, the source, the lawful basis and the date
 * added, as a `<dl>`, with Edit in its head. An empty value says None.
 */
const DetailsBand = ({ org, search }: { org: Org; search: string }) => (
  <BandSection
    id="details"
    title="Details"
    name="details"
    span={4}
    tools={<a href={`${orgPath(org.slug, 'edit')}${search}`}>Edit</a>}
  >
    <dl className="sheet">
      {(
        [
          ['Address', addressOf(org)],
          ['Source', org.source],
          ['Lawful basis', org.lawful_basis?.replaceAll('_', ' ')],
          ['Added', <When key="added" value={org.created_at} />],
        ] as const
      ).map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value || <span className="none">None</span>}</dd>
        </div>
      ))}
    </dl>
  </BandSection>
);

/**
 * The read-out of an organisation in the glass of its display unit. The
 * organisation page and its edit page show it, so each page of the record
 * has the same rack. Each reading has the same lines in each state, so the
 * glass keeps its height (REQ-CRM-MORPH-001).
 *
 * - Name: the one large value, and the address.
 * - Next action: the action, then its due date and its status in words.
 *   An overdue date has the status mark.
 * - Stage.
 * - Last visit: its date, then its number and outcome.
 * - Contact: the first contact, then their role and phone.
 */
export const orgReadings = ({
  org,
  contacts,
  activity,
  date = today(),
}: {
  org: Org;
  contacts: Contact[];
  activity: ActivityData;
  date?: string;
}): Reading[] => {
  const lastVisit = [...activity.entries.values()]
    .filter((entry) => entry.kind === 'visit' && entry.hidden_at === null)
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  const first = contacts.find((person) => !person.hidden);
  return [
    {
      label: 'Name',
      kind: 'name',
      value: org.name,
      lines: [{ value: addressOf(org) ?? 'No address' }],
    },
    {
      label: 'Next action',
      kind: 'wide',
      value: org.next_action || 'None',
      lines: [
        org.next_action_on
          ? {
              value: (
                <>
                  <When value={org.next_action_on} /> ·{' '}
                  {dueWords(org.next_action_on)}
                </>
              ),
              mark: org.next_action_on < date,
            }
          : { value: 'No due date' },
      ],
    },
    { label: 'Stage', value: STAGES[org.stage] },
    {
      label: 'Last visit',
      value: lastVisit ? <When value={lastVisit.at} time={false} /> : 'None',
      lines: [
        {
          value: lastVisit?.outcome
            ? `${entryName(lastVisit)} · ${OUTCOMES[lastVisit.outcome]}`
            : 'No visits',
        },
      ],
    },
    {
      label: 'Contact',
      value: first ? first.name || 'No name' : 'No contacts',
      lines: [
        {
          value: first
            ? [
                ROLES[first.role as keyof typeof ROLES] ?? first.role,
                first.phone,
              ]
                .filter(Boolean)
                .join(' · ')
            : 'None',
        },
      ],
    },
  ];
};

/**
 * The last save of an organisation, for the line of the glass: "Saved
 * 2026-Nov-04 11:21: Visit 4."
 */
export const lastSave = (org: Org, activity: ActivityData) => {
  const newest = activity.events.at(-1);
  if (!newest) return undefined;
  return (
    <>
      Saved <When value={newest.at} />: {describe(org, activity, newest).short}.
    </>
  );
};

/**
 * A problem of a post on the organisation page. The page shows it in three
 * places (`apps/crm/docs/002-rack.md`, detail 6): `text` in the glass,
 * the part with the problem (`part`, and its `field`) with a thick outline
 * and a word, and the key that fixes it (`fixKey` for a key of the Log
 * module).
 */
export interface OrgProblem {
  text: string;
  part: 'log' | 'stage' | 'next' | 'contact' | 'undo';
  field?: FieldProblem;
  fixKey?: string;
}

/** The place of an organisation in its running order (`walkOrder`). */
export type Walk = ReturnType<typeof walkOrder>;

/**
 * The fields of the running order as hidden inputs, for a GET form: a GET
 * form drops the query of its action, so it sends the order as fields.
 */
export const OrderFields = ({ order }: { order: RunningOrder }) =>
  [...new URLSearchParams(orderSearch(order).slice(1))].map(([name, value]) => (
    <input key={name} type="hidden" name={name} value={value} />
  ));

/**
 * Prev and Next on the plate of an organisation page: the organisations
 * before it and after it in its running order. Each one is a link that
 * keeps the order. Each caption names the organisation that the key
 * opens. At an end the key is off, and its caption says why: First in
 * list, Last in list (REQ-CRM-BUTTON-001).
 */
const walkKeys = (order: RunningOrder, walk: Walk): PlateKey[] => {
  const lost = walk.total === 0 || (order.at === null && walk.place === null);
  return (['prev', 'next'] as const).map((side) => {
    const step = walk[side];
    const id = `walk-${side}`;
    const label = side === 'prev' ? 'Prev' : 'Next';
    if (step) {
      return {
        id,
        label,
        caption: step.name,
        href: orderHref(step.slug, order, step.at),
        rel: side,
      };
    }
    const caption = lost
      ? 'Not in list'
      : side === 'prev'
        ? 'First in list'
        : 'Last in list';
    return { id, label, caption, off: true };
  });
};

/**
 * The module that a press of the control unit lands on: Next action
 * (`apps/crm/docs/002-rack.md`, Phone window). The task at a door goes
 * from left to right: Log, then Stage, then Next action, and each visit
 * ends with the next action. So each form of the control unit has this
 * `#hash` in its action. The redirect keeps it (a redirect with no hash
 * keeps the hash of the request), and on a phone the window moves to the
 * module with no page jump (`crm-fe/src/window.ts`, REQ-CRM-MORPH-001).
 */
const NEXT = '#next';

/** The due keys of the Next action module: each one sets a date. */
const DUE_KEYS = [
  { label: 'Tomorrow', days: 1 },
  { label: '+3 days', days: 3 },
  { label: '+1 week', days: 7 },
] as const;

/**
 * The organisation page (`apps/crm/docs/002-rack.md`): a rack over the
 * bands (REQ-CRM-LAYOUT-002).
 *
 * - The display unit: the read-out of the organisation (`orgReadings`).
 *   The first line is the error of the last post, or else the last save.
 *   The plate keys are Undo and Redo. Each caption names the change that
 *   the key acts on ("Undo: Visit 3"), or why the key is off
 *   (REQ-CRM-UNDO-002, REQ-CRM-BUTTON-001).
 * - The control unit: Log, Stage and Next action, in one row.
 *   - Log (`forms/activity.ts`): the note, then the Save as visit keys
 *     and Note only. Each key saves. Call back says "then due", Do not
 *     knock says "sets Lost".
 *   - Stage: one latching key for each stage, with the number of
 *     organisations at that stage under it. Each key saves at once. Its
 *     form also sends the next action as it is, because
 *     `POST /orgs/<slug>/stage` sets all three.
 *   - Next action: the action, the due date and Save, then the due keys
 *     (Tomorrow, +3 days, +1 week), each with the date that it sets, then
 *     Clear. The date field comes before the due keys, so the Enter key in
 *     it presses Save.
 * - The bands: Contacts (the last row adds a contact), Details and
 *   Activity, all open. Activity has every event, newest first, by month.
 *   With `hidden` (`?hidden=1`), the hidden visits, notes and contacts
 *   show too, each with Restore (REQ-CRM-UNDO-003).
 *
 * A problem shows in three places: the glass, the part with the problem
 * (a thick outline and a word such as "needed"), and the key that fixes
 * it. An overdue next action is a problem too: the mark in the glass, the
 * Next action module ("Overdue"), and the due keys.
 */
export const orgPage = ({
  org,
  contacts,
  activity,
  counts,
  hidden = false,
  problem,
  contact,
  date = today(),
  order,
  walk,
  modes,
}: {
  org: Org;
  /** Every contact, with the removed (hidden) ones. */
  contacts: Contact[];
  activity: ActivityData;
  /** The number of organisations at each stage. */
  counts: Record<Stage, number>;
  /** True for `?hidden=1`: the page shows the hidden records. */
  hidden?: boolean;
  problem?: OrgProblem;
  /** The values of the Add contact row after an error. */
  contact?: FormValues;
  date?: string;
  /** The running order of the page, from its URL (`parseOrder`). */
  order: RunningOrder;
  /** The place of the organisation in its running order (`walkOrder`). */
  walk: Walk;
  /** The counts of the mode keys (`modeCounts`). */
  modes: ModeCounts;
}): PageParts => {
  const search = orderSearch(order);
  const entries = [...activity.entries.values()];
  const hiddenCount =
    entries.filter((entry) => entry.hidden_at !== null).length +
    contacts.filter((person) => person.hidden).length;
  const shown = contacts.filter((person) => hidden || !person.hidden);
  const { undo, redo } = activity.history;
  const plateKey = (
    kind: 'undo' | 'redo',
    label: string,
    state: typeof undo,
  ): PlateKey =>
    'off' in state
      ? { id: kind, label, caption: state.off, off: true }
      : {
          id: kind,
          label,
          caption: `${label}: ${describe(org, activity, state.event).short}`,
          form: {
            action: `${orgPath(org.slug, kind)}${search}`,
            method: 'post',
            fields: {
              event: String(state.event.number),
              ...(hidden ? { hidden: '1' } : {}),
            },
          },
        };
  const due = org.next_action_on;
  const overdue = due !== null && due < date;
  const nextProblem = problem?.part === 'next' ? problem.field : undefined;
  return {
    title: org.name,
    rack: (
      <Rack>
        <DisplayUnit
          alert={problem?.text ?? null}
          saved={lastSave(org, activity)}
          readings={orgReadings({ org, contacts, activity, date })}
          keys={[
            plateKey('undo', 'Undo', undo),
            plateKey('redo', 'Redo', redo),
            ...walkKeys(order, walk),
          ]}
          modes={modeKeys({
            mode: 'work',
            work: walk.first
              ? {
                  href: orderHref(walk.first.slug, order, 1),
                  caption: walk.place
                    ? `${walk.place} of ${walk.total}`
                    : 'Not in list',
                }
              : { caption: 'No match' },
            counts: modes,
          })}
        />
        <ControlUnit
          tabs={[
            { id: 'log', label: 'Log' },
            { id: 'stage', label: 'Stage' },
            { id: 'next', label: 'Next action' },
          ]}
        >
          <form
            method="post"
            action={`${orgPath(org.slug, 'activity')}${search}${NEXT}`}
          >
            <RecordForm
              form={activityForm}
              id="log"
              span={5}
              problem={problem?.part === 'log' ? problem.field : undefined}
              fixKey={problem?.part === 'log' ? problem.fixKey : undefined}
            />
          </form>
          <Module
            id="stage"
            label="Stage"
            value={problem?.part === 'stage' ? 'Needed' : STAGES[org.stage]}
            span={3}
            problem={problem?.part === 'stage'}
          >
            <form
              method="post"
              action={`${orgPath(org.slug, 'stage')}${search}${NEXT}`}
            >
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
                    sub={counts[value as Stage]}
                  >
                    {text}
                  </LatchKey>
                ))}
              </Keys>
            </form>
          </Module>
          <Module
            id="next"
            label="Next action"
            value={overdue ? 'Overdue' : due ? <When value={due} /> : 'None'}
            span={4}
            problem={overdue || nextProblem !== undefined}
          >
            <form
              method="post"
              action={`${orgPath(org.slug, 'stage')}${search}${NEXT}`}
            >
              <input type="hidden" name="stage" value={org.stage} />
              <Field label="Action">
                <textarea
                  name="next_action"
                  rows={1}
                  defaultValue={org.next_action ?? ''}
                />
              </Field>
              <div className="pair">
                <Field label="Due date" problem={nextProblem?.word}>
                  <input
                    name="next_action_on"
                    type="date"
                    defaultValue={due ?? ''}
                    aria-invalid={nextProblem ? true : undefined}
                  />
                </Field>
                <Key fix={nextProblem !== undefined}>Save</Key>
              </div>
              <fieldset className="field">
                <legend className="label">Set due</legend>
                <Keys>
                  {DUE_KEYS.map(({ label, days }) => {
                    const value = addDays(date, days);
                    return (
                      <LatchKey
                        key={label}
                        name="due"
                        value={value}
                        on={value === due}
                        sub={<When value={value} />}
                        fix={overdue}
                      >
                        {label}
                      </LatchKey>
                    );
                  })}
                </Keys>
              </fieldset>
            </form>
            <form
              method="post"
              action={`${orgPath(org.slug, 'stage')}${search}${NEXT}`}
            >
              <input type="hidden" name="stage" value={org.stage} />
              <input type="hidden" name="next_action" value="" />
              <input type="hidden" name="next_action_on" value="" />
              <Keys>
                <Key
                  id="clear-next"
                  off={
                    org.next_action || due
                      ? undefined
                      : 'No next action to clear.'
                  }
                >
                  Clear
                </Key>
              </Keys>
            </form>
          </Module>
        </ControlUnit>
      </Rack>
    ),
    band: (
      <Bands>
        <ContactsBand
          org={org}
          contacts={shown}
          hidden={hidden}
          values={contact}
          problem={problem?.part === 'contact' ? problem.field : undefined}
          search={search}
        />
        <DetailsBand org={org} search={search} />
        <ActivityBand
          org={org}
          data={activity}
          hidden={hidden}
          hiddenCount={hiddenCount}
          order={order}
        />
      </Bands>
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
 * Send the page of `org`. The forms on the page call this with a `problem`
 * and the code 400 when a value is not valid, and the Add contact row with
 * the values that the person typed.
 */
export const sendOrgPage = (
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
  org: Org,
  {
    problem,
    contact,
    hidden,
  }: { problem?: OrgProblem; contact?: FormValues; hidden?: boolean } = {},
) => {
  const date = today();
  // The running order is in the query of the page, and of each post from
  // it: each form of the page posts to its path with the same query.
  const order = parseOrder(request.query);
  return reply
    .code(problem ? 400 : 200)
    .type('text/html; charset=utf-8')
    .send(
      renderPage(
        request,
        orgPage({
          org,
          contacts: listContacts(db, org.id, true),
          activity: readActivity(db, org.id),
          counts: stageCounts(db),
          hidden,
          problem,
          contact,
          date,
          order,
          walk: walkOrder(db, order, org.slug, date),
          modes: modeCounts(db, date),
        }),
      ),
    );
};

/**
 * The address of the Activity band of the organisation with `slug`, after a
 * post from it. With `hidden`, the page keeps the hidden records on view.
 * The address keeps the running order of the post, as `orderBack` does.
 */
export const activityBack = (
  slug: string,
  hidden: boolean,
  request: FastifyRequest,
) =>
  `${orgPath(slug)}${orderSearch(parseOrder(request.query), hidden ? { hidden: '1' } : {})}#activity`;

/**
 * The address of the organisation page with `slug` after a post from it or
 * from one of its edit pages: the page in the running order of the post.
 * Each form posts with the query of the page (`orderSearch`), so a save
 * keeps Prev and Next on the same list.
 */
export const orderBack = (slug: string, request: FastifyRequest) =>
  `${orgPath(slug)}${orderSearch(parseOrder(request.query))}`;

/**
 * `GET /orgs/<slug>`. The static route `/orgs/new` wins over this one
 * (find-my-way), and no slug is `new` (`RESERVED_SLUG`). `?hidden=1` shows
 * the hidden visits, notes and contacts, each with Restore.
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
