import type { ReactNode } from 'react';
import type { FormField, FormValues, RecordFormDef } from '../forms/form';
import { Field } from './Field';
import { Key, Keys } from './Key';
import { LatchKey } from './LatchKey';
import { Module } from './Module';

/**
 * The control of one field. `name` is the name in the post: the field name
 * after the prefix. With a `value`, a `keys` field shows latching keys, and
 * the LED of the current value is on. Its `save` key, if any, sends the
 * current value.
 */
const Control = ({
  field,
  name,
  value,
}: {
  field: FormField;
  name: string;
  value?: string;
}) => {
  const options = field.options ?? {};
  if (field.type === 'keys') {
    // A `<fieldset>`, not a `<label>`: a tap on a label taps its first key.
    const group = (
      <fieldset className="field">
        <legend className="label">{field.label}</legend>
        {(field.rows ?? [Object.keys(options)]).map((row) => (
          <Keys key={row.join(' ')}>
            {row.map((option) =>
              value ? (
                <LatchKey
                  key={option}
                  name={name}
                  value={option}
                  on={option === value}
                >
                  {options[option]}
                </LatchKey>
              ) : (
                <Key key={option} name={name} value={option}>
                  {options[option]}
                </Key>
              ),
            )}
          </Keys>
        ))}
      </fieldset>
    );
    if (!value || !field.save) return group;
    return (
      <>
        {group}
        <Keys>
          <Key name={name} value={value}>
            {field.save}
          </Key>
        </Keys>
      </>
    );
  }
  const common = {
    name,
    placeholder: field.placeholder,
    autoComplete: field.autoComplete,
    autoCapitalize: field.autoCapitalize,
    required: field.required !== undefined,
  };
  return (
    <Field label={field.label}>
      {field.type === 'textarea' ? (
        <textarea {...common} rows={2} defaultValue={value} />
      ) : field.type === 'select' ? (
        <select {...common} defaultValue={value || Object.keys(options)[0]}>
          {Object.entries(options).map(([option, text]) => (
            <option key={option} value={option}>
              {text}
            </option>
          ))}
        </select>
      ) : (
        <input {...common} type={field.type} defaultValue={value} />
      )}
    </Field>
  );
};

/**
 * The modules of a record form, from its definition (REQ-CRM-FORM-001).
 * The create page renders it with no `values`. The edit page renders it
 * with the current values. The page puts it in a `<form>`, with the key
 * that saves, so that one form can hold two definitions (`/orgs/new`).
 *
 * - `prefix` comes before each field name in the post. `parseForm` reads
 *   the post with the same prefix.
 * - `label` replaces the label of the first module, for example "Add a
 *   contact".
 * - `id` goes on the first module, as the target of a link.
 * - `children` go at the end of the last module, for example its `Save`
 *   key.
 */
export const RecordForm = ({
  form,
  values = {},
  prefix = '',
  label,
  id,
  children,
}: {
  form: RecordFormDef;
  values?: Partial<FormValues>;
  prefix?: string;
  label?: string;
  id?: string;
  children?: ReactNode;
}) => (
  <>
    {form.modules.map((module, i) => (
      <Module
        key={module.label}
        label={i === 0 && label ? label : module.label}
        id={i === 0 ? id : undefined}
      >
        {module.fields.map((field) => (
          <Control
            key={field.name}
            field={field}
            name={prefix + field.name}
            value={values[field.name]}
          />
        ))}
        {i === form.modules.length - 1 && children}
      </Module>
    ))}
  </>
);
