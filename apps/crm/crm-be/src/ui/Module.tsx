import type { ReactNode } from 'react';

/** The width of a module: a number of columns of its grid. */
export type Span = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 12;

/** The class of a module of `span` columns, with `problem`. */
const moduleClass = (span: Span, problem: boolean) =>
  ['module', span !== 6 && `span-${span}`, problem && 'problem']
    .filter(Boolean)
    .join(' ');

/**
 * A module of the device, as each module of the autosam panel: the
 * silkscreen label at the top left, the value (if any) at the top right,
 * and the control below. `span` is its width: a number of columns of the
 * grid of 6 of a `Device`, or of the grid of 12 of a `ControlUnit`. The
 * label is an `<h2>`, so the page has an outline with no page styles. A
 * module with no label holds only the key that saves a form of more than
 * one module. `id` is the target of a link to the module, or that the
 * morph keeps (`crm-fe/src/morph.ts`).
 *
 * The passkey script finds its note and its error line in the same
 * `<section>`, so each passkey control is in a module.
 *
 * `problem` marks the module of a state that needs action, for example an
 * overdue next action: the theme gives it a thick outline, and its `value`
 * says the state in a word (`apps/crm/docs/002-rack.md`, detail 6).
 */
export const Module = ({
  label,
  value,
  span = 6,
  id,
  problem = false,
  children,
}: {
  label?: string;
  value?: ReactNode;
  span?: Span;
  id?: string;
  problem?: boolean;
  children: ReactNode;
}) => (
  <section id={id} className={moduleClass(span, problem)}>
    {label !== undefined && <h2 className="label">{label}</h2>}
    {value !== undefined && <p className="value">{value}</p>}
    {children}
  </section>
);
