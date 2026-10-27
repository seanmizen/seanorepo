import type { CSSProperties, FC } from 'react';
import { useContext } from 'react';
import { ThemeContext } from '@/providers';
import action from './assets/action.webp';
import autosamLoop from './assets/autosam-loop.webp';
import caroline from './assets/caroline.png';
import seanmizenDark from './assets/seanmizen-dark.webp';
import seanmizenLight from './assets/seanmizen-light.webp';
import shist from './assets/shist.webp';
import styles from './thumbs.module.css';

/* One picture per project. Each one fills a 16:10 box, so every preview
   page can show it at any size. */

/* The autosam LCD alone, cut from a loop of the whole screen while
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

/* Sean's own capture of a deathmatch at the Tube station. A small window
   makes the HUD large in the frame. */
const Action: FC = () => (
  <div className={styles.thumb}>
    <img className={styles.cover} src={action} alt="" />
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

/* A real zsh session in the Material theme, sized to read in a stamp.
   HOME=./demo starts a shell on a sandbox: a made-up .zsh_history, and a
   .zshrc whose alias sets the time-only format. */
const Shist: FC = () => (
  <div className={styles.thumb}>
    <img className={styles.cover} src={shist} alt="" />
  </div>
);

/* The face after it has settled, in the theme opposite to the page's, so
   it stands out against the page. */
const Seanmizen: FC = () => {
  const { theme } = useContext(ThemeContext);
  return (
    <div className={styles.thumb}>
      <img
        className={styles.cover}
        src={theme === 'dark' ? seanmizenLight : seanmizenDark}
        alt=""
      />
    </div>
  );
};

const THUMBS: Partial<Record<string, FC>> = {
  'https://carolinemizen.art': Caroline,
  'https://autosam.seanmizen.com': Autosam,
  'https://action.seanmizen.com': Action,
  'https://planning-poker.seanmizen.com': Poker,
  'https://github.com/seanmizen/shist': Shist,
  'https://seanmizen.com': Seanmizen,
};

export { THUMBS };
