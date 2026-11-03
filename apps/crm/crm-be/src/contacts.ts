import type { Database } from 'bun:sqlite';
import { type Change, writeEvent } from './events';
import { contactForm } from './forms/contact';
import { changedFields, type FormValues } from './forms/form';
import { nextNumber } from './org';

/**
 * The contacts of an organisation: each one is a `person` with a
 * `membership` of the organisation. A person can be a contact of more than
 * one organisation. The routes `routes/orgs/[slug]/contacts*` and
 * `routes/orgs/new.tsx` call these functions.
 *
 * A removed contact keeps its rows: the membership gets `hidden_at`, and
 * Restore shows it again (REQ-CRM-UNDO-001). Each write is one event
 * (`writeEvent` in `events.ts`).
 */

/**
 * One contact of an organisation: a person and their role. `id` is the
 * person id, for the code only. `number` is the contact number in this
 * organisation: the URL and the page show it (REQ-CRM-ID-001). `hidden` is
 * true for a removed contact.
 */
export interface Contact {
  id: string;
  number: number;
  name: string;
  phone: string | null;
  email: string | null;
  role: string;
  hidden: boolean;
}

const CONTACT_SQL = `
  SELECT person.id, membership.number, person.name, person.phone, person.email,
         membership.role, membership.hidden_at IS NOT NULL AS hidden
    FROM membership JOIN person ON person.id = membership.person_id`;

/**
 * The contacts of an organisation, newest first. With `hidden`, also the
 * removed contacts.
 */
export const listContacts = (db: Database, orgId: string, hidden = false) =>
  db
    .query<Contact, [string, number]>(
      `${CONTACT_SQL}
       WHERE membership.organisation_id = ? AND (? OR membership.hidden_at IS NULL)
       ORDER BY person.created_at DESC, person.rowid DESC;`,
    )
    .all(orgId, hidden ? 1 : 0)
    .map((row) => ({ ...row, hidden: Boolean(row.hidden) }));

/**
 * The current name of each person in `ids`, by id. A person who is not in
 * the crm now has no entry.
 */
export const personNames = (db: Database, ids: string[]) =>
  new Map(
    db
      .query<{ id: string; name: string }, [string]>(
        'SELECT id, name FROM person WHERE id IN (SELECT value FROM json_each(?));',
      )
      .all(JSON.stringify(ids))
      .map((row) => [row.id, row.name]),
  );

/** The visible contact with `number` of an organisation, or null. */
export const findContact = (db: Database, orgId: string, number: number) =>
  findMember(db, orgId, number, false);

/**
 * The removed contact with `number` of an organisation, which Restore can
 * show again, or null (REQ-CRM-UNDO-003).
 */
export const findHiddenContact = (
  db: Database,
  orgId: string,
  number: number,
) => findMember(db, orgId, number, true);

const findMember = (
  db: Database,
  orgId: string,
  number: number,
  hidden: boolean,
) => {
  const row = db
    .query<Contact, [string, number, number]>(
      `${CONTACT_SQL}
       WHERE membership.organisation_id = ? AND membership.number = ?
         AND (membership.hidden_at IS NOT NULL) = ?;`,
    )
    .get(orgId, number, hidden ? 1 : 0);
  return row ? { ...row, hidden: Boolean(row.hidden) } : null;
};

/**
 * Add a contact to an organisation, from the values of the contact form:
 * a `person` and a `membership` with the next contact number. If a person
 * has the email, link that person and leave the row as it is. Returns the
 * display fields and the change of the event, or an error if the person is
 * a contact of the organisation already. The caller writes the event: Add
 * a contact writes `contact_add` (`addContact`), and the new lead writes
 * `create`.
 */
