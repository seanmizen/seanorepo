import type { FC, ReactNode } from 'react';
import styles from './entity-list.module.css';

interface EntityListProps {
  children: ReactNode;
  /** Lay the entities out side by side instead of stacked. */
  row?: boolean;
  className?: string;
}

/** A list of entities. Owns nothing but layout — the chevron lives on Entity. */
const EntityList: FC<EntityListProps> = ({ children, row, className }) => (
  <ul
    className={[styles.list, row && styles.row, className]
      .filter(Boolean)
      .join(' ')}
  >
    {children}
  </ul>
);

interface EntityProps {
  children: ReactNode;
  /** Points the chevron backwards, for links that retrace a step. */
  back?: boolean;
  className?: string;
}

/**
 * One entity, marked with a chevron. Whether the chevron is the static or the
 * interactive kind is worked out from the children — see entity-list.module.css.
 */
const Entity: FC<EntityProps> = ({ children, back, className }) => (
  <li
    className={[styles.item, back && styles.back, className]
      .filter(Boolean)
      .join(' ')}
  >
    {children}
  </li>
);

export { Entity, EntityList };
