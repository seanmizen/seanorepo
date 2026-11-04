import type { ReactNode } from 'react';
import { BareText } from './BareText';
import { Led } from './Led';

/** The arrow of each direction of an order. */
const ARROWS = { asc: '▲', desc: '▼' } as const;

/** One column of a band, after the gutter, the seam and the name column. */
export interface BandColumn {
  /** The legend over the column. */
  label: string;
  /**
   * The class of the column and of each cell in it, for example `c-due`.
   * The theme gives each class its width, and its place on a phone.
   */
  name: string;
  /** The direction of the order, when this column sets it. */
  order?: 'asc' | 'desc';
}

/** One cell of a row. */
export interface BandCell {
  value: ReactNode;
  /** The full text, for a value that can end in an ellipsis. */
  title?: string;
}

/** One row of a band: one record. */
export interface BandRow {
  /** The link to the record. */
  href: string;
  /** The name of the record: the row header. */
  name: string;
  /** The full text of the row header. The default is `name`. */
  title?: string;
  /**
   * The LED of the row, on the chassis seam at its left: lit when true.
   * The row must tell the same state in text.
   */
  led?: boolean;
  /** One cell for each of the `columns` of the band, in order. */
  cells: BandCell[];
}

/** A group of rows, named in the gutter. */
export interface BandGroup {
  /** The name of the group, for example `Overdue`. */
  name: string;
  /** The number of records in the group, on all pages of the list. */
  count: number;
  rows: BandRow[];
}

/**
 * The band: the data of a page, under the rack, at the full width of the
 * page (`apps/crm/docs/002-rack.md`). It is one wide chart on the chassis,
 * as the chord chart of autosam, with a gutter at the left that names each
 * group of rows.
 *
 * - The band is a `<section>` with an `<h2>` (`title`), then `info` (for
 *   example the order), then a real `<table>`. Each group is a `<tbody>`.
 *   Its gutter cell is a `<th scope="rowgroup">`, and the name of each row
 *   is a `<th scope="row">` (REQ-CRM-BARE-001).
 * - `orderName` is the direction of the order when the name column sets
 *   it. The arrow of the order is in a space that its legend keeps for it:
 *   the arrow column for the name legend, and the end of any other legend.
 *
 * The rules of the rows (REQ-CRM-LCD-002):
 *
 * 1. Each row has one fixed height. A text that does not fit ends in an
 *    ellipsis, and a `title` holds the full text.
 * 2. Each name starts with the arrow column. A hover or a focus shows the
 *    arrow in it, so no character moves.
 * 3. The LED of a row is on the chassis seam at its left: metal, not the
 *    paper of the row. The seam is present on each row of a band with
 *    `seam`. With no page styles, the seam cell says `Yes` or `No` under
 *    its legend.
 * 4. With no rows, the band shows `empty` in one row.
 */
export const Band = ({
  id,
  title,
  info,
  gutter,
  seam,
  nameLabel,
  orderName,
  columns,
  groups,
  empty,
}: {
  /** The id of the `<h2>`, which labels the section. */
  id: string;
  title: string;
  info?: ReactNode;
  /** The legend of the gutter, for example `Due`. */
  gutter: string;
  /** The legend of the LED column, for example `Due now`. No seam when absent. */
  seam?: string;
  /** The legend of the name column. */
  nameLabel: string;
  orderName?: 'asc' | 'desc';
  columns: BandColumn[];
  groups: BandGroup[];
  empty: string;
}) => {
  const span = 2 + (seam ? 1 : 0) + columns.length;
  const rows = groups.filter((group) => group.rows.length > 0);
  return (
    <section className="band" aria-labelledby={id}>
      <div className="band-head">
        <h2 className="label" id={id}>
          {title}
        </h2>
        {info && <p className="info">{info}</p>}
      </div>
      <table className="chart">
        <colgroup>
          <col className="c-gutter" />
          {seam && <col className="c-seam" />}
          <col className="c-name" />
          {columns.map((column) => (
            <col key={column.name} className={column.name} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="c-gutter">
              {gutter}
            </th>
            {seam && (
              <th scope="col" className="c-seam">
                <BareText>{seam}</BareText>
              </th>
            )}
            <th scope="col" className="c-name">
              <span className="arrow" aria-hidden="true">
                {orderName && ARROWS[orderName]}
              </span>
              {nameLabel}
            </th>
            {columns.map((column) => (
              <th key={column.name} scope="col" className={column.name}>
                {column.label}
                {column.order && (
                  <span className="order" aria-hidden="true">
                    {` ${ARROWS[column.order]}`}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        {rows.length === 0 ? (
          <tbody>
            <tr>
              <td colSpan={span} className="empty">
                {empty}
              </td>
            </tr>
          </tbody>
        ) : (
          rows.map((group) => (
            <tbody key={group.name}>
              {group.rows.map((row, i) => (
                <tr key={row.href}>
                  {i === 0 && (
                    <th
                      scope="rowgroup"
                      rowSpan={group.rows.length}
                      className="c-gutter"
                    >
                      <span className="group">{group.name}</span>{' '}
                      <span className="count">{group.count}</span>
                    </th>
                  )}
                  {seam && (
                    <td className="c-seam">
                      <Led on={row.led === true} />
                      <BareText>{row.led ? 'Yes' : 'No'}</BareText>
                    </td>
                  )}
                  <th
                    scope="row"
                    className="c-name"
                    title={row.title ?? row.name}
                  >
                    <a href={row.href}>
                      <span className="arrow" aria-hidden="true" />
                      {row.name}
                    </a>
                  </th>
                  {row.cells.map((cell, n) => (
                    <td
                      key={columns[n]?.name ?? n}
                      className={columns[n]?.name}
                      title={cell.title}
                    >
                      {cell.value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))
        )}
      </table>
    </section>
  );
};
