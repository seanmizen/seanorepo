import type { ReactNode } from 'react';

/**
 * One group of records: history or reference data, as plain text under an
 * `<h2>`. Records are text, not a part of the device: tables, lists and
 * definition lists in the page font, with no panel. On a wide screen they
 * fill the space to the right of the device.
 */
export const Records = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <section className="records">
    <h2>{title}</h2>
    {children}
  </section>
);

/**
 * A table of records. `head` names each column. With `rowHeader`, the first
 * cell of each row is its `<th scope="row">`. Each other cell has its column
 * name in `data-label`, so on a phone each row is a block of lines, each
 * line with its column name before it.
 */
export const RecordTable = ({
  head,
  rows,
  rowHeader = false,
}: {
  head: string[];
  rows: { key: string; cells: ReactNode[] }[];
  rowHeader?: boolean;
}) => (
  <table>
    <thead>
      <tr>
        {head.map((name) => (
          <th key={name} scope="col">
            {name}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {rows.map(({ key, cells }) => (
        <tr key={key}>
          {cells.map((cell, i) =>
            rowHeader && i === 0 ? (
              <th key={head[i]} scope="row">
                {cell}
              </th>
            ) : (
              <td key={head[i]} data-label={head[i]}>
                {cell}
              </td>
            ),
          )}
        </tr>
      ))}
    </tbody>
  </table>
);
