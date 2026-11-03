import type { Database } from 'bun:sqlite';
import { audit, normalizeEmail } from './auth';
import { contactForm } from './forms/contact';
import { changedFields, type FormValues } from './forms/form';

/**
 * The contacts of an organisation: each one is a `person` with a
 * `membership` of the organisation. A person can be a contact of more than
 * one organisation. The routes `routes/[slug]/contacts*` and
 * `routes/orgs/new.tsx` call these functions.
 */

/** One contact of an organisation: a person and their role. */
export interface Contact {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: string;
}

/** The contacts of an organisation, newest first. */
export const listContacts = (db: Database, orgId: string) =>
  db
    .query<Contact, [string]>(
      `SELECT person.id, person.name, person.phone, person.email, membership.role
       FROM membership JOIN person ON person.id = membership.person_id
       WHERE membership.organisation_id = ? ORDER BY person.created_at DESC, person.rowid DESC;`,
    )
    .all(orgId);

/** The contact `personId` of an organisation, or null. */
export const findContact = (db: Database, orgId: string, personId: string) =>
  db
    .query<Contact, [string, string]>(
      `SELECT person.id, person.name, person.phone, person.email, membership.role
       FROM membership JOIN person ON person.id = membership.person_id
       WHERE membership.organisation_id = ? AND person.id = ?;`,
    )
    .get(orgId, personId);

/**
 * Add a contact to an organisation, from the values of the contact form:
 * a `person` and a `membership`, each with an audit row. If a person has
 * the email, link that person and leave the row as it is. Run it in a
 * transaction. Returns an error if the person is a contact of the
 * organisation already.
 */
export const addContact = (
  db: Database,
  actor: string,
  orgId: string,
  values: FormValues,
) => {
  let personId = values.email
    ? db
        .query<{ id: string }, [string]>(
          'SELECT id FROM person WHERE lower(email) = ?;',
        )
        .get(values.email)?.id
    : undefined;
  if (personId) {
    const member = db
      .query(
        'SELECT 1 FROM membership WHERE person_id = ? AND organisation_id = ?;',
      )
      .get(personId, orgId);
    if (member) return 'A contact of this organisation has this email address.';
  } else {
    personId = crypto.randomUUID();
    db.query(
      'INSERT INTO person (id, email, name, phone) VALUES (?, ?, ?, ?);',
    ).run(personId, values.email || null, values.name, values.phone || null);
    audit(db, actor, 'create', 'person', personId, { organisation_id: orgId });
  }
  db.query(
    'INSERT INTO membership (person_id, organisation_id, role) VALUES (?, ?, ?);',
  ).run(personId, orgId, values.role);
  audit(db, actor, 'create', 'membership', orgId, {
    person_id: personId,
    role: values.role,
  });
  return undefined;
};

/**
 * Save the contact form over `contact`: the person, and the role in the
 * membership. Each one that changes gets an audit row with the names of
 * the changed fields, never the values. Returns an error if another person
 * has the email.
 */
export const saveContact = (
  db: Database,
  actor: string,
  orgId: string,
  contact: Contact,
  values: FormValues,
) =>
  db.transaction(() => {
    const fields = changedFields(contactForm, { ...contact }, values);
    const personFields = fields.filter((name) => name !== 'role');
    if (values.email && personFields.includes('email')) {
      const owner = db
        .query('SELECT 1 FROM person WHERE lower(email) = ? AND id != ?;')
        .get(values.email, contact.id);
      if (owner) return 'Another person has this email address.';
    }
    if (personFields.length > 0) {
      db.query(
        `UPDATE person SET name = ?, phone = ?, email = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?;`,
      ).run(values.name, values.phone || null, values.email || null, contact.id);
      audit(db, actor, 'update', 'person', contact.id, {
        organisation_id: orgId,
        fields: personFields,
      });
    }
    if (fields.includes('role')) {
      db.query(
        'UPDATE membership SET role = ? WHERE person_id = ? AND organisation_id = ?;',
      ).run(values.role, contact.id, orgId);
      audit(db, actor, 'update', 'membership', orgId, {
        person_id: contact.id,
        fields: ['role'],
      });
    }
    return undefined;
  })();

/**
 * Remove a contact of an organisation: delete the membership. If the
 * person is a contact of no other organisation, also delete the person. It
 * never deletes the admin (CRM_ADMIN_EMAIL), because the admin signs in as
 * that person. Each delete gets an audit row.
 */
export const removeContact = (
  db: Database,
  actor: string,
  orgId: string,
  contact: Contact,
) =>
  db.transaction(() => {
    db.query(
      'DELETE FROM membership WHERE person_id = ? AND organisation_id = ?;',
    ).run(contact.id, orgId);
    audit(db, actor, 'delete', 'membership', orgId, { person_id: contact.id });
    const otherMembership = db
      .query('SELECT 1 FROM membership WHERE person_id = ?;')
      .get(contact.id);
    const admin = normalizeEmail(process.env.CRM_ADMIN_EMAIL);
    const isAdmin = admin !== '' && normalizeEmail(contact.email) === admin;
    if (!otherMembership && !isAdmin) {
      db.query('DELETE FROM person WHERE id = ?;').run(contact.id);
      audit(db, actor, 'delete', 'person', contact.id, {
        organisation_id: orgId,
      });
    }
  })();
