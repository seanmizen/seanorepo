import styles from './Apps.module.css';
import { Projects } from '../../features';
import { HomeLink, Spacer } from '../../components';

function Apps() {
  return (
    <div className={'container'}>
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
}

export default Apps;
