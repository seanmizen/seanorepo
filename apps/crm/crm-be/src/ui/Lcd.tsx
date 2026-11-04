import type { ReactNode } from 'react';

/** One read-out row: a label and a value. */
export interface Readout {
  label: string;
  value: ReactNode;
  /**
   * True shows the status mark before the value: a solid circle in the ink
   * of the LCD, which blinks. The value must tell the same state in text,
   * for example "2 days overdue".
   */
  mark?: boolean;
}

/** One row of a menu: a link to a page. */
export interface MenuItem {
  href: string;
  name: string;
  /** The value at the right of the name, for example a count. */
  value?: ReactNode;
}

/** A menu: the pages to pick from, with a legend over each column. */
export interface Menu {
  legend: [string, string];
  items: MenuItem[];
  /** The text when `items` is empty. */
  empty: string;
}

/**
 * The LCD of the device: a glass in a faceplate, as the display of autosam.
 * It shows data, or a short menu. It never holds the page title, help text
 * or a form control. A list of records is not a menu: it is a `Band`.
 *
 * - `alert`: a message about the last action, for example a form error. It
 *   comes first, in a `role="alert"` paragraph, after the status mark.
 * - `rows`: the read-out, as a `<dl>`: a label and a value in each row.
 * - `menu`: a short list of pages. Each row is a link, as each song in the
 *   track list of autosam. The menu is the only part of the LCD that a
 *   person can tap.
 *
 * This component owns the rules of the LCD (REQ-CRM-LCD-002):
 *
 * 1. No LED is inside the glass. A status in the glass is the status mark,
 *    a solid circle in the ink of the LCD that blinks slowly. It is the
 *    only mark in the glass.
 * 2. The characters never move. Each menu row starts with the arrow
 *    column. A hover or a focus shows the arrow in it, and changes no
 *    layout.
 * 3. The menu rows have one fixed height. A text that does not fit ends
 *    in an ellipsis, and the `title` of the row holds the full text.
 *
 * With nothing to show, the LCD is absent. Text carries each value and
 * each state, so the LCD reads the same with no page styles
 * (REQ-CRM-BARE-001).
 */
export const Lcd = ({
  alert,
  rows = [],
  menu,
}: {
  alert?: string;
  rows?: Readout[];
  menu?: Menu;
}) => {
  if (!alert && rows.length === 0 && !menu) return null;
  const items = menu?.items ?? [];
  return (
    <div className="lcd">
      <div className="window">
        {alert && <p role="alert">{alert}</p>}
        {rows.length > 0 && (
          <dl className="readout">
            {rows.map(({ label, value, mark }) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className={mark ? 'mark' : undefined}>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {menu &&
          (items.length === 0 ? (
            <p className="empty">{menu.empty}</p>
          ) : (
            <ol
              className="menu"
              data-legend-name={menu.legend[0]}
              data-legend-value={menu.legend[1]}
            >
              {items.map((item) => (
                <li key={item.href}>
                  <a href={item.href} title={item.name}>
                    <span className="arrow" aria-hidden="true" />
                    <span className="name">{item.name}</span>
                    {item.value !== undefined && (
                      <>
                        {' '}
                        <span className="value">{item.value}</span>
                      </>
                    )}
                  </a>
                </li>
              ))}
            </ol>
          ))}
      </div>
    </div>
  );
};