export const insertContact = (
  db: Database,
  orgId: string,
  values: FormValues,
): { error: string } | { person_id: string; role: string; change: Change } => {
  let personId = values.email
    ? db
        .query<{ id: string }, [string]>(
          'SELECT id FROM person WHERE lower(email) = ?;',
        )
        .get(values.email)?.id
    : undefined;
  if (personId) {
    const member = db
      .query<{ hidden: number }, [string, string]>(
        `SELECT hidden_at IS NOT NULL AS hidden FROM membership
         WHERE person_id = ? AND organisation_id = ?;`,
      )
      .get(personId, orgId);
    if (member?.hidden) {
      return {
        error:
          'A removed contact of this organisation has this email address. Tap Show hidden in Activity, then Restore.',
      };
    }
    if (member) {
      return {
        error: 'A contact of this organisation has this email address.',
      };
    }
  } else {
    personId = crypto.randomUUID();
    db.query(
      'INSERT INTO person (id, email, name, phone) VALUES (?, ?, ?, ?);',
    ).run(personId, values.email || null, values.name, values.phone || null);
  }
  db.query(
    'INSERT INTO membership (person_id, organisation_id, role, number) VALUES (?, ?, ?, ?);',
  ).run(personId, orgId, values.role, nextNumber(db, orgId, 'contact'));
  return {
    person_id: personId,
    role: values.role,
    change: {
      table: 'membership',
      id: personId,
      before: { hidden: true },
      after: { hidden: false },
    },
  };
};

/**
 * Add a contact to an organisation (`insertContact`), as one `contact_add`
 * event. Run it in a transaction. Returns an error, or undefined.
 */
export const addContact = (
  db: Database,
  actor: string,
  orgId: string,
  values: FormValues,
) => {
  const added = insertContact(db, orgId, values);
  if ('error' in added) return added.error;
  writeEvent(db, actor, orgId, 'contact_add', {
    person_id: added.person_id,
    role: added.role,
    changes: [added.change],
  });
  return undefined;
};

/**
 * Save the contact form over `contact`: the person, and the role in the
 * membership, as one `contact_edit` event. The display fields have the
 * names of the changed fields, never the values. Returns an error if
 * another person has the email.
 */
export const saveContact = (
  db: Database,
  actor: string,
  orgId: string,
  contact: Contact,
  values: FormValues,
) =>
  db.transaction(() => {
    const { id: _id, number: _number, hidden: _hidden, ...current } = contact;
    const fields = changedFields(contactForm, current, values);
    if (fields.length === 0) return undefined;
    const personFields = fields.filter((name) => name !== 'role');
    if (values.email && personFields.includes('email')) {
      const owner = db
        .query('SELECT 1 FROM person WHERE lower(email) = ? AND id != ?;')
        .get(values.email, contact.id);
      if (owner) return 'Another person has this email address.';
    }
    const changes: Change[] = [];
    if (personFields.length > 0) {
      changes.push({
        table: 'person',
        id: contact.id,
        before: Object.fromEntries(
          personFields.map((name) => [
            name,
            current[name as keyof typeof current],
          ]),
        ),
        // The name is never null: a contact can have only a phone number.
        after: Object.fromEntries(
          personFields.map((name) => [
            name,
            name === 'name' ? values.name : values[name] || null,
          ]),
        ),
      });
    }
    if (fields.includes('role')) {
      changes.push({
        table: 'membership',
        id: contact.id,
        before: { role: contact.role },
        after: { role: values.role },
      });
    }
    writeEvent(db, actor, orgId, 'contact_edit', {
      person_id: contact.id,
      fields,
      changes,
    });
    return undefined;
  })();

/**
 * Remove a contact of an organisation, as one `contact_remove` event: the
 * membership gets `hidden_at`. Nothing is deleted. The person stays,
 * because Undo and Restore show the contact again.
 */
export const removeContact = (
  db: Database,
  actor: string,
  orgId: string,
  contact: Contact,
) =>
  db.transaction(() => {
    writeEvent(db, actor, orgId, 'contact_remove', {
      person_id: contact.id,
      changes: [
        {
          table: 'membership',
          id: contact.id,
          before: { hidden: false },
          after: { hidden: true },
        },
      ],
    });
  })();
