import { createContext, useContext } from 'react';
import type { EffectiveMode, ThemeMode } from './theme';

export interface ThemeModeContextValue {
  /** What the user chose: light, dark, or follow the OS. */
  mode: ThemeMode;
  /** What that resolves to right now. */
  effectiveMode: EffectiveMode;
  setMode: (mode: ThemeMode) => void;
  /** Cycles light → dark → auto → light. */
  toggleMode: () => void;
}

export const ThemeModeContext = createContext<ThemeModeContextValue>({
  mode: 'auto',
  effectiveMode: 'light',
  setMode: () => {},
  toggleMode: () => {},
});

export const useThemeMode = (): ThemeModeContextValue =>
  useContext(ThemeModeContext);
