import type { FC } from 'react';
import { Code, Entity, EntityList, ExternalLink } from '@/components';
import styles from './github.module.css';

const Github: FC = () => {
  return (
    <div>
      <EntityList>
        <Entity>
          {/* Was aria-label="Github URL" over link text "github.com/seanmizen"
              — the same WCAG 2.5.3 mismatch as the projects list, and it was
              also missing rel on an off-site link. */}
          <ExternalLink href="https://github.com/seanmizen">
            github.com/seanmizen
          </ExternalLink>
        </Entity>
      </EntityList>
      <div>
        <Code content={'// i am testing out\n// how to display code nicely'} />
        <Code
          commandLine
          content={
            '# the ten files this repo edits the most\n' +
            'git log --format=format: --name-only --no-merges \\\n' +
            '  | grep . | sort | uniq -c | sort -rn | head -10'
          }
        />
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
