import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { BareText } from './BareText';

/**
 * A key: a raised `<button>` that moves when pressed. It submits its form
 * unless `type` says otherwise.
 *
 * `off` is the reason that the key cannot act now (REQ-CRM-BUTTON-001). The
 * key stays in its place, with the native `disabled`, and the reason is in
 * its `title` (the hover text) and in its accessible description: an
 * `aria-describedby` to a text with the id `<id>-why`. With no page styles,
 * that text shows after the key. A key with `off` needs an `id`. When the
 * page already shows the reason as a text, give the id of that text as
 * `aria-describedby`, and the key adds no second text.
 */
export const Key = ({
  type = 'submit',
  off,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { off?: string }) => {
  if (off === undefined) {
    return <button type={type} className="key" {...props} />;
  }
  if (!props.id) throw new Error('A key with a reason (off) needs an id.');
  const shown = props['aria-describedby'];
  const why = shown ?? `${props.id}-why`;
  const button = (
    <button
      type={type}
      className="key"
      {...props}
      disabled
      title={off}
      aria-describedby={why}
    />
  );
  if (shown) return button;
  return (
    <>
      {button} <BareText id={why}>{off}</BareText>
    </>
  );
};

/**
 * A row of keys. The keys share the row in whole parts, as on the grid of
 * autosam. With `grid`, the keys go three to a row on a grid of 6 columns,
 * and a short last row shares its row in halves or in one whole: five keys
 * are a row of 3, then a row of 2. With `four`, the keys go four to a row
 * on a wide screen, and three to a row on a narrow screen. Each key keeps
 * its width, so a short last row has a gap at its end.
 */
export const Keys = ({
  grid = false,
  four = false,
  children,
}: {
  grid?: boolean;
  four?: boolean;
  children: ReactNode;
}) => (
  <div className={four ? 'keys four' : grid ? 'keys grid' : 'keys'}>
    {children}
  </div>
);
