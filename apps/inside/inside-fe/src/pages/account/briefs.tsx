import {
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  MenuItem,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { FC } from 'react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FailureAlert, FailureNotice } from '@/components';
import { useBreadcrumbTitle } from '@/contexts/breadcrumb-context';
import {
  type BriefDraft,
  useCreateBrief,
  useMyBriefs,
} from '@/features/briefs/use-briefs';

const WORK_TYPES = [
  'full_home',
  'single_room',
  'kitchen',
  'bathroom',
  'extension',
  'new_build',
  'renovation',
  'commercial',
  'styling',
  'other',
] as const;

const BUDGET_BANDS = [
  ['under_10k', 'Under £10k'],
  ['10k_25k', '£10k–£25k'],
  ['25k_50k', '£25k–£50k'],
  ['50k_100k', '£50k–£100k'],
  ['100k_250k', '£100k–£250k'],
  ['250k_plus', '£250k+'],
] as const;

/**
 * The three answers to "who may see this", in the buyer's words.
 *
 * `link` is described as unlisted and never as private, because the URL is
 * guessable in principle and calling it private would be a guarantee the
 * system does not make (REQ-BRIEF-005).
 */
const VISIBILITY = [
  ['public', 'On the public board'],
  ['link', 'Unlisted — anyone with the link'],
  ['private', 'Private — only people you invite'],
] as const;

const EMPTY: BriefDraft = {
  visibility: 'public',
  title: '',
  description: '',
  workType: '',
  budgetBand: '',
  location: '',
  timeline: '',
};

/**
 * The buyer's own projects.
 *
 * Hung off `/account` rather than `/me`, because `/me` is the designer's
 * workspace and carries a designer role guard. A buyer following the
 * breadcrumb up from here lands somewhere they can actually be (REQ-NAV-001).
 *
 * A brief starts private and unpublished (REQ-BRIEF-004). Publishing is a
 * separate, deliberate act on the brief's own page, so nothing reaches the
 * public board by filling in a form and pressing save.
 */
const AccountBriefs: FC = () => {
  useBreadcrumbTitle('projects');
  const query = useMyBriefs();
  const create = useCreateBrief();

  const [draft, setDraft] = useState<BriefDraft>(EMPTY);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState(false);

  const field = (name: keyof BriefDraft) => ({
    value: draft[name],
    onChange: (event: { target: { value: string } }) =>
      setDraft((current) => ({ ...current, [name]: event.target.value })),
  });

  const post = async () => {
    setError(null);
    if (draft.title.trim().length === 0) {
      setError('Your project needs a title.');
      return;
    }
    if (draft.description.trim().length === 0) {
      setError('Describe what you are planning, so designers can answer it.');
      return;
    }
    try {
      await create.mutateAsync(draft);
      setDraft(EMPTY);
      setOpen(false);
    } catch (caught) {
      setError(caught);
    }
  };

  if (query.isPending) {
    return (
      <Container maxWidth="md" sx={{ py: 6 }}>
        <Typography variant="h1" sx={{ fontSize: { xs: 32, sm: 40 } }}>
          Your projects
        </Typography>
        <Skeleton variant="rectangular" height={200} sx={{ mt: 3 }} />
      </Container>
    );
  }

  if (query.isError) {
    return (
      <Container maxWidth="md" sx={{ py: 6 }}>
        <FailureNotice
          error={query.error}
          notFound={{
            title: 'Your projects',
            body: 'Your projects could not be loaded.',
          }}
          onRetry={() => query.refetch()}
          testId="my-briefs-load-failure"
        />
      </Container>
    );
  }

  const briefs = query.data.briefs;

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Stack spacing={4}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'center' }}
        >
          <Typography variant="h1" sx={{ fontSize: { xs: 32, sm: 40 } }}>
            Your projects
          </Typography>
          <Button
            variant="contained"
            onClick={() => setOpen((value) => !value)}
            data-testid="post-a-project"
          >
            {open ? 'Cancel' : 'Post a project'}
          </Button>
        </Stack>

        {open && (
          <Stack spacing={3} data-testid="brief-form">
            <TextField
              label="Title"
              required={true}
              fullWidth={true}
              inputProps={{ 'data-testid': 'field-brief-title' }}
              {...field('title')}
            />
            <TextField
              label="What you are planning"
              multiline={true}
              minRows={4}
              fullWidth={true}
              inputProps={{ 'data-testid': 'field-brief-description' }}
              {...field('description')}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                select={true}
                label="Type of work"
                sx={{ minWidth: 200 }}
                inputProps={{ 'data-testid': 'field-brief-workType' }}
                {...field('workType')}
              >
                <MenuItem value="">Not sure yet</MenuItem>
                {WORK_TYPES.map((value) => (
                  <MenuItem key={value} value={value}>
                    {value.replace(/_/g, ' ')}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select={true}
                label="Budget"
                sx={{ minWidth: 200 }}
                inputProps={{ 'data-testid': 'field-brief-budgetBand' }}
                {...field('budgetBand')}
              >
                <MenuItem value="">Not sure yet</MenuItem>
                {BUDGET_BANDS.map(([value, label]) => (
                  <MenuItem key={value} value={value}>
                    {label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Location"
                sx={{ minWidth: 200 }}
                inputProps={{ 'data-testid': 'field-brief-location' }}
                {...field('location')}
              />
            </Stack>

            <TextField
              select={true}
              label="Who can see it"
              sx={{ maxWidth: 360 }}
              inputProps={{ 'data-testid': 'field-brief-visibility' }}
              {...field('visibility')}
            >
              {VISIBILITY.map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </TextField>

            {error != null && (
              // The retry is the Post button below it.
              <FailureAlert
                error={error}
                fallback={{
                  title: 'Not posted',
                  body: 'That project could not be posted.',
                }}
                testId="brief-form-error"
              />
            )}

            <Button
              variant="contained"
              onClick={post}
              disabled={create.isPending}
              sx={{ alignSelf: 'flex-start' }}
              data-testid="submit-brief"
            >
              {create.isPending ? 'Posting…' : 'Post it'}
            </Button>
          </Stack>
        )}

        {briefs.length === 0 ? (
          <Typography color="text.secondary" data-testid="my-briefs-empty">
            Nothing posted yet. A project describes what you are planning, and
            designers answer it with a bid.
          </Typography>
        ) : (
          <Stack spacing={2} data-testid="my-briefs-list">
            {briefs.map((brief) => (
              <Card key={brief.id} variant="outlined">
                <CardContent>
                  <Stack
                    direction="row"
                    spacing={2}
                    alignItems="center"
                    justifyContent="space-between"
                    flexWrap="wrap"
                    useFlexGap={true}
                  >
                    <Stack spacing={0.5}>
                      <Typography variant="h2" sx={{ fontSize: 20 }}>
                        {brief.title}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {brief.bidCount} {brief.bidCount === 1 ? 'bid' : 'bids'}
                      </Typography>
                    </Stack>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Chip
                        size="small"
                        label={
                          brief.publishedAt === null ? 'unpublished' : 'live'
                        }
                        color={
                          brief.publishedAt === null ? 'default' : 'success'
                        }
                      />
                      <Button
                        component={Link}
                        to={`/account/briefs/${brief.id}`}
                        variant="outlined"
                        size="small"
                      >
                        Manage
                      </Button>
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}
      </Stack>
    </Container>
  );
};

export { AccountBriefs };
