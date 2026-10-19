import type { FC, ReactNode } from 'react';
import styles from './subtitle.module.css';

interface SubtitleProps {
  children: ReactNode;
}

/**
 * A dim heading for the entities under it. It hugs the left edge, as the
 * title does.
 */
const Subtitle: FC<SubtitleProps> = ({ children }) => (
  <h2 className={styles.subtitle}>{children}</h2>
);

export { Subtitle };
