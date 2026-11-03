import type { ReactNode } from 'react';

/**
 * A box: one section of the data of a page, for example Contacts or
 * Activity (REQ-CRM-LAYOUT-001). It is a white box with a silkscreen title,
 * as the boxes at the right of the autosam library. `renderPage` puts the
 * boxes of a page on one chassis: at the right of the device on a wide
 * screen, and under it on a narrow screen.
 *
 * The text in a box is plain text in the page font: tables, lists and
 * definition lists. It is not a part of the device. A box can hold links,
 * buttons and forms. The title is an `<h2>`, so the page has an outline
 * with no page styles.
 */
export const Box = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <section className="box">
    <h2 className="label">{title}</h2>
    {children}
  </section>
);
