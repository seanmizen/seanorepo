import type { FC } from 'react';
import { HomeLink, Spacer } from '@/components';
import { Projects } from '@/features';
import styles from './apps.module.css';

/*
  No skip link here any more. It was `<a href="#main-content" class="skip-link">`
  against a `.skip-link` rule that does not exist anywhere in the codebase, so
  it rendered as an ordinary visible link — and its target was the <h1> on the
  very next line, so it skipped nothing even when used. WCAG 2.4.1 Bypass
  Blocks asks for a way past content *repeated across pages*; this page has no
  such block, and <main> is already a landmark for anyone navigating by them.
*/
const Apps: FC = () => (
  <main className="container">
    <h1 className={styles.static}>seanmizen.com</h1>
    <h2 className={styles.heading}>projects</h2>
    <Projects />
    <Spacer />
    <nav aria-label="Site">
      <HomeLink />
    </nav>
  </main>
);

export { Apps };
