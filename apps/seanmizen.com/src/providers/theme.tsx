import type { FC, ReactNode } from 'react';
import { createContext, useEffect, useState } from 'react';
import type { Theme, ThemeContextValue, ThemeMode } from '@/types';

const localStorageKey = 'mode';
const modes: ThemeMode[] = ['system', 'light', 'dark'];

export const ThemeContext = createContext<ThemeContextValue>({
  mode: 'system',
  theme: 'light',
  setMode: () => {},
  toggleMode: () => {},
});

interface ThemeProviderProps {
  children: ReactNode;
}

const ThemeProvider: FC<ThemeProviderProps> = ({ children }) => {
  const [mode, setMode] = useState<ThemeMode>(
    () => (localStorage.getItem(localStorageKey) as ThemeMode) || 'system',
  );
  const [theme, setTheme] = useState<Theme>(() =>
    mode !== 'system'
      ? mode
      : window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light',
  );

  useEffect(() => {
    localStorage.setItem(localStorageKey, mode);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'system') {
      setTheme(mode);
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) =>
      setTheme(e.matches ? 'dark' : 'light');
    handler(media as unknown as MediaQueryListEvent);
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, [mode]);

  useEffect(() => {
    document.body.classList.remove('light', 'dark');
    document.body.classList.add(theme);
    const meta = document.getElementById('colorScheme');
    if (meta) meta.setAttribute('content', theme);
  }, [theme]);

  const toggleMode = () =>
    setMode(modes[(modes.indexOf(mode) + 1) % modes.length]);

  return (
    <ThemeContext.Provider value={{ theme, mode, setMode, toggleMode }}>
      {children}
    </ThemeContext.Provider>
  );
};

export { ThemeProvider };
