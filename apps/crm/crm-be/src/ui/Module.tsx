import type { ReactNode } from 'react';

/**
 * A module of the device, as each module of the autosam panel: the
 * silkscreen label at the top left, the value (if any) at the top right,
 * and the control below. `span` is its width on the grid of 6 columns of
 * the device. The label is an `<h2>`, so the page has an outline with no
 * page styles. A module with no label holds only the key that saves a form
 * of more than one module. `id` is the target of a link to the module, or
 * that the morph keeps (`crm-fe/src/morph.ts`).
 *
 * The passkey script finds its note and its error line in the same
 * `<section>`, so each passkey control is in a module.
 */
export const Module = ({
  label,
  value,
  span = 6,
  id,
  children,
}: {
  label?: string;
  value?: ReactNode;
  span?: 2 | 3 | 4 | 6;
  id?: string;
  children: ReactNode;
}) => (
  <section id={id} className={span === 6 ? 'module' : `module span-${span}`}>
    {label !== undefined && <h2 className="label">{label}</h2>}
    {value !== undefined && <p className="value">{value}</p>}
    {children}
  </section>
);
