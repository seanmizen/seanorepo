export type ThemeMode = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

export interface ThemeContextValue {
  mode: ThemeMode;
  theme: Theme;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
}
