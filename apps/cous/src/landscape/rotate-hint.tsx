import { type FC, useState } from 'react';
import styles from './rotate-hint.module.css';

/**
 * Asks the player to turn the phone sideways. The CSS shows it only on a
 * touch device in portrait, so it needs no orientation code.
 */
const RotateHint: FC = () => {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className={styles.overlay} role="dialog" aria-label="Turn your phone">
      <svg
        className={styles.phone}
        viewBox="0 0 24 24"
        width="64"
        height="64"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <rect x="7" y="2" width="10" height="20" rx="2" />
        <line x1="11" y1="18.5" x2="13" y2="18.5" />
      </svg>
      <p>turn your phone sideways</p>
      <button
        type="button"
        className={styles.dismiss}
        onClick={() => setDismissed(true)}
      >
        play upright
      </button>
    </div>
  );
};

export { RotateHint };
