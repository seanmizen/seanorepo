import { Alert, Button, Stack, Typography } from '@mui/material';
import type { FC } from 'react';
import { ApiError, describeFailure } from '@/lib/http';

/**
 * One way of saying a request failed, and one way of trying again.
 *
 * REQ-FAIL-003. Every page used to hand-roll this, which is how six of them
 * ended up rendering `severity="info"` and the words "not listed" for a dead
 * backend. `describeFailure` (REQ-NET-007) already decides *what* is true.
 * This decides how it looks and gives the visitor something to press.
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

/**
 * A failed *action*, said inline — the same diagnosis, none of the furniture.
 *
 * `FailureNotice` above replaces a page: it owns the h1 and offers a retry,
 * which is right when a load failed and there is nothing else to look at. A
 * mutation is the opposite case. The form is still on screen, and the control
 * that re-issues the request is the Save button the visitor just pressed — so
 * a second "Try again" button beside it would be two controls for one action.
 *
 * What these surfaces were missing is not a button, it is the diagnosis. Each
 * held a hand-rolled string in local state, so everything that was not an
 * `ApiError` became a generic sentence naming the wrong culprit — "That could
 * not be saved" for a designer who was simply offline — and no request id ever
 * reached the visitor (REQ-NET-007).
 *
 * **A 4xx keeps the server's own message**, which is the one difference from
 * `describeFailure`'s policy and the reason this is not a thin wrapper over
 * it. That function answers a 4xx with the caller's `notFound` copy, which is
 * right for a load — a 404 on a profile page means "not listed" — and wrong
 * for an action, where a refused request carries the only wording that says
 * what to do next: "That file is 14MB. The limit is 8MB" beats "that could not
 * be saved" every time. Transport failures and 5xx have no such message, and
 * those are exactly the cases `describeFailure` exists to word properly.
 *
 * `error` is `unknown` because these callers legitimately hold two kinds of
 * thing. A `string` is a validation message the page raised itself without
 * asking the server anything ("Your studio needs a name"), and is shown
 * verbatim — describing it would dress the visitor's own omission as a fault.
 */
export const FailureAlert: FC<{
  error: unknown;
  /** Wording for a failure that carries none of its own. */
  fallback: { title: string; body: string };
  testId: string;
}> = ({ error, fallback, testId }) => {
  if (typeof error === 'string') {
    return (
      <Alert severity="error" data-testid={testId}>
        {error}
      </Alert>
    );
  }

  if (
    error instanceof ApiError &&
    !error.isTransport &&
    error.status < 500 &&
    error.message.length > 0
  ) {
    return (
      <Alert severity="error" data-testid={testId}>
        {error.message}
        {error.requestId ? ` (reference ${error.requestId})` : ''}
      </Alert>
    );
  }

  const failure = describeFailure(error, fallback);

  return (
    <Alert severity={failure.severity} data-testid={testId}>
      {failure.body}
      {failure.requestId ? ` (reference ${failure.requestId})` : ''}
    </Alert>
  );
};
