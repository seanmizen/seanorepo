import type { FC, ReactNode } from 'react';
import { Auto, Dark, Light } from './icons';
import styles from './theme-toggle.module.css';
import type { ThemeMode } from './use-theme';

// The same toggle and icons as seanmizen.com.

type ThemeToggleProps = {
  mode: ThemeMode;
  toggleMode: () => void;
};

const iconMap: Record<ThemeMode, ReactNode> = {
  system: <Auto />,
  dark: <Dark />,
  light: <Light />,
};

const ThemeToggle: FC<ThemeToggleProps> = ({ mode, toggleMode }) => (
  <button
    type="button"
    onClick={toggleMode}
    // A tap on the toggle must not reach the game as a jump.
    onPointerDown={(e) => e.stopPropagation()}
    aria-label={`Current theme: ${mode}. Click to change.`}
    className={styles.toggle}
  >
    {iconMap[mode]}
  </button>
);

export { ThemeToggle };
