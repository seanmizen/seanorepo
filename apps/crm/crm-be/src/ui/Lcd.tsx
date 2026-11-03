import type { ReactNode } from 'react';
import { Led } from './Led';

/** One read-out row: a label, a value, and an LED if `led` is set. */
export interface Readout {
  label: string;
  value: ReactNode;
  /** Lit when true, dark when false, absent when undefined. */
  led?: boolean;
}

/** One row of a menu: a link to a record. */
export interface MenuItem {
  href: string;
  name: string;
  /** The value at the right of the name, for example a date. */
  value?: ReactNode;
  /** The second line, under the name. */
  detail?: ReactNode;
  /** The status at the right of the detail, with an LED if `led` is set. */
  status?: ReactNode;
  led?: boolean;
}

/** A menu: the records to pick from, with a legend over each column. */
export interface Menu {
  legend: [string, string];
  items: MenuItem[];
  /** The text when `items` is empty. */
  empty: string;
}

/**
 * The LCD of the device: a glass on a faceplate, as the display of autosam.
 * It shows data, or a menu. It never holds the page title, help text or a
 * form control.
 *
 * - `alert`: a message about the last action, for example a form error. It
 *   comes first, with a lit LED, in a `role="alert"` paragraph.
 * - `rows`: the read-out, as a `<dl>`: a label and a value in each row.
 * - `menu`: a list of records. Each row is a link, as each song in the
 *   track list of autosam. The menu is the only part of the LCD that a
 *   person can tap.
 *
 * With nothing to show, the LCD is absent. Text carries each value and each
 * state, so the LCD reads the same with no page styles (REQ-CRM-BARE-001).
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
  return (
    <div className="lcd">
      <div className="glass">
        {alert && <p role="alert">{alert}</p>}
        {rows.length > 0 && (
          <dl className="readout">
            {rows.map(({ label, value, led }) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  {led === undefined ? value : <Led on={led}>{value}</Led>}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {menu &&
          (menu.items.length === 0 ? (
            <p className="empty">{menu.empty}</p>
          ) : (
            <ol
              className="menu"
              data-legend-name={menu.legend[0]}
              data-legend-value={menu.legend[1]}
            >
              {menu.items.map((item) => (
                <li key={item.href}>
                  <a href={item.href}>
                    <span className="name">{item.name}</span>
                    {item.value !== undefined && (
                      <>
                        {' '}
                        <span className="value">{item.value}</span>
                      </>
                    )}
                    {item.detail !== undefined && (
                      <>
                        {' '}
                        <span className="detail">{item.detail}</span>
                      </>
                    )}
                    {item.status !== undefined && (
                      <>
                        {' '}
                        <span className="status">
                          {item.led === undefined ? (
                            item.status
                          ) : (
                            <Led on={item.led}>{item.status}</Led>
                          )}
                        </span>
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
