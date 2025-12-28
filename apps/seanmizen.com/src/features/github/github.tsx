import type { FC } from 'react';
import { Code } from '@/components';
import styles from './github.module.css';

const Github: FC = () => {
  return (
    <div>
      <a aria-label="Github URL" href="https://github.com/seanmizen">
        github.com/seanmizen
      </a>
      <div>
        <Code content={'// i am testing out\n// how to display code nicely'} />
        <Code commandLine content='screen -dm bash -c "yes > .brick"' />
      </div>
      <div>
        below, you&apos;ll see me try out some vibrant colours using{' '}
        <em>display-p3</em> (safari only - feb 2022).
        <br />
        on your device these might all look the same!
      </div>
      <div
        className={styles['p3-test']}
        role="img"
        aria-label="Color comparison swatches showing standard RGB vs display-p3 colors"
      >
        <span className={styles['salmon-pink']} aria-hidden="true" />
        <span className={styles['p3-salmon-pink']} aria-hidden="true" />
        <span className={styles['pinkest-pink']} aria-hidden="true" />
        <span className={styles['p3-pinkest-pink']} aria-hidden="true" />
        <span className={styles['greenest-green']} aria-hidden="true" />
        <span className={styles['p3-greenest-green']} aria-hidden="true" />
        <span className={styles['reddest-red']} aria-hidden="true" />
        <span className={styles['p3-reddest-red']} aria-hidden="true" />
      </div>
    </div>
  );
};

export { Github };
