import type { ReactNode } from 'react';
import { Unit } from './Rack';

/**
 * The control unit: the second unit of the rack. It holds the modules of
 * the page side by side, on a grid of 12 columns
 * (`apps/crm/docs/002-rack.md`). Give each `Module` its `span` of the 12,
 * so the spans of one row add up to 12. A `<form>` that holds more than
 * one module is a direct child, and its modules sit on the same grid.
 *
 * Each module is a `<section>` with an `<h2>`, so the page has an outline
 * with no page styles (REQ-CRM-BARE-001). On a narrow screen each module
 * has the full width, in the order of the HTML.
 */
export const ControlUnit = ({ children }: { children: ReactNode }) => (
  <Unit kind="controls">
    <div className="modules">{children}</div>
  </Unit>
);
