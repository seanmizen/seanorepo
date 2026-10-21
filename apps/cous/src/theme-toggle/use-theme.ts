import { useEffect, useState } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'cous:mode';
const MODES: ThemeMode[] = ['system', 'light', 'dark'];

const readMode = (): ThemeMode => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return MODES.includes(stored as ThemeMode)
      ? (stored as ThemeMode)
      : 'system';
  } catch {
    return 'system';
  }
};

const systemTheme = (): Theme =>
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

/**
 * The theme mode (system, light or dark) and the theme that results.
 * The mode persists in localStorage. The page colour scheme follows the
 * theme (`data-theme` on <html>, see index.css).
 */
const useTheme = () => {
  const [mode, setMode] = useState<ThemeMode>(readMode);
  const [theme, setTheme] = useState<Theme>(() =>
    mode === 'system' ? systemTheme() : mode,
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // The mode then lasts for this page load only.
    }
    if (mode !== 'system') {
      setTheme(mode);
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setTheme(media.matches ? 'dark' : 'light');
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [mode]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggleMode = () =>
    setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);

  return { mode, theme, toggleMode };
};

export { useTheme };
