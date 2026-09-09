import {
  Alert,
  Button,
  Chip,
  Container,
  Divider,
  MenuItem,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { FC } from 'react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { FailureAlert, FailureNotice } from '@/components';
import { useAuth } from '@/contexts/auth-context';
import { useBreadcrumbTitle } from '@/contexts/breadcrumb-context';
import {
  ApiError,
  useBrief,
  useStartBid,
  useSubmitBid,
} from '@/features/briefs/use-briefs';
import { BAND } from './index';

const AVAILABILITY = [
  ['asap', 'Straight away'],
  ['within_3_months', 'Within 3 months'],
  ['within_6_months', 'Within 6 months'],
  ['within_12_months', 'Within 12 months'],
] as const;

/**
 * One brief, and the designer's way in.
 *
 * The bid control is deliberately absent rather than disabled for anyone who
 * cannot use it, and each absence says why. A control that looks available and
 * then fails on submit is the shape #162 exists to avoid.
 */
const BriefPage: FC = () => {
  const slug = useParams().slug;
  const query = useBrief(slug);
  const { user } = useAuth();
  const start = useStartBid();
  const submit = useSubmitBid();

  const [message, setMessage] = useState('');
  const [availability, setAvailability] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState(false);

  useBreadcrumbTitle(query.data?.brief.title);

  if (query.isPending) {
    return (
      <Container maxWidth="md" sx={{ py: 6 }}>
        <Skeleton variant="text" width={320} height={56} />
        <Skeleton variant="rectangular" height={220} sx={{ mt: 3 }} />
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
              That project
            </Typography>
            <Alert severity="info" data-testid="brief-missing">
              That project is no longer listed.
            </Alert>
          </Stack>
        ) : (
          <FailureNotice
            error={query.error}
            notFound={{
              title: 'That project',
              body: 'That project is no longer listed.',
            }}
            onRetry={() => query.refetch()}
            testId="brief-load-failure"
          />
        )}
      </Container>
    );
  }

  const { brief } = query.data;
  const closed =
    brief.closesAt !== null && brief.closesAt <= new Date().toISOString();

  const respond = async () => {
    setError(null);
    try {
      const created = await start.mutateAsync({
        briefId: brief.id,
        message,
        budgetBand: '',
        availability,
      });
      await submit.mutateAsync(created.bid.id);
      setSent(true);
    } catch (caught) {
      setError(caught);
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Stack spacing={4}>
        <Stack spacing={2} alignItems="flex-start">
          <Typography variant="h1" sx={{ fontSize: { xs: 30, sm: 44 } }}>
            {brief.title}
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap={true}>
            {brief.location && <Chip size="small" label={brief.location} />}
            {brief.budgetBand && (
              <Chip
                size="small"
                label={BAND[brief.budgetBand] ?? brief.budgetBand}
              />
            )}
            {closed && (
              <Chip
                size="small"
                color="default"
                label="closed"
                data-testid="brief-closed"
              />
            )}
          </Stack>
          <Typography sx={{ whiteSpace: 'pre-wrap', maxWidth: 680 }}>
            {brief.description}
          </Typography>
        </Stack>

        <Divider />

        {/*
          Who may respond, and why not. Each branch names its own reason
          instead of hiding the control silently.
        */}
        {closed ? (
          <Typography color="text.secondary" data-testid="bid-closed">
            This project is closed and is no longer taking bids.
          </Typography>
        ) : !user ? (
          <Typography color="text.secondary" data-testid="bid-signed-out">
            Sign in as a designer to respond to this project.
          </Typography>
        ) : user.role !== 'designer' ? (
          <Typography color="text.secondary" data-testid="bid-not-designer">
            Responding is the designer side of the marketplace.
          </Typography>
        ) : sent ? (
          <Alert severity="success" data-testid="bid-sent">
            Your bid is with the buyer.
          </Alert>
        ) : (
          <Stack spacing={2} alignItems="flex-start" data-testid="bid-form">
            <Typography variant="h2" sx={{ fontSize: 22 }}>
              Respond to this project
            </Typography>
            <TextField
              label="Your message"
              multiline={true}
              minRows={4}
              fullWidth={true}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              inputProps={{ 'data-testid': 'field-bid-message' }}
            />
            <TextField
              select={true}
              label="When you could start"
              value={availability}
              onChange={(event) => setAvailability(event.target.value)}
              sx={{ minWidth: 240 }}
              inputProps={{ 'data-testid': 'field-bid-availability' }}
            >
              <MenuItem value="">Not sure yet</MenuItem>
              {AVAILABILITY.map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </TextField>

            {error != null && (
              // The retry is the Send button beside it, so this says what
              // happened rather than offering a second control.
              <FailureAlert
                error={error}
                fallback={{
                  title: 'Not sent',
                  body: 'That bid could not be sent.',
                }}
                testId="bid-action-failure"
              />
            )}

            <Button
              variant="contained"
              onClick={respond}
              disabled={start.isPending || submit.isPending}
              data-testid="send-bid"
            >
              {start.isPending || submit.isPending ? 'Sending…' : 'Send bid'}
            </Button>
          </Stack>
        )}
      </Stack>
    </Container>
  );
};

export { BriefPage };
