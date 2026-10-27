import type { CSSProperties, FC } from 'react';
import autosamLoop from './assets/autosam-loop.webp';
import caroline from './assets/caroline.png';
import seanmizen from './assets/seanmizen.png';
import styles from './thumbs.module.css';

/* One picture per project. Each one fills a 16:10 box, so every preview
   mode can show it at any size. */

/* The autosam LCD alone, cut from a loop of the whole display while
   Piano Man plays. The loop is a strip of frames that a CSS animation
   steps through. */
const Autosam: FC = () => (
  <div className={`${styles.thumb} ${styles.autosam}`}>
    <div className={styles.lcd}>
      <div
        className={styles.lcdFrames}
        style={{ backgroundImage: `url(${autosamLoop})` }}
      />
    </div>
  </div>
);

const Caroline: FC = () => (
  <div className={styles.thumb}>
    <img className={styles.cover} src={caroline} alt="" />
  </div>
);

/* Headless Chrome has no WebGPU, so this is a drawn card, not a capture. */
const Action: FC = () => (
  <div className={`${styles.thumb} ${styles.action}`}>
    <span className={styles.hudTop}>DEATHMATCH · 04:59</span>
    <svg className={styles.crosshair} viewBox="0 0 40 40" aria-hidden="true">
      <path d="M20 4v10M20 26v10M4 20h10M26 20h10" />
      <circle cx="20" cy="20" r="1.6" />
    </svg>
    <span className={styles.hudBottom}>
      <b>100</b> HP<span>30 / 90</span>
    </span>
  </div>
);

const POKER = ['1', '2', '3', '5', '8'];

const Poker: FC = () => (
  <div className={`${styles.thumb} ${styles.poker}`}>
    {POKER.map((n, k) => (
      <span
        key={n}
        className={styles.card}
        style={{ '--k': k - 2 } as CSSProperties}
      >
        {n}
      </span>
    ))}
  </div>
);

const SHIST = [
  ['14:02', 'yarn fix'],
  ['14:03', 'git push -u origin HEAD'],
  ['14:09', 'docker compose up --build'],
  ['14:11', 'zig build -Doptimize=ReleaseFast'],
];

const Shist: FC = () => (
  <div className={`${styles.thumb} ${styles.shist}`}>
    <div className={styles.prompt}>
      <span>$</span> shist <i>--today</i>
    </div>
    {SHIST.map(([at, cmd]) => (
      <div key={at} className={styles.line}>
        <span>{at}</span> {cmd}
      </div>
    ))}
    <span className={styles.caret} />
  </div>
);

const Seanmizen: FC = () => (
  <div className={`${styles.thumb} ${styles.seanmizen}`}>
    <img src={seanmizen} alt="" />
  </div>
);

const THUMBS: Partial<Record<string, FC>> = {
  'https://carolinemizen.art': Caroline,
  'https://autosam.seanmizen.com': Autosam,
  'https://action.seanmizen.com': Action,
  'https://planning-poker.seanmizen.com': Poker,
  'https://github.com/seanmizen/shist': Shist,
  'https://seanmizen.com': Seanmizen,
};

export { THUMBS };
