import type { FC } from 'react';
import { useState } from 'react';
import styles from './story-page.module.css';

type SampleProps = {
  /* The stage's own page: /sample-<story>-<stage>.html. */
  src: string;
  title: string;
};

/* A frozen stage, running in a sandboxed frame. It starts only when the
   reader asks: each stage runs a full particle sim, and a page of them
   all at once would be heavy. */
const Sample: FC<SampleProps> = ({ src, title }) => {
  const [running, setRunning] = useState(false);
  return (
    <div className={styles.sample}>
      <div className={styles.frame}>
        {running ? (
          <iframe
            src={src}
            title={title}
            sandbox="allow-scripts allow-same-origin allow-popups"
            allow="clipboard-write"
          />
        ) : (
          <button
            type="button"
            className={styles.run}
            onClick={() => setRunning(true)}
          >
            run this stage
          </button>
        )}
      </div>
      <div className={styles.controls}>
        {running && (
          <button type="button" onClick={() => setRunning(false)}>
            stop
          </button>
        )}
        <a href={src} target="_blank" rel="noreferrer">
          open full size
        </a>
      </div>
    </div>
  );
};

export { Sample };
