import { Alert, Button, Stack, Typography } from '@mui/material';
import type { FC } from 'react';
import { describeFailure } from '@/lib/http';

/**
 * One way of saying a request failed, and one way of trying again.
 *
 * REQ-FAIL-003. Every page used to hand-roll this, which is how six of them
 * ended up rendering `severity="info"` and the words "not listed" for a dead
 * backend. `describeFailure` (REQ-NET-007) already decides *what* is true;
 * this decides how it looks and gives the visitor something to press.
 *
 * The retry is a real control. Before this the app contained three "Try
 * again." strings — all of them prose inside an alert, instructing the visitor
 * to re-click something themselves. `refetch` was never called from any
 * component in the codebase.
 *
 * `role="alert"` is implicit in MUI's Alert, which announces it — the reason
 * this is a shared component rather than a copied block.
 */
export const FailureNotice: FC<{
  error: unknown;
  /** What "not found" means here — only the caller knows. */
  notFound: { title: string; body: string };
  onRetry?: () => void;
  testId: string;
}> = ({ error, notFound, onRetry, testId }) => {
  const failure = describeFailure(error, notFound);

  return (
    <Stack spacing={3} alignItems="flex-start">
      <Typography variant="h1" sx={{ fontSize: { xs: 28, sm: 38 } }}>
        {failure.title}
      </Typography>
      <Alert severity={failure.severity} data-testid={testId}>
        {failure.body}
        {failure.requestId ? ` (reference ${failure.requestId})` : ''}
      </Alert>
      {onRetry && (
        <Button
          variant="contained"
          onClick={onRetry}
          data-testid={`${testId}-retry`}
        >
          Try again
        </Button>
      )}
    </Stack>
  );
};
