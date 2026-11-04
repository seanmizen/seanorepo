import type { ReactNode } from 'react';
import type {
  FieldProblem,
  FormField,
  FormValues,
  RecordFormDef,
} from '../forms/form';
import { Field, ProblemWord } from './Field';
import { Key, Keys, Sub } from './Key';
import { LatchKey } from './LatchKey';
import { Module, type Span } from './Module';

/**
 * The control of one field. `name` is the name in the post: the field name
 * after the prefix. With a `value`, a `keys` field shows latching keys, and
 * the LED of the current value is on.
 *
 * `problem` is the word of a field with a problem (`Field`). `fixKey` is
 * the value of the key of a `keys` field that fixes the problem, for
 * example `note` (Note only) after "Type a visit note". `form` is the id
 * of the form of a control out of its `<form>`.
 *
 * With `choose`, a `keys` field is a choice in a bigger form, not a group
 * of keys that save: each key is a radio button in a latching key, and a
 * last key `None` (an empty value) is on by default. The key that saves
 * is the key of the bigger form, for example Save lead.
 */
const Control = ({
  field,
  name,
  value,
  problem,
  fixKey,
  form,
  choose = false,
}: {
  field: FormField;
  name: string;
  value?: string;
  problem?: string;
  fixKey?: string;
  form?: string;
  choose?: boolean;
}) => {
  const options = field.options ?? {};
  if (field.type === 'keys' && choose) {
    const hints = field.hints ?? {};
    const rows = field.rows ?? [Object.keys(options)];
    const choices = [...rows.slice(0, -1), [...(rows.at(-1) ?? []), '']];
    return (
      <fieldset className={problem ? 'field problem' : 'field'}>
        <legend className="label">
          {field.label}
          {problem && <ProblemWord word={problem} />}
        </legend>
        {choices.map((row) => (
          <Keys key={row.join(' ')}>
            {row.map((option) => (
              <label key={option} className="key latch">
                <input
                  type="radio"
                  name={name}
                  value={option}
                  defaultChecked={option === (value ?? '')}
                />
                {option ? options[option] : 'None'}
                {hints[option] !== undefined && <Sub>{hints[option]}</Sub>}
              </label>
            ))}
          </Keys>
        ))}
      </fieldset>
    );
  }
  if (field.type === 'keys') {
    const hints = field.hints ?? {};
    // A `<fieldset>`, not a `<label>`: a tap on a label taps its first key.
    return (
      <fieldset className={problem ? 'field problem' : 'field'}>
        <legend className="label">
          {field.label}
          {problem && <ProblemWord word={problem} />}
        </legend>
        {(field.rows ?? [Object.keys(options)]).map((row) => (
          <Keys key={row.join(' ')}>
            {row.map((option) =>
              value ? (
                <LatchKey
                  key={option}
                  name={name}
                  value={option}
                  on={option === value}
                  sub={hints[option]}
                  fix={option === fixKey}
                >
                  {options[option]}
                </LatchKey>
              ) : (
                <Key
                  key={option}
                  name={name}
                  value={option}
                  sub={hints[option]}
                  fix={option === fixKey}
                >
                  {options[option]}
                </Key>
              ),
            )}
          </Keys>
        ))}
      </fieldset>
    );
  }
  const common = {
    name,
    form,
    placeholder: field.placeholder,
    autoComplete: field.autoComplete,
    autoCapitalize: field.autoCapitalize,
    required: field.required !== undefined,
    'aria-invalid': problem ? true : undefined,
  };
  return (
    <Field label={field.label} problem={problem}>
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
 * - `span` is the width of each module on the grid of its unit.
 * - `problem` is the field with the problem of the last post, from
 *   `parseForm`: its label says the word, and the theme gives it a thick
 *   outline. `fixKey` is the value of the key that fixes it (`Control`).
 * - `choose` makes each `keys` field a choice of radio buttons, with
 *   `None` (`Control`): the First visit module of `/orgs/new`.
 */
export const RecordForm = ({
  form,
  values = {},
  prefix = '',
  label,
  id,
  span,
  problem,
  fixKey,
  choose,
  children,
}: {
  form: RecordFormDef;
  values?: Partial<FormValues>;
  prefix?: string;
  label?: string;
  id?: string;
  span?: Span;
  problem?: FieldProblem;
  fixKey?: string;
  choose?: boolean;
  children?: ReactNode;
}) => (
  <>
    {form.modules.map((module, i) => (
      <Module
        key={module.label}
        label={i === 0 && label ? label : module.label}
        id={i === 0 ? id : undefined}
        span={span}
      >
        {module.fields.map((field) => (
          <Control
            key={field.name}
            field={field}
            name={prefix + field.name}
            value={values[field.name]}
            problem={problem?.field === field.name ? problem.word : undefined}
            fixKey={fixKey}
            choose={choose}
          />
        ))}
        {i === form.modules.length - 1 && children}
      </Module>
    ))}
  </>
);

/**
 * The fields of a record form as the cells of one table row, each under
 * the column of its field (REQ-CRM-FORM-001): for example the last row of
 * the Contacts band, which adds a contact. The cells are in the order of
 * the definition, and each has the class `c-<field name>`. A table row
 * cannot hold a `<form>`, so each control names its form by id (`form`).
 * Each cell holds a `Field`, so the label names the control. The theme
 * shows the label on a narrow screen only, where the row has no column
 * legends. `children` is the last cell, for example the key that saves.
 */
export const RecordFormRow = ({
  form,
  formId,
  values = {},
  problem,
  children,
}: {
  form: RecordFormDef;
  formId: string;
  values?: Partial<FormValues>;
  problem?: FieldProblem;
  children?: ReactNode;
}) => (
  <tr className="add-row">
    {form.modules
      .flatMap((module) => module.fields)
      .map((field, i) => (
        <td key={field.name} className={i === 0 ? 'c-name' : `c-${field.name}`}>
          <Control
            field={field}
            name={field.name}
            value={values[field.name]}
            problem={problem?.field === field.name ? problem.word : undefined}
            form={formId}
          />
        </td>
      ))}
    <td className="c-act">{children}</td>
  </tr>
);
