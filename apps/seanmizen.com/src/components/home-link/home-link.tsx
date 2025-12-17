import type { FC } from 'react';
import { Link } from 'react-router-dom';
import styles from './home-link.module.css';

const HomeLink: FC = () => {
  return (
    <Link className={styles['home-link']} aria-label="Go to home page" to="/">
      go home
    </Link>
  );
};

export { HomeLink };
