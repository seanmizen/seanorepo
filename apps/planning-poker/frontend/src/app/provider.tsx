import { CssBaseline, createTheme, ThemeProvider } from '@mui/material';
import { QueryClientProvider } from '@tanstack/react-query';
import { Component, type FC, type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  HealthCheckProvider,
  SessionProvider,
  SnackbarProvider,
} from '@/app/providers';
import { eventBus, queryClient } from '@/lib';

const getInitialMode = (): 'light' | 'dark' | 'auto' => {
  const stored = localStorage.getItem('theme-mode');
  if (stored === 'light' || stored === 'dark' || stored === 'auto') return stored;
  return 'light';
};

const getEffectiveMode = (mode: 'light' | 'dark' | 'auto'): 'light' | 'dark' => {
  if (mode === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
};

type AppProviderProps = {
  children: ReactNode;
};

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

const AppProvider: FC<AppProviderProps> = ({ children }) => {
  const [mode, setMode] = useState<'light' | 'dark' | 'auto'>(getInitialMode);

  const theme = useMemo(() => {
    const effectiveMode = getEffectiveMode(mode);
    return createTheme({
      palette: {
        mode: effectiveMode,
        background: {
          default: effectiveMode === 'dark' ? '#111' : '#eee',
        },
      },
    });
  }, [mode]);

  useEffect(() => {
    const handleToggle = () => {
      setMode((prev) => {
        const next = prev === 'light' ? 'dark' : prev === 'dark' ? 'auto' : 'light';
        localStorage.setItem('theme-mode', next);
        return next;
      });
    };
    eventBus.on('theme:toggle', handleToggle);
    return () => eventBus.off('theme:toggle', handleToggle);
  }, []);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <SnackbarProvider />
          <HealthCheckProvider />
          <SessionProvider />
          {children}
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export { AppProvider, getEffectiveMode, getInitialMode };
