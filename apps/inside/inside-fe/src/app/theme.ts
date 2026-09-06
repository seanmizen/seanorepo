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

  // Brass. The light value carries text on text buttons and links, so it is
  // picked for contrast, not just for looks: #7d6440 clears WCAG AA (4.5:1)
  // against the page (5.3:1), paper (5.6:1) and — the binding constraint —
  // MUI's warning-Alert ground #fff4e5 (5.1:1), where the dev sign-in link
  // sits. The previous #8a6f47 was 4.35:1 there and 4.49:1 on the page: a
  // serious axe failure on both. tests/e2e/a11y.spec.ts locks this in.
  const brass = isDark ? '#c2a068' : '#7d6440';

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
        main: brass,
        light: isDark ? '#d8bd8d' : '#a98b5f',
        dark: isDark ? '#9a7c46' : '#5e4a30',
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
          // WCAG 2.4.7 Focus Visible. MUI's ButtonBase sets `outline: 0` and
          // leans on a focus ripple that is, on an IconButton, invisible — the
          // theme toggle had no keyboard focus cue at all. axe cannot catch
          // this (it is not a static-DOM property), so it is asserted in
          // tests/e2e/keyboard.spec.ts instead.
          //
          // The selector is `body :focus-visible` rather than `:focus-visible`
          // deliberately: it outranks `.MuiButtonBase-root { outline: 0 }` on
          // specificity, so the ring survives regardless of stylesheet order.
          // The 2px offset floats the ring clear of the control's own border,
          // which keeps it legible on the brass contained button, where a ring
          // drawn flush would sit brass-on-brass.
          'body :focus-visible, body:focus-visible': {
            outline: `2px solid ${brass}`,
            outlineOffset: '2px',
          },
          'svg, svg *': {
            transitionProperty: 'fill, stroke, color',
            transitionDuration: '300ms',
            transitionTimingFunction: 'ease',
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          // The rule above cannot reach a text field: MUI styles the inner
          // <input> with `:focus { outline: 0 }`, which outranks it. Ring the
          // field wrapper instead, so the indicator surrounds the whole
          // control rather than sitting inside its own border.
          root: {
            '&:has(:focus-visible)': {
              outline: `2px solid ${brass}`,
              outlineOffset: '2px',
            },
          },
        },
      },
    },
  });
};
