import type { FC, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Accordion } from '../accordion';
import styles from './home-li.module.css';

interface HomeLiProps {
  children: ReactNode;
  trigger: string;
  subLink?: string;
}

const HomeLi: FC<HomeLiProps> = ({ children, trigger, subLink }) => {
  return (
    <li className={styles.li}>
      <Accordion trigger={trigger}>
        {subLink && (
          <div className={styles.sublink}>
            <Link to={subLink}>visit</Link>
          </div>
        )}
        {children}
      </Accordion>
    </li>
  );
};

export { HomeLi };
