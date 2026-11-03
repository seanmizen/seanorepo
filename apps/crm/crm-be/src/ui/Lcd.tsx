import type { ReactNode } from 'react';
import { Led } from './Led';

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

/** One row of a menu: a link to a record. */
export interface MenuItem {
  href: string;
  name: string;
  /** The full text of the row, in its `title`. The default is `name`. */
  title?: string;
  /** The value at the right of the name, for example a date. */
  value?: ReactNode;
  /** The second line, under the name. */
  detail?: ReactNode;
  /** The value at the right of the detail. */
  status?: ReactNode;
  /**
   * The LED of the row, in the bezel at its right: lit when true. When one
   * row of a menu has an LED, each row has one. The row must tell the same
   * state in text.
   */
  led?: boolean;
}

/** A menu: the records to pick from, with a legend over each column. */
export interface Menu {
  legend: [string, string];
  /**
   * The legend of the second line of each row: the detail and the status.
   * It shows under `legend`.
   */
  sublegend?: [string, string];
  items: MenuItem[];
  /** The text when `items` is empty. */
  empty: string;
  /**
   * The column that sets the order of the items, and its direction. The
   * legend of that column shows an arrow: `▲` for ascending, `▼` for
   * descending. `text` tells the same order with no page styles, for
   * example "Sorted by next action, oldest first".
   */
  order?: {
    column: 'name' | 'value' | 'status';
    dir: 'asc' | 'desc';
    text: string;
  };
}

/** The arrow of each direction of an order. */
const ARROWS = { asc: '▲', desc: '▼' } as const;

/**
 * The LCD of the device: a glass in a faceplate, as the display of autosam.
 * It shows data, or a menu. It never holds the page title, help text or a
 * form control.
 *
 * - `alert`: a message about the last action, for example a form error. It
 *   comes first, in a `role="alert"` paragraph, after the status mark.
 * - `rows`: the read-out, as a `<dl>`: a label and a value in each row.
 * - `menu`: a list of records. Each row is a link, as each song in the
 *   track list of autosam. The menu is the only part of the LCD that a
 *   person can tap. A long menu scrolls in the window, so the modules under
 *   the LCD stay near.
 *
 * This component owns the rules of the LCD (REQ-CRM-LCD-001):
 *
 * 1. No LED is inside the glass. A status in the glass is the status mark,
 *    a solid circle in the ink of the LCD that blinks slowly.
 * 2. The characters never move. Each menu row starts with the arrow
 *    column. A hover or a focus shows the arrow in it, and changes no
 *    layout.
 * 3. The arrow of the order is in a space that the legend keeps for it.
 *    The name legend keeps the arrow column of the rows. A value or status
 *    legend is aligned right, so an arrow at its left moves no character.
 * 4. The menu rows have one fixed height. A text that does not fit ends
 *    in an ellipsis, and the `title` of the row holds the full text. The
 *    LED of a row is in the bezel, at the right of the row, so the LEDs are
 *    a straight column.
 *
 * The window (`.window`) holds the glass, and the LED column of the bezel
 * at its right. With nothing to show, the LCD is absent. Text carries each
 * value and each state, so the LCD reads the same with no page styles
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
  const leds = items.some((item) => item.led !== undefined);
  const twoLines = items.some(
    (item) => item.detail !== undefined || item.status !== undefined,
  );
  const order = menu?.order;
  /** The legend `text` of `column`, with the arrow when it sets the order. */
  const legend = (column: 'value' | 'status', text: string | undefined) =>
    text !== undefined && order?.column === column
      ? `${ARROWS[order.dir]} ${text}`
      : text;
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
            <>
              {order && <p className="bare-text">{order.text}</p>}
              <ol
                className={['menu', twoLines && 'two-lines', leds && 'leds']
                  .filter(Boolean)
                  .join(' ')}
                data-legend-name={menu.legend[0]}
                data-legend-value={legend('value', menu.legend[1])}
                data-legend-detail={menu.sublegend?.[0]}
                data-legend-status={legend('status', menu.sublegend?.[1])}
                data-order-name={
                  order?.column === 'name' ? order.dir : undefined
                }
              >
                {items.map((item) => (
                  <li key={item.href}>
                    <a href={item.href} title={item.title ?? item.name}>
                      <span className="arrow" aria-hidden="true" />
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
                          <span className="status">{item.status}</span>
                        </>
                      )}
                    </a>
                    {leds && <Led on={item.led === true} />}
                  </li>
                ))}
              </ol>
            </>
          ))}
      </div>
    </div>
  );
};
