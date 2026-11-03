import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * A key: a raised `<button>` that moves when pressed. It submits its form
 * unless `type` says otherwise.
 */
export const Key = ({
  type = 'submit',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button type={type} className="key" {...props} />
);

/**
 * A row of keys. The keys share the row in whole parts, as on the grid of
 * autosam. With `grid`, the keys go three to a row on a grid of 6 columns,
 * and a short last row shares its row in halves or in one whole: five keys
 * are a row of 3, then a row of 2.
 */
export const Keys = ({
  grid = false,
  children,
}: {
  grid?: boolean;
  children: ReactNode;
}) => <div className={grid ? 'keys grid' : 'keys'}>{children}</div>;
