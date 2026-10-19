import type { FC, ReactNode } from 'react';
import styles from './subtitle.module.css';

interface SubtitleProps {
  children: ReactNode;
  /** A heading for the list under it, or a plain line of text. */
  as?: 'h2' | 'p';
}

/**
 * A dim line that introduces the entities under it. It sits in the chevron
 * column with a "-" marker: the same place and weight as a static chevron,
 * but it never moves, because a subtitle is not something to interact with.
 */
const Subtitle: FC<SubtitleProps> = ({ children, as: Tag = 'p' }) => (
  <Tag className={styles.subtitle}>{children}</Tag>
);

export { Subtitle };
