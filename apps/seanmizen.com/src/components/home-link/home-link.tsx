import type { FC } from 'react';
import { Link } from 'react-router-dom';
import { Entity, EntityList } from '../entity-list';

/**
 * The way back to the home page.
 *
 * No `aria-label`. The old one read "Go to home page" over link text of "go
 * home", so the accessible name did not contain the visible label — a WCAG
 * 2.5.3 failure, and it broke voice control, where saying the words you can
 * see is the whole interaction. One word that already says where it goes
 * needs no second name.
 */
const HomeLink: FC = () => (
  <EntityList>
    <Entity back>
      <Link to="/">home</Link>
    </Entity>
  </EntityList>
);

export { HomeLink };
