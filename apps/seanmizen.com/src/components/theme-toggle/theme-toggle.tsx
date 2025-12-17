import type { FC } from 'react';
import type { ThemeMode } from '../../types';
import styles from './theme-toggle.module.css';

interface ThemeToggleProps {
  mode: ThemeMode;
  toggleMode: () => void;
}

const ThemeToggle: FC<ThemeToggleProps> = ({ mode, toggleMode }) => {
  return (
    <div className={styles['theme-toggle-outer']}>
      <div className={styles['theme-toggle-inner']}>
        <button
          type="button"
          onClick={toggleMode}
          aria-label={`Current theme: ${mode}. Click to change.`}
        >
          {`\xa0theme: ${mode}\xa0`.replace('system', 'auto')}
        </button>
      </div>
    </div>
  );
};

export { ThemeToggle };
