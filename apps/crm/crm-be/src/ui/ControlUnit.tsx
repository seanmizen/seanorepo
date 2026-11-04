import type { ReactNode } from 'react';
import { Unit } from './Rack';

/** A tab of the phone window: the id of a module, and its label. */
export interface WindowTab {
  id: string;
  label: string;
}

/**
 * The control unit: the second unit of the rack. It holds the modules of
 * the page side by side, on a grid of 12 columns
 * (`apps/crm/docs/002-rack.md`). Give each `Module` its `span` of the 12,
 * so the spans of one row add up to 12. A `<form>` that holds more than
 * one module is a direct child, and its modules sit on the same grid.
 *
 * Each module is a `<section>` with an `<h2>`, so the page has an outline
 * with no page styles (REQ-CRM-BARE-001).
 *
 * `tabs` makes the unit the phone window (`apps/crm/docs/002-rack.md`,
 * Phone window): one tab for each module, in the order of the modules,
 * each an anchor link to the id of its module. On a narrow screen the
 * modules are a window one module wide, and a swipe or a tap on a tab
 * changes the module (`crm-fe/src/window.ts`). On a wide screen the theme
 * hides the tabs, and the modules are side by side. With no page styles
 * the tabs are a line of links at the top of the unit. With no `tabs`,
 * each module has the full width on a narrow screen, in the order of the
 * HTML.
 */
export const ControlUnit = ({
  tabs,
  children,
}: {
  tabs?: WindowTab[];
  children: ReactNode;
}) => (
  <Unit kind="controls">
    {tabs ? (
      <div className="deck">
        <nav className="tabs" aria-label="Modules">
          {tabs.map(({ id, label }) => (
            <a key={id} href={`#${id}`}>
              <span>{label}</span>
            </a>
          ))}
        </nav>
        <div className="modules">{children}</div>
      </div>
    ) : (
      <div className="modules">{children}</div>
    )}
  </Unit>
);
