import { useState, useEffect, createContext } from 'react';

const localStorageKey = 'mode';
const modes = ['system', 'light', 'dark'];

const saveMode = async mode => {};

export const ThemeContext = createContext({
  mode: 'system',
  theme: 'light',
  setMode: () => {},
  toggleMode: () => {},
});

export const ThemeProvider = ({ children }) => {
  const [mode, setMode] = useState(() => localStorage.getItem(localStorageKey) || 'system');
  const [theme, setTheme] = useState(() =>
    mode !== 'system'
      ? mode
      : window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light',
  );

  useEffect(() => {
    localStorage.setItem(localStorageKey, mode);
    saveMode(mode);
  }, [mode]);

  // Update theme according to mode and system changes
  useEffect(() => {
    if (mode !== 'system') {
      setTheme(mode);
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = e => setTheme(e.matches ? 'dark' : 'light');
    handler(media);
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, [mode]);

  // Update UI classes and meta tag
  useEffect(() => {
    document.body.classList.remove('light', 'dark');
    document.body.classList.add(theme);
    const meta = document.getElementById('colorScheme');
    if (meta) meta.content = theme;
  }, [theme]);

  const toggleMode = () => setMode(modes[(modes.indexOf(mode) + 1) % modes.length]);

  return (
    <ThemeContext.Provider value={{ theme, mode, setMode, toggleMode }}>
      {children}
    </ThemeContext.Provider>
  );
};
