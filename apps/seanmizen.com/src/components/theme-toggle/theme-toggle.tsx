import type { FC, ReactNode } from 'react';
import type { ThemeMode } from '@/types';
import { Auto, Dark, Light } from './icons';
import styles from './theme-toggle.module.css';

interface ThemeToggleProps {
  mode: ThemeMode;
  toggleMode: () => void;
}

const iconMap: Record<ThemeMode, ReactNode> = {
  system: <Auto />,
  dark: <Dark />,
  light: <Light />,
};

const ThemeToggle: FC<ThemeToggleProps> = ({ mode, toggleMode }) => {
  return (
    <button
      type="button"
      onClick={toggleMode}
      aria-label={`Current theme: ${mode}. Click to change.`}
      className={styles['theme-toggle-button']}
      // A small icon needs little clear space. A wide one here would fade
      // the thrown face, which rests beside it.
      data-mask="tight"
    >
      {iconMap[mode]}
    </button>
  );
};

export { ThemeToggle };
