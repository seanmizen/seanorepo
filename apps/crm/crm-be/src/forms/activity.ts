import { OUTCOMES } from '../org';
import type { RecordFormDef } from './form';

/** The value of the `Note only` key: a note, with no visit. */
export const NOTE_ONLY = 'note';

/** The value of each key of the Log module, with its text. */
export const LOG_KEYS: Record<string, string> = {
  ...OUTCOMES,
  [NOTE_ONLY]: 'Note only',
};

/**
 * The form of an activity: a visit or a note (REQ-CRM-FORM-001). It is the
 * Log module. `/<slug>` renders it empty, and `/<slug>/activity/<id>`
 * renders it with the current values.
 *
 * Each key saves. An outcome key saves a visit with that outcome and the
 * text as its note. The `Note only` key saves the text as a note, with no
 * visit. On the edit page, a different key changes the outcome, or changes
 * a visit to a note, or a note to a visit.
 */
export const activityForm: RecordFormDef = {
  modules: [
    {
      label: 'Log',
      fields: [
        {
          name: 'note',
          label: 'Visit note',
          type: 'textarea',
          placeholder: 'What happened today?',
        },
        {
          name: 'outcome',
          label: 'Save as',
          type: 'keys',
          required: 'Tap one of the Save as buttons.',
          options: LOG_KEYS,
          rows: [
            ['no_answer', 'spoke', 'call_back'],
            ['not_interested', 'do_not_knock'],
            [NOTE_ONLY],
          ],
        },
      ],
    },
  ],
  check: (values) =>
    values.outcome === NOTE_ONLY && !values.note
      ? 'Type a visit note, then tap Note only.'
      : undefined,
};
