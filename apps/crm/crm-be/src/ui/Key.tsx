import type { ButtonHTMLAttributes } from 'react';

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
