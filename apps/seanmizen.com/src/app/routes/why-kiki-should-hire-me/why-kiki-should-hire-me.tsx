import type { FC } from 'react';
import { SiteTitle } from '@/components';
import styles from './why-kiki-should-hire-me.module.css';

/* The title and column match /projects. The content comes later. */
const WhyKikiShouldHireMe: FC = () => (
  <main className="container">
    <div className={styles.half}>
      <SiteTitle path="why-kiki-should-hire-me" />
    </div>
  </main>
);

export { WhyKikiShouldHireMe };
