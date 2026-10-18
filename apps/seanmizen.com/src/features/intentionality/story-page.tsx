import type { FC } from 'react';
import { Link } from 'react-router-dom';
import { HomeLink, Spacer } from '@/components';
import { Sample } from './sample';
import styles from './story-page.module.css';
import type { Story } from './types';

/* A story, stage by stage: Sean's messages as he wrote them, Claude's
   notes, and each stage's code running in a frame. */
const StoryPage: FC<{ story: Story }> = ({ story }) => (
  <main className="container">
    <h1 className={styles.static}>seanmizen.com</h1>
    <h2 className={styles.heading}>intentionality</h2>
    <p className={styles.subtitle}>how I get results from AI</p>
    <h3 className={styles.title}>{story.title}</h3>
    <p className={styles.summary}>{story.summary}</p>
    <ol className={styles.stages}>
      {story.stages.map((stage, i) => (
        <li key={stage.title} className={styles.stage}>
          <h4 className={styles.stageTitle}>
            {i}. {stage.title}
          </h4>
          {stage.messages.map((message) =>
            message.from === 'sean' ? (
              <blockquote key={message.text} className={styles.sean}>
                <span className={styles.who}>sean</span>
                <p className={styles.words}>{message.text}</p>
              </blockquote>
            ) : (
              <p key={message.text} className={styles.claude}>
                <span className={styles.who}>claude</span> {message.text}
              </p>
            ),
          )}
          {stage.sample && (
            <Sample
              src={`/sample-${story.id}-${stage.sample}.html`}
              title={`${story.title}, stage ${i}: ${stage.title}`}
            />
          )}
        </li>
      ))}
    </ol>
    <p className={styles.summary}>
      The last stage is frozen too. The site keeps changing:{' '}
      <Link to="/projects">see it live</Link>.
    </p>
    <Spacer />
    <nav aria-label="Site">
      <HomeLink />
    </nav>
  </main>
);

export { StoryPage };
