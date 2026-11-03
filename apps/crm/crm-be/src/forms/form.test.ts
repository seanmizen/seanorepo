import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { buildApp } from '../index';
import { addOrg, postForm, signInAdmin, testApp } from '../test-helpers';
import { activityForm } from './activity';
import { contactForm } from './contact';
import { fieldsOf, parseForm, type RecordFormDef } from './form';
import { organisationForm } from './organisation';

/** One control of a page, as the person sees it. */
interface Control {
  label: string;
  tag: string;
  name: string;
  type?: string;
  placeholder?: string;
  required: boolean;
  options?: string[];
}

/** The attributes of a tag, by name. */
const attrsOf = (text: string) =>
  Object.fromEntries(
    [...text.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
  );

/**
 * Each control of a record form on a page: its signature, and its value.
 * A `keys` control is a fieldset of submit keys. Its value is the key with
 * the LED on.
 */
const controlsOf = (html: string) => {
  const controls = new Map<string, { control: Control; value: string }>();
  for (const m of html.matchAll(
    /<label class="field"><span class="label">([^<]*)<\/span> (?:<(input)([^>]*)>|<(textarea|select)([^>]*)>([\s\S]*?)<\/(?:textarea|select)>)/g,
  )) {
    const label = m[1];
    const tag = m[2] ?? m[4];
    const attrText = m[3] ?? m[5];
    const inner = m[6] ?? '';
    const attrs = attrsOf(attrText);
    const options = [...inner.matchAll(/<option value="([^"]*)"/g)].map(
      (o) => o[1],
    );
    controls.set(attrs.name, {
      control: {
        label,
        tag,
        name: attrs.name,
        type: attrs.type,
        placeholder: attrs.placeholder,
        required: 'required' in attrs,
        ...(tag === 'select' ? { options } : {}),
      },
      value:
        tag === 'textarea'
          ? inner
          : tag === 'select'
            ? (inner.match(/<option value="([^"]*)" selected=""/)?.[1] ?? '')
            : (attrs.value ?? ''),
    });
  }
  for (const m of html.matchAll(
    /<fieldset class="field"><legend class="label">([^<]*)<\/legend>([\s\S]*?)<\/fieldset>/g,
  )) {
    const keys = [...m[2].matchAll(/<button([^>]*)>/g)].map((b) =>
      attrsOf(b[1]),
    );
    controls.set(keys[0].name, {
      control: {
        label: m[1],
        tag: 'keys',
        name: keys[0].name,
        required: false,
        options: keys.map((key) => key.value),
      },
      value: keys.find((key) => key['aria-pressed'] === 'true')?.value ?? '',
    });
  }
  return controls;
};

/** The controls that `form` defines, with `prefix` before each name. */
const expectedControls = (form: RecordFormDef, prefix = ''): Control[] =>
  fieldsOf(form).map((field) => ({
    label: field.label,
    tag:
      field.type === 'textarea' ||
      field.type === 'select' ||
      field.type === 'keys'
        ? field.type
        : 'input',
    name: prefix + field.name,
    type:
      field.type === 'tel' || field.type === 'email' ? field.type : undefined,
    placeholder: field.placeholder,
    required: field.type !== 'keys' && field.required !== undefined,
    ...(field.type === 'keys'
      ? { options: (field.rows ?? []).flat() }
      : field.type === 'select'
        ? { options: Object.keys(field.options ?? {}) }
        : {}),
  }));

/** The controls of `form` on a page, in the order of the form. */
const formOn = (html: string, form: RecordFormDef, prefix = '') => {
  const controls = controlsOf(html);
  return fieldsOf(form).map((field) => {
    const found = controls.get(prefix + field.name);
    if (!found)
      throw new Error(`The page has no field ${prefix}${field.name}.`);
    return found;
  });
};

let app: ReturnType<typeof buildApp>;
let db: Database;
let close: () => Promise<void>;
let cookie: string;

beforeEach(() => {
  ({ app, db, close } = testApp());
  cookie = signInAdmin(app);
});

afterEach(async () => {
  await close();
});

