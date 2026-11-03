import type { ReactNode } from 'react';
import { Label } from './Label';

/**
 * A panel on the chassis of the page: its label at the top left, its content
 * below. The label is an `<h2>`, so the page has an outline with no page
 * styles.
 */
export const Panel = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <section className="panel">
    <h2>
      <Label>{label}</Label>
    </h2>
    {children}
  </section>
);
