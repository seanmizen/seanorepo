import type { ReactNode } from 'react';

/**
 * The rack: the device of a page, on its side, at the full width of the
 * page (REQ-CRM-LAYOUT-002). The units stack on one chassis, with 2px seams
 * between them: first the `DisplayUnit`, then the `ControlUnit`. The data
 * of the page is the `Band` under the rack. `renderPage` puts the rack and
 * the band in `<main>` (the `rack` and `band` parts of a page).
 */
export const Rack = ({ children }: { children: ReactNode }) => (
  <div className="rack">{children}</div>
);

/**
 * One unit of the rack, with an ear at each end. An ear is metal with two
 * screw holes, and it has no text. On a narrow screen the ears go, so the
 * unit has the full width. `kind` is the class of the unit: `display` or
 * `controls`.
 */
export const Unit = ({
  kind,
  children,
}: {
  kind: 'display' | 'controls';
  children: ReactNode;
}) => (
  <div className={`unit ${kind}`}>
    <span className="ear" aria-hidden="true" />
    {children}
    <span className="ear" aria-hidden="true" />
  </div>
);
