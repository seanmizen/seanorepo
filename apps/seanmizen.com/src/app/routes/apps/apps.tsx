import type { FC } from 'react';
import { HomeLink, Spacer } from '@/components';
import { Projects } from '@/features';
import styles from './apps.module.css';

const Apps: FC = () => {
  return (
    <main className="container">
      <h1 className={styles['no-animation']}>seanmizen.com</h1>
      <h2>current projects:</h2>
      <div className={styles['padded-left']}>
        <Projects />
      </div>
      <Spacer />
      <nav>
        <HomeLink />
      </nav>
    </main>
  );
};

export { Apps };
