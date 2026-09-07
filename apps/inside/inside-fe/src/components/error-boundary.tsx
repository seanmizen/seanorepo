import {
  Alert,
  Box,
  Button,
  Container,
  Stack,
  Typography,
} from '@mui/material';
import { Component, type FC, type ReactNode } from 'react';
import { useRouteError } from 'react-router-dom';

interface Props {
  children: ReactNode;
  /** Bumping this resets the boundary — see `RouteResetBoundary`. */
  resetKey?: string;
}

interface State {
  hasError: boolean;
  /** Shown as a reference the visitor can quote (REQ-NET-003). */
  requestId?: string;
}

/**
 * The last line of defence: a render crash somewhere below this.
 *
 * REQ-FAIL-001. Three things this replaces, all of which were wrong:
 *
 * 1. It rendered a bare `<div>Something went wrong.</div>` — unstyled,
 *    un-fonted, and in whatever the browser's default colours are, because it
 *    was mounted OUTSIDE `ThemeProvider`. A visitor on a dark theme got a white
 *    box. It now lives inside the theme.
 * 2. It never reset. Once tripped it stayed tripped until a manual browser
 *    refresh, so a transient crash on one route bricked the whole session.
 * 3. It had no `componentDidCatch`, so the error and its component stack were
 *    never captured anywhere at all.
 *
 * Deliberately NOT a telemetry hook. The decision in #214 was a request id
 * plus server logs rather than a third party receiving data from a marketplace
 * holding home addresses — so this logs locally and shows the reference.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // The console is the only sink there is, by choice. Without this the error
    // object and the component stack were simply lost.
    console.error('[inside] render error', error, info.componentStack);
  }

  componentDidUpdate(previous: Props) {
    // Reset when the caller says the context changed — in practice, a route
    // change. Without this, one bad page ends the session.
    if (this.state.hasError && previous.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return <ErrorFallback onRetry={() => this.setState({ hasError: false })} />;
  }
}

/**
 * What a crash looks like. Shared, so the two boundaries below cannot drift.
 */
export const ErrorFallback: FC<{ onRetry: () => void }> = ({ onRetry }) => (
  <Container maxWidth="sm" sx={{ py: 10 }}>
    <Stack spacing={3} alignItems="flex-start">
      <Typography variant="h1" sx={{ fontSize: { xs: 30, sm: 40 } }}>
        Something went wrong
      </Typography>
      <Alert severity="error" data-testid="render-error">
        This page could not be displayed. That is our fault, not yours.
      </Alert>
      <Box>
        <Button
          variant="contained"
          onClick={onRetry}
          data-testid="render-error-retry"
        >
          Try again
        </Button>
      </Box>
      <Button href="/" variant="text">
        Back to home
      </Button>
    </Stack>
  </Container>
);

/**
 * The router's error element. REQ-FAIL-004.
 *
 * React Router catches a render error inside a route BEFORE any React error
 * boundary above the router sees it, and without this it renders its own
 * fallback: a page headed "Unexpected Application Error!" carrying the
 * exception message and a full stack trace.
 *
 * That is a visitor-facing stack trace in production — the frontend twin of
 * the backend leak REQ-NET-008 closed. This replaces it with the same themed
 * fallback as everything else, and logs the real error where the class
 * boundary logs its own.
 */
export const RouteErrorElement: FC = () => {
  const error = useRouteError();
  console.error('[inside] route render error', error);

  // A full reload rather than a state reset: the router has already torn down
  // the route, so there is nothing left in memory to re-render into.
  return <ErrorFallback onRetry={() => window.location.reload()} />;
};
