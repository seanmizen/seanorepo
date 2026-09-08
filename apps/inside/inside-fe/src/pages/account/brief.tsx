import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Divider,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import type { FC } from 'react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FailureAlert, FailureNotice } from '@/components';
import { useBreadcrumbTitle } from '@/contexts/breadcrumb-context';
import {
  ApiError,
  useBriefAction,
  useMyBrief,
  useReceivedBids,
} from '@/features/briefs/use-briefs';

/**
 * One of the buyer's own projects: its state, its switches, its responses.
 *
 * The bids here are served by an owner-scoped endpoint (REQ-BRIEF-001), so
 * this page never has to decide who may read them — the server already did,
 * and it is the only side that knows.
 */
const AccountBrief: FC = () => {
  const raw = Number(useParams().id);
  const id = Number.isFinite(raw) ? raw : null;
  const query = useMyBrief(id);
  const bids = useReceivedBids(id);

  const publish = useBriefAction('publish');
  const unpublish = useBriefAction('unpublish');
  const close = useBriefAction('close');
  const [error, setError] = useState<unknown>(null);

  useBreadcrumbTitle(query.data?.brief.title);

  const act = async (action: typeof publish) => {
    if (id === null) return;
    setError(null);
    try {
      await action.mutateAsync(id);
    } catch (caught) {
      setError(caught);
    }
  };

  if (query.isPending) {
    return (
      <Container maxWidth="md" sx={{ py: 6 }}>
        <Skeleton variant="text" width={320} height={52} />
        <Skeleton variant="rectangular" height={200} sx={{ mt: 3 }} />
      </Container>
    );
  }

  if (query.isError || !query.data) {
    const missing =
      query.error instanceof ApiError && query.error.status === 404;
    return (
      <Container maxWidth="md" sx={{ py: 6 }}>
        {missing ? (
          <Stack spacing={3} alignItems="flex-start">
            <Typography variant="h1" sx={{ fontSize: { xs: 30, sm: 40 } }}>
              Your project
            </Typography>
            <Alert severity="info" data-testid="my-brief-missing">
              That project is no longer available.
            </Alert>
          </Stack>
        ) : (
          <FailureNotice
            error={query.error}
            notFound={{
              title: 'Your project',
              body: 'That project is no longer available.',
            }}
            onRetry={() => query.refetch()}
            testId="my-brief-load-failure"
          />
        )}
      </Container>
    );
  }

  const brief = query.data.brief;
  const live = brief.publishedAt !== null;
  const busy = publish.isPending || unpublish.isPending || close.isPending;

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Stack spacing={4}>
        <Stack spacing={2} alignItems="flex-start">
          <Typography variant="h1" sx={{ fontSize: { xs: 30, sm: 40 } }}>
            {brief.title}
          </Typography>
          <Chip
            size="small"
            data-testid="brief-state"
            label={live ? 'live' : 'unpublished'}
            color={live ? 'success' : 'default'}
          />
          <Typography sx={{ whiteSpace: 'pre-wrap', maxWidth: 680 }}>
            {brief.description}
          </Typography>
        </Stack>

        {error != null && (
          // The retry is whichever switch failed, still on screen.
          <FailureAlert
            error={error}
            fallback={{
              title: 'Not changed',
              body: 'That change could not be saved.',
            }}
            testId="brief-action-error"
          />
        )}

        {/*
          Publication and closing are separate switches because they answer
          separate questions (REQ-BRIEF-001). Unpublishing hides a brief and
          keeps its invitees. Closing ends it.
        */}
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap={true}>
          {live ? (
            <Button
              variant="outlined"
              disabled={busy}
              onClick={() => act(unpublish)}
              data-testid="unpublish-brief"
            >
              Unpublish
            </Button>
          ) : (
            <Button
              variant="contained"
              disabled={busy}
              onClick={() => act(publish)}
              data-testid="publish-brief"
            >
              Publish
            </Button>
          )}
          <Button
            variant="text"
            color="inherit"
            disabled={busy}
            onClick={() => act(close)}
            data-testid="close-brief"
          >
            Close it
          </Button>
        </Stack>

        <Divider />

        <Stack spacing={2}>
          <Typography variant="h2" sx={{ fontSize: 22 }}>
            Responses
          </Typography>

          {bids.isPending ? (
            <Skeleton
              variant="rectangular"
              height={120}
              data-testid="brief-bids-loading"
            />
          ) : bids.isError ? (
            <FailureNotice
              error={bids.error}
              notFound={{
                title: 'Responses',
                body: 'The responses could not be loaded.',
              }}
              onRetry={() => bids.refetch()}
              testId="brief-bids-failure"
            />
          ) : bids.data.bids.length === 0 ? (
            <Typography color="text.secondary" data-testid="brief-bids-empty">
              No responses yet. Designers see this project once it is published.
            </Typography>
          ) : (
            <Stack spacing={2} data-testid="brief-bids-list">
              {bids.data.bids.map((bid) => (
                <Card key={bid.id} variant="outlined">
                  <CardContent>
                    <Stack spacing={1} alignItems="flex-start">
                      <Typography variant="h3" sx={{ fontSize: 18 }}>
                        {bid.designer.studioName}
                      </Typography>
                      {bid.designer.location && (
                        <Chip size="small" label={bid.designer.location} />
                      )}
                      <Typography sx={{ whiteSpace: 'pre-wrap' }}>
                        {bid.message}
                      </Typography>
                    </Stack>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          )}
        </Stack>
      </Stack>
    </Container>
  );
};

export { AccountBrief };
