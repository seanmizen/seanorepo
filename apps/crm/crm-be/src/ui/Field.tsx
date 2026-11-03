import type { ReactNode } from 'react';
import { Label } from './Label';

/**
 * A field: a silkscreen label above one control (`<input>`, `<select>` or
 * `<textarea>`). The `<label>` holds the control, so the label names it with
 * no `id`. The control uses the page font and fills its module. For a text
 * that can be long, use a `<textarea>`: it grows to show all of its value.
 */
export const Field = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  // biome-ignore lint/a11y/noLabelWithoutControl: the control is in children.
  <label className="field">
    <Label>{label}</Label> {children}
  </label>
);
