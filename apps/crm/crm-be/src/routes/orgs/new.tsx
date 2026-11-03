import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import { type Auth, audit, normalizeEmail } from '../../auth';
import { formText, makeSlug } from '../../org';
import { renderPage } from '../../render';
import { Field } from '../../ui/Field';
import { Key } from '../../ui/Key';
import { Panel } from '../../ui/Panel';

/** The fields of the new-lead form. */
const FIELDS = [
  'name',
  'address_line_1',
  'address_line_2',
  'postcode',
  'contact_name',
  'phone',
  'email',
  'source',
] as const;

type NewOrgBody = Partial<Record<(typeof FIELDS)[number], string>>;

/**
 * The new-lead form. On an error it shows the message and keeps the values
 * that the person typed.
 */
export const NewOrgPage = ({
  values = {},
  error,
}: {
  values?: NewOrgBody;
  error?: string;
}) => (
  <Panel label="New lead">
    {error && <p role="alert">{error}</p>}
    <form method="post" action="/orgs/new">
      <fieldset>
        <legend>Organisation</legend>
        <Field label="Name">
          <input name="name" required defaultValue={values.name} />
        </Field>
        <Field label="Address line 1">
          <input
            name="address_line_1"
            autoComplete="address-line1"
            defaultValue={values.address_line_1}
          />
        </Field>
        <Field label="Address line 2">
          <input
            name="address_line_2"
            autoComplete="address-line2"
            defaultValue={values.address_line_2}
          />
        </Field>
        <Field label="Postcode">
          <input
            name="postcode"
            autoComplete="postal-code"
            autoCapitalize="characters"
            defaultValue={values.postcode}
          />
        </Field>
        <Field label="Source">
          <input
            name="source"
            placeholder="door, referral, web"
            defaultValue={values.source}
          />
        </Field>
      </fieldset>
      <fieldset>
        <legend>Contact</legend>
        <Field label="Contact name">
          <input
            name="contact_name"
            autoComplete="off"
            defaultValue={values.contact_name}
          />
        </Field>
        <Field label="Phone">
          <input
            name="phone"
            type="tel"
            autoComplete="off"
            defaultValue={values.phone}
          />
        </Field>
        <Field label="Email">
          <input
            name="email"
            type="email"
            autoComplete="off"
            defaultValue={values.email}
          />
        </Field>
      </fieldset>
      <Key>Add lead</Key>
    </form>
  </Panel>
);

/**
 * Add the organisation, its contact (a `person`) and the owner `membership`,
 * in one transaction, with an audit row for each. If a person has the email,
 * link that person and leave the row as it is. With no contact name, phone
 * or email, add no person. Returns the slug.
 */
const addOrg = (db: Database, actor: string, values: NewOrgBody) =>
  db.transaction(() => {
    const value = (key: (typeof FIELDS)[number]) =>
      formText(values[key]) || null;
    const name = formText(values.name);
    const orgId = crypto.randomUUID();
    const slug = makeSlug(db, name);
    db.query(
      `INSERT INTO organisation
         (id, slug, name, address_line_1, address_line_2, postcode, stage, lawful_basis, source)
       VALUES (?, ?, ?, ?, ?, ?, 'lead', 'legitimate_interests', ?);`,
    ).run(
      orgId,
      slug,
      name,
      value('address_line_1'),
      value('address_line_2'),
      value('postcode')?.toUpperCase() ?? null,
      value('source'),
    );
    audit(db, actor, 'create', 'organisation', orgId, { stage: 'lead' });

    const email = normalizeEmail(values.email) || null;
    const phone = value('phone');
    const contactName = value('contact_name');
    if (!email && !phone && !contactName) return slug;

    let personId = email
      ? db
          .query<{ id: string }, [string]>(
            'SELECT id FROM person WHERE lower(email) = ?;',
          )
          .get(email)?.id
      : undefined;
    if (!personId) {
      personId = crypto.randomUUID();
      db.query(
        'INSERT INTO person (id, email, name, phone) VALUES (?, ?, ?, ?);',
      ).run(personId, email, contactName ?? email ?? phone ?? '', phone);
      audit(db, actor, 'create', 'person', personId);
    }
    db.query(
      "INSERT INTO membership (person_id, organisation_id, role) VALUES (?, ?, 'owner');",
    ).run(personId, orgId);
    audit(db, actor, 'create', 'membership', orgId, {
      person_id: personId,
      role: 'owner',
    });
    return slug;
  })();

/** `GET /orgs/new` and `POST /orgs/new` */
export const orgsNewRoute = (app: FastifyInstance, db: Database) => {
  app.get('/orgs/new', { config: { admin: true } }, async (request, reply) =>
    reply
      .type('text/html; charset=utf-8')
      .send(renderPage('New lead', <NewOrgPage />, request)),
  );

  app.post<{ Body: NewOrgBody }>(
    '/orgs/new',
    { config: { admin: true } },
    async (request, reply) => {
      const values = request.body ?? {};
      const email = formText(values.email);
      const error = !formText(values.name)
        ? 'Type the name of the organisation.'
        : email && !/^[^\s@]+@[^\s@]+$/.test(email)
          ? 'The email address is not valid.'
          : undefined;
      if (error) {
        return reply
          .code(400)
          .type('text/html; charset=utf-8')
          .send(
            renderPage(
              'New lead',
              <NewOrgPage values={values} error={error} />,
              request,
            ),
          );
      }
      const slug = addOrg(db, (request.auth as Auth).personId, values);
      return reply.redirect(`/${slug}`, 303);
    },
  );
};
