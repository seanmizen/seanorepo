import type { FC } from 'react';
import { Link } from 'react-router-dom';
import { Entity, EntityList } from '@/components';
import styles from './intentionality.module.css';
import { stories } from './stories';

/* The home page section: what this is, and a link to each story. */
const Intentionality: FC = () => (
  <>
    <p className={styles.subtitle}>how I get results from AI</p>
    <EntityList>
      {stories.map((story) => (
        <Entity key={story.slug}>
          <Link to={`/${story.slug}`}>{story.title}</Link>
          <span className={styles.blurb}> - {story.summary}</span>
        </Entity>
      ))}
    </EntityList>
  </>
);

export { Intentionality };