const page = async (url: string) => {
  const response = await app.inject({
    method: 'GET',
    url,
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  return response.body;
};

describe('the record forms', () => {
  test('the create page and the edit page of each record render the same fields from one definition, and the edit page shows the current values (REQ-CRM-FORM-001)', async () => {
    const slug = await addOrg(app, cookie, {
      name: 'Acme Plumbing',
      source: 'door',
      address_line_1: '1 High Street',
      postcode: 'SW1A 1AA',
      contact_name: 'Ann Smith',
      contact_phone: '07700 900000',
      contact_email: 'ann@example.com',
      contact_role: 'staff',
    });
    await postForm(
      app,
      `/orgs/${slug}/activity`,
      { outcome: 'call_back', note: 'After 5pm' },
      cookie,
    );
    const personId = (
      db.query('SELECT id FROM person WHERE name = ?;').get('Ann Smith') as {
        id: string;
      }
    ).id;
    const visitId = (db.query('SELECT id FROM visit;').get() as { id: string })
      .id;

    const newLead = await page('/orgs/new');
    const orgPage = await page(`/orgs/${slug}`);
    const cases: {
      form: RecordFormDef;
      creates: [string, string][];
      edit: string;
      current: string[];
    }[] = [
      {
        form: organisationForm,
        creates: [[newLead, '']],
        edit: await page(`/orgs/${slug}/edit`),
        current: [
          'Acme Plumbing',
          'door',
          slug,
          '1 High Street',
          '',
          'SW1A 1AA',
        ],
      },
      {
        form: contactForm,
        // The First contact module of /orgs/new, and the Add a contact
        // module of the organisation page.
        creates: [
          [newLead, 'contact_'],
          [orgPage, ''],
        ],
        edit: await page(`/orgs/${slug}/contacts/${personId}`),
        current: ['Ann Smith', '07700 900000', 'ann@example.com', 'staff'],
      },
      {
        form: activityForm,
        creates: [[orgPage, '']],
        edit: await page(`/orgs/${slug}/activity/${visitId}`),
        current: ['After 5pm', 'call_back'],
      },
    ];

    for (const { form, creates, edit, current } of cases) {
      const onEdit = formOn(edit, form);
      expect(onEdit.map((found) => found.control)).toEqual(
        expectedControls(form),
      );
      expect(onEdit.map((found) => found.value)).toEqual(current);
      for (const [html, prefix] of creates) {
        const onCreate = formOn(html, form, prefix);
        expect(onCreate.map((found) => found.control)).toEqual(
          expectedControls(form, prefix),
        );
        // The create page is empty. A select shows its first option.
        expect(
          onCreate
            .filter((found) => found.control.tag !== 'select')
            .map((found) => found.value),
        ).toEqual(
          onCreate
            .filter((found) => found.control.tag !== 'select')
            .map(() => ''),
        );
      }
    }
  });

  test('the create route and the edit route parse a post with the same definition (REQ-CRM-FORM-001)', async () => {
    const slug = await addOrg(app, cookie, {
      name: 'Acme',
      postcode: 'e1 6an',
    });
    await postForm(
      app,
      `/orgs/${slug}/edit`,
      { name: 'Acme', slug, postcode: 'sw1a 1aa' },
      cookie,
    );
    // The definition makes a postcode capitals, on both routes.
    expect(db.query('SELECT postcode FROM organisation;').get()).toEqual({
      postcode: 'SW1A 1AA',
    });
    // The same values give the same error on both routes.
    const create = await postForm(app, '/orgs/new', { name: '' }, cookie);
    const edit = await postForm(
      app,
      `/orgs/${slug}/edit`,
      { name: '' },
      cookie,
    );
    const error = parseForm(organisationForm, { name: '' }).error;
    expect(error).toBe('Type the name of the organisation.');
    for (const response of [create, edit]) {
      expect(response.statusCode).toBe(400);
      expect(response.body).toContain(`<p role="alert">${error}</p>`);
    }
  });

  test('no page outside forms/ names a field of a record form (REQ-CRM-FORM-001)', () => {
    const src = path.join(import.meta.dir, '..');
    const files = readdirSync(src, {
      recursive: true,
      encoding: 'utf8',
    }).filter(
      (file) =>
        file.endsWith('.tsx') &&
        !file.startsWith('forms') &&
        !file.endsWith('RecordForm.tsx'),
    );
    const names = new Set(
      [organisationForm, contactForm, activityForm].flatMap((form) =>
        fieldsOf(form).map((field) => field.name),
      ),
    );
    // `name` and `email` are also the fields of the sign-in pages and of
    // the passkey form, which are not record forms.
    names.delete('name');
    names.delete('email');
    const found = files.flatMap((file) =>
      [
        ...readFileSync(path.join(src, file), 'utf8').matchAll(
          /name="([^"]+)"/g,
        ),
      ]
        .filter((m) => names.has(m[1]))
        .map((m) => `${file}: ${m[1]}`),
    );
    expect(found).toEqual([]);
  });
});
