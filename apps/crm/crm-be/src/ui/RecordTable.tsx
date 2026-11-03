import type { ReactNode } from 'react';

/**
 * A table of records, in a `Box`. `head` names each column. With
 * `rowHeader`, the first cell of each row is its `<th scope="row">`. Each
 * other cell has its column name in `data-label`, so on a narrow screen each
 * row is a block of lines, each line with its column name before it.
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
