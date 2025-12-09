import { CssBaseline, createTheme, ThemeProvider } from '@mui/material';
import type { FC, ReactNode } from 'react';
import {
  HealthCheckProvider,
  SessionProvider,
  SnackbarProvider,
} from '@/app/providers';

const theme = createTheme();

type AppProviderProps = {
  children: ReactNode;
};

const AppProvider: FC<AppProviderProps> = ({ children }) => {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <SnackbarProvider />
      <HealthCheckProvider />
      <SessionProvider />
      {children}
    </ThemeProvider>
  );
};

export { AppProvider };
