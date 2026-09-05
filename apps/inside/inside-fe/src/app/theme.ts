import { createTheme, type Theme } from '@mui/material';

export type ThemeMode = 'light' | 'dark' | 'auto';
export type EffectiveMode = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'theme-mode';

const isThemeMode = (value: unknown): value is ThemeMode =>
  value === 'light' || value === 'dark' || value === 'auto';

export const getInitialMode = (): ThemeMode => {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(stored) ? stored : 'auto';
  } catch {
    // Private mode / blocked storage — fall back to following the OS.
    return 'auto';
  }
};

export const prefersDark = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches;

export const getEffectiveMode = (mode: ThemeMode): EffectiveMode =>
  mode === 'auto' ? (prefersDark() ? 'dark' : 'light') : mode;

/**
 * A restrained, gallery-ish palette: warm stone neutrals carrying the page and
 * a single muted brass accent. Deliberately low-chroma — the artwork on this
 * site is the photography, and a loud UI competes with it.
 *
 * The full editorial identity (type scale, custom faces, spacing rhythm) is
 * SEAN-150; this is the neutral base it replaces.
 */
export const buildTheme = (effectiveMode: EffectiveMode): Theme => {
  const isDark = effectiveMode === 'dark';

  return createTheme({
    palette: {
      mode: effectiveMode,
      background: {
        default: isDark ? '#121110' : '#faf9f7',
        paper: isDark ? '#1c1a18' : '#ffffff',
      },
      text: {
        primary: isDark ? '#ece8e2' : '#1a1a18',
        secondary: isDark ? '#a39d94' : '#6b6660',
      },
      primary: {
        main: isDark ? '#c2a068' : '#8a6f47', // brass
        light: isDark ? '#d8bd8d' : '#a98b5f',
        dark: isDark ? '#9a7c46' : '#6a5334',
        contrastText: isDark ? '#121110' : '#ffffff',
      },
      secondary: {
        main: isDark ? '#8f9d93' : '#5c6b61', // eucalyptus
        contrastText: isDark ? '#121110' : '#ffffff',
      },
      divider: isDark ? 'rgba(236, 232, 226, 0.12)' : 'rgba(26, 26, 24, 0.12)',
    },
    typography: {
      // Headings in a serif to read as editorial rather than dashboard.
      h1: { fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 400 },
      h2: { fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 400 },
      h3: { fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 400 },
      h4: { fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 400 },
    },
    shape: { borderRadius: 2 },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          '*, *::before, *::after': {
            transitionProperty:
              'color, background-color, border-color, box-shadow, fill, stroke',
            transitionDuration: '100ms',
            transitionTimingFunction: 'ease',
          },
          'svg, svg *': {
            transitionProperty: 'fill, stroke, color',
            transitionDuration: '300ms',
            transitionTimingFunction: 'ease',
          },
        },
      },
    },
  });
};
