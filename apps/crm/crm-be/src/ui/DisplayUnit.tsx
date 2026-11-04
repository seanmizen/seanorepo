import type { ReactNode } from 'react';
import { Key } from './Key';
import { Unit } from './Rack';

/** One line under the value of a reading. */
export interface ReadingLine {
  value: ReactNode;
  /**
   * True shows the status mark before the line: a solid circle in the ink
   * of the glass, which blinks. Use it only for overdue or an alert. The
   * line must tell the same state in text, for example "2 days overdue".
   */
  mark?: boolean;
}

/** One reading of the strip: a legend over a value. */
export interface Reading {
  /** The legend, printed over the value. */
  label: string;
  value: ReactNode;
  /**
   * The size of the value. `name` is the one large value of the glass, with
   * the widest cell. `count` is a large number in a narrow cell. `text` is
   * the default.
   */
  kind?: 'name' | 'count' | 'text';
  /**
   * The lines under the value. A reading has the same number of lines in
   * each state, so the glass keeps its height when the data changes
   * (REQ-CRM-MORPH-001).
   */
  lines?: ReadingLine[];
}

/**
 * A key on the plate of the display unit, with its caption under it
 * (REQ-CRM-BUTTON-001). The caption tells what the key acts on (Page 2 of
 * 3), or why the key is off (First page).
 */
export interface PlateKey {
  /** The id of the key. Its caption has the id `<id>-caption`. */
  id: string;
  /** The text on the key. */
  label: string;
  /** What the key acts on, or with `off`, why it cannot act. */
  caption: string;
  /** True: the key is off, and its caption is the reason. */
  off?: boolean;
  /** The target of a key that is a link. */
  href?: string;
  /** The `rel` of a link, for example `prev` or `next`. */
  rel?: string;
  /**
   * The form of a key that submits: its action, its method and its hidden
   * fields.
   */
  form?: {
    action: string;
    method: 'get' | 'post';
    fields?: Record<string, string>;
  };
}

/** The control of one plate key: a link, a submit key, or a key that is off. */
const PlateControl = ({
  id,
  label,
  caption,
  off,
  href,
  rel,
  form,
}: PlateKey) => {
  const captionId = `${id}-caption`;
  if (off || (!href && !form)) {
    return (
      <Key type="button" id={id} off={caption} aria-describedby={captionId}>
        {label}
      </Key>
    );
  }
  if (href) {
    return (
      <a
        className="key"
        id={id}
        href={href}
        rel={rel}
        aria-describedby={captionId}
      >
        {label}
      </a>
    );
  }
  return (
    <form method={form?.method} action={form?.action}>
      {Object.entries(form?.fields ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Key id={id} aria-describedby={captionId}>
        {label}
      </Key>
    </form>
  );
};

/**
 * The display unit: the first unit of the rack. It is the glass as one
 * wide strip of readings, with the plate keys at its right
 * (`apps/crm/docs/002-rack.md`).
 *
 * - `alert`: the line of a save or an error. It is the first line of the
 *   glass, after the status mark. A page that can show a save or an error
 *   gives `null` when it has none, so the line is always present and the
 *   glass keeps its height (REQ-CRM-MORPH-001). A page that never shows one
 *   leaves it out.
 * - `readings`: the read-out, as a `<dl>`. Each reading is a legend over a
 *   value, with faint rules between the readings. Each value and each line
 *   is one line high: a text that does not fit ends in an ellipsis.
 * - `keys`: the plate keys, each with a caption under it.
 *
 * The rules of the glass (REQ-CRM-LCD-002): no LED is inside the glass, and
 * the blinking ink mark is the only mark in it. LEDs are on metal only: the
 * plate and the tops of keys. The glass holds no form control, no link and
 * no heading. Text carries each value and each state, so the unit reads the
 * same with no page styles (REQ-CRM-BARE-001).
 */
export const DisplayUnit = ({
  alert,
  readings,
  keys = [],
}: {
  alert?: string | null;
  readings: Reading[];
  keys?: PlateKey[];
}) => (
  <Unit kind="display">
    <div className="faceplate">
      <div className="glass">
        {alert !== undefined && (
          <p role="alert" className={alert ? 'status' : 'status empty'}>
            {alert}
          </p>
        )}
        <dl className="strip">
          {readings.map(({ label, value, kind = 'text', lines = [] }) => (
            <div key={label} className={kind}>
              <dt>{label}</dt>
              <dd className="value">{value}</dd>
              {lines.map((line, i) => (
                <dd
                  // biome-ignore lint/suspicious/noArrayIndexKey: the lines of a reading have a fixed order.
                  key={i}
                  className={line.mark ? 'line mark' : 'line'}
                >
                  {line.value}
                </dd>
              ))}
            </div>
          ))}
        </dl>
      </div>
      {keys.length > 0 && (
        <div className="plate">
          {keys.map((key) => (
            <div key={key.id} className="plate-key">
              <PlateControl {...key} />{' '}
              <span className="caption" id={`${key.id}-caption`}>
                {key.caption}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  </Unit>
);
