import { Link } from 'react-router-dom';

import styles from './HomeLink.module.css';

function HomeLink() {
  return (
    <Link className={styles['home-link']} alt="visit projects" to="/">
      go home
    </Link>
  );
}

export default HomeLink;
