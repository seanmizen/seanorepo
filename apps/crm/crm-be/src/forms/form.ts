import { formText } from '../org';

/**
 * The record forms (REQ-CRM-FORM-001). Each record type has one definition
 * in this folder: its fields, labels, placeholders and checks.
 *
 * - `ui/RecordForm.tsx` renders a definition. The create page and the edit
 *   page of a record use the same definition, so the two pages show the
 *   same form. The edit page fills it with the current values.
 * - `parseForm` reads a post with a definition. The create route and the
 *   edit route use the same definition, so they accept the same values.
 *
 * No other code lists the fields of a record.
 */

/** One field of a form. */
export interface FormField {
  /** The name of the form value. It is also the name of the column. */
  name: string;
  /** The silkscreen label. */
  label: string;
  /**
   * The control. `text` is the default. `keys` is a group of submit keys:
   * the key that the person taps sends its value and saves the form. On an
   * edit page, each key is a latching key, and the LED of the current value
   * is on.
   */
  type?: 'text' | 'tel' | 'email' | 'textarea' | 'select' | 'keys';
  placeholder?: string;
  autoComplete?: string;
  /** For example `characters` for a postcode, or `none` for a URL name. */
  autoCapitalize?: string;
  /** The error when the value is empty. With it, the field is necessary. */
  required?: string;
  /**
   * `select` and `keys`: each value, with its text. An empty `select` gets
   * the first value.
   */
  options?: Record<string, string>;
  /** `keys`: the values in rows. The keys of a row share it in whole parts. */
  rows?: string[][];
  /** Change the trimmed text before the check, for example to capitals. */
  normalize?: (value: string) => string;
  /** The error when a value that is not empty is not valid. */
  check?: (value: string) => string | undefined;
}

/** The definition of the form of one record type. */
export interface RecordFormDef {
  /** The groups of fields. Each group is one module of the device. */
  modules: { label: string; fields: FormField[] }[];
  /** The error for the values together, after each field is valid. */
  check?: (values: FormValues) => string | undefined;
}

/** The values of a form: trimmed text, `''` when empty. */
export type FormValues = Record<string, string>;

/** Each field of `form`, in order. */
export const fieldsOf = (form: RecordFormDef) =>
  form.modules.flatMap((module) => module.fields);

/**
 * Read the values of `form` from a post `body`, and check them. `prefix`
 * comes before each field name in the post, as in `RecordForm`. Returns
 * the values and the first error, if there is one.
 */
export const parseForm = (
  form: RecordFormDef,
  body: unknown,
  prefix = '',
): { values: FormValues; error?: string } => {
  const post = (body ?? {}) as Record<string, unknown>;
  const values: FormValues = {};
  let error: string | undefined;
  for (const field of fieldsOf(form)) {
    let value = formText(post[prefix + field.name]);
    if (value && field.normalize) value = field.normalize(value);
    if (!value && field.type === 'select' && field.options) {
      value = Object.keys(field.options)[0];
    }
    values[field.name] = value;
    if (error) continue;
    if (!value) {
      error = field.required;
    } else if (field.options && !Object.hasOwn(field.options, value)) {
      error = field.required ?? `Choose a value for ${field.label}.`;
    } else {
      error = field.check?.(value);
    }
  }
  return { values, error: error ?? form.check?.(values) };
};

/**
 * True if each field of `values` that the person types is empty. A
 * `select` always has a value, so it does not count.
 */
export const isBlank = (form: RecordFormDef, values: FormValues) =>
  fieldsOf(form).every(
    (field) => field.type === 'select' || !values[field.name],
  );

/**
 * The names of the fields of `form` whose value in `next` is not the same
 * as in `current`. An audit row keeps these names, and never the values.
 */
export const changedFields = (
  form: RecordFormDef,
  current: Record<string, string | null>,
  next: FormValues,
) =>
  fieldsOf(form)
    .map((field) => field.name)
    .filter((name) => (current[name] ?? '') !== next[name]);
