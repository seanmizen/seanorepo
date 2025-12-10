import { CssBaseline, createTheme, ThemeProvider } from '@mui/material';
import { QueryClientProvider } from '@tanstack/react-query';
import { Component, type FC, type ReactNode } from 'react';
import {
  HealthCheckProvider,
  SessionProvider,
  SnackbarProvider,
} from '@/app/providers';
import { queryClient } from '@/lib';

const theme = createTheme();

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

export { AppProvider };
