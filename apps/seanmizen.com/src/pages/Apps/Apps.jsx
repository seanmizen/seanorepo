import { HomeLink, Spacer } from '../../components';
import { Projects } from '../../features';

import styles from './Apps.module.css';

const Apps = () => {
  return (
    <div className="container">
      <h1 className={styles['no-animation']}>seanmizen.com</h1>
      <h2 className={styles['']}>current projects:</h2>
      <div className={styles['padded-left']}>
        <Projects />
      </div>
      {/* TODO move Spacer / HomeLink into a nav-style component which is on all pages but Home */}
      <Spacer />
      <HomeLink />
    </div>
  );
};

export { Apps };
