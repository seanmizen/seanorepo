import { RESERVED_SLUG, SLUG_MAX } from '../org';
import { type FormValues, fieldsOf, type RecordFormDef } from './form';

/**
 * The form of an organisation (REQ-CRM-FORM-001). The new-lead page
 * (`/orgs/new`) and the edit page (`/<slug>/edit`) render it, and their
 * routes parse it. The stage and the next action are not in this form: the
 * modules of the organisation page set them.
 *
 * The URL name is the slug. An empty URL name comes from the name
 * (`resolveSlug` in `org.ts`).
 */
export const organisationForm: RecordFormDef = {
  modules: [
    {
      label: 'Organisation',
      fields: [
        {
          name: 'name',
          label: 'Name',
          required: 'Type the name of the organisation.',
        },
        { name: 'source', label: 'Source', placeholder: 'door, referral, web' },
        {
          name: 'slug',
          label: 'URL name',
          placeholder: 'From the name',
          autoCapitalize: 'none',
          normalize: (value) => value.toLowerCase(),
          check: (value) => {
            if (
              value.length > SLUG_MAX ||
              !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
            ) {
              return `The URL name can have only lowercase letters, digits and single hyphens, at most ${SLUG_MAX}.`;
            }
            if (value === RESERVED_SLUG) {
              return `The crm uses the URL name "${value}". Type a different URL name.`;
            }
            return undefined;
          },
        },
      ],
    },
    {
      label: 'Address',
      fields: [
        {
          name: 'address_line_1',
          label: 'Address line 1',
          autoComplete: 'address-line1',
        },
        {
          name: 'address_line_2',
          label: 'Address line 2',
          autoComplete: 'address-line2',
        },
        {
          name: 'postcode',
          label: 'Postcode',
          autoComplete: 'postal-code',
          autoCapitalize: 'characters',
          normalize: (value) => value.toUpperCase(),
        },
      ],
    },
  ],
};

/**
 * The columns of `organisation` that the form sets: one for each field,
 * with the same name.
 */
export const ORG_COLUMNS = fieldsOf(organisationForm).map((field) => field.name);

/** The value of each column in `ORG_COLUMNS`, from the form. Empty is null. */
export const orgColumnValues = (values: FormValues) =>
  ORG_COLUMNS.map((name) => values[name] || null);
