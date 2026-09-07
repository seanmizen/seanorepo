import { CssBaseline, ThemeProvider } from '@mui/material';
import { QueryClientProvider } from '@tanstack/react-query';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7';
import {
  Component,
  type FC,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { StatusChips } from '@/components';
import { AuthProvider } from '@/contexts/auth-context';
import { ChromeProvider } from '@/contexts/chrome-context';
import { queryClient } from '@/lib';
import {
  buildTheme,
  type EffectiveMode,
  getEffectiveMode,
  getInitialMode,
  THEME_STORAGE_KEY,
  type ThemeMode,
} from './theme';
import { ThemeModeContext } from './theme-context';

class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <div>Something went wrong.</div>;
    }
    return this.props.children;
  }
}

const AppProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<ThemeMode>(getInitialMode);
  const [effectiveMode, setEffectiveMode] = useState<EffectiveMode>(() =>
    getEffectiveMode(getInitialMode()),
  );

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage blocked; the choice just won't survive a reload.
    }
  }, []);

  const toggleMode = useCallback(() => {
    setModeState((prev) => {
      const next: ThemeMode =
        prev === 'light' ? 'dark' : prev === 'dark' ? 'auto' : 'light';
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // As above.
      }
      return next;
    });
  }, []);

  // REQ-THEME-001. Keep the resolved mode in step with both the user's choice
  // and, while on 'auto', live OS theme changes. The subscription is what makes
  // it "live": reading the OS preference only at mount looks right in every
  // test that reloads, and wrong for the case that matters — a machine flipping
  // to dark on schedule while someone is reading.
  useEffect(() => {
    setEffectiveMode(getEffectiveMode(mode));
    if (mode !== 'auto') return;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => {
      setEffectiveMode(event.matches ? 'dark' : 'light');
    };
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [mode]);

  // Mirror onto <body> so the pre-paint script in index.html and any plain CSS
  // agree with MUI about which theme is showing.
  useEffect(() => {
    document.body.classList.remove('light', 'dark');
    document.body.classList.add(effectiveMode);
    document
      .getElementById('colorScheme')
      ?.setAttribute('content', effectiveMode);
  }, [effectiveMode]);

  const theme = useMemo(() => buildTheme(effectiveMode), [effectiveMode]);

  // One source of truth for the mode — the toggle reads this rather than
  // keeping its own copy, so multiple toggles can never disagree.
  const themeModeValue = useMemo(
    () => ({ mode, effectiveMode, setMode, toggleMode }),
    [mode, effectiveMode, setMode, toggleMode],
  );

  return (
    <ErrorBoundary>
      {/*
        nuqs reads and writes the URL through the router, so its adapter has to
        sit inside the same tree. Everything below can use useFilters.
      */}
      <NuqsAdapter>
        <QueryClientProvider client={queryClient}>
          <ThemeModeContext.Provider value={themeModeValue}>
            <ThemeProvider theme={theme}>
              <CssBaseline enableColorScheme={true} />
              {/*
                REQ-CHIPS-008: rendered here, above the router, so the chips
                are on every route by existing rather than by each page opting
                in — where they appear at all, and for as long as the visitor
                wants them. REQ-CHIPS-001 keeps them out of the page's flow.
              */}
              <ChromeProvider>
                <StatusChips />
                <AuthProvider>{children}</AuthProvider>
              </ChromeProvider>
            </ThemeProvider>
          </ThemeModeContext.Provider>
        </QueryClientProvider>
      </NuqsAdapter>
    </ErrorBoundary>
  );
};

export { AppProvider };
