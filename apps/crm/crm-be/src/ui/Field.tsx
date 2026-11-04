import type { ReactNode } from 'react';
import { Label } from './Label';

/**
 * A field: a silkscreen label above one control (`<input>`, `<select>` or
 * `<textarea>`). The `<label>` holds the control, so the label names it with
 * no `id`. The control uses the page font and fills its module. For a text
 * that can be long, use a `<textarea>`: it grows to show all of its value.
 *
 * `problem` is the word of a field with a problem, for example `needed`
 * (`apps/crm/docs/002-rack.md`, detail 6). The label says it after a dot,
 * and the theme gives the field a thick outline, so the state does not
 * use colour alone. Give the control `aria-invalid` too.
 */
export const Field = ({
  label,
  problem,
  children,
}: {
  label: string;
  problem?: string;
  children: ReactNode;
}) => (
  // biome-ignore lint/a11y/noLabelWithoutControl: the control is in children.
  <label className={problem ? 'field problem' : 'field'}>
    <Label>
      {label}
      {problem && <ProblemWord word={problem} />}
    </Label>{' '}
    {children}
  </label>
);

/** The word of a problem after a label: ` · needed`. */
export const ProblemWord = ({ word }: { word: string }) => (
  <strong className="problem-word"> · {word}</strong>
);
