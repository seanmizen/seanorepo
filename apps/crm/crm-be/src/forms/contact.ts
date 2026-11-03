import { normalizeEmail } from '../auth';
import type { RecordFormDef } from './form';

/** The roles of a contact in an organisation, with their text. */
export const ROLES = { owner: 'Owner', staff: 'Staff' } as const;

/**
 * The form of a contact: a `person`, and their `membership` of one
 * organisation (REQ-CRM-FORM-001). The Add a contact module of
 * `/<slug>`, the First contact module of `/orgs/new` (with the prefix
 * `contact_`) and the edit page `/<slug>/contacts/<person-id>` render it.
 * The role is the column of the membership. The other fields are columns
 * of the person.
 *
 * The browser fills no field: the details are not the seller's own.
 */
export const contactForm: RecordFormDef = {
  modules: [
    {
      label: 'Contact',
      fields: [
        { name: 'name', label: 'Name', autoComplete: 'off' },
        { name: 'phone', label: 'Phone', type: 'tel', autoComplete: 'off' },
        {
          name: 'email',
          label: 'Email',
          type: 'email',
          autoComplete: 'off',
          normalize: normalizeEmail,
          check: (value) =>
            /^[^\s@]+@[^\s@]+$/.test(value)
              ? undefined
              : 'The email address is not valid.',
        },
        { name: 'role', label: 'Role', type: 'select', options: ROLES },
      ],
    },
  ],
  check: (values) =>
    values.name || values.phone || values.email
      ? undefined
      : 'Type a name, a phone number or an email address.',
};
