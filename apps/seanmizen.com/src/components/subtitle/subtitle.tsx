import type { FC, ReactNode } from 'react';
import styles from './subtitle.module.css';

interface SubtitleProps {
  children: ReactNode;
  /** A heading for the list under it, or a plain line of text. */
  as?: 'h2' | 'p';
}

/**
 * A dim line that introduces the entities under it. It hugs the left edge,
 * as the title does.
 */
const Subtitle: FC<SubtitleProps> = ({ children, as: Tag = 'p' }) => (
  <Tag className={styles.subtitle}>{children}</Tag>
);

export { Subtitle };
