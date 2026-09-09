import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { type FC, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FailureNotice } from '@/components';
import {
  useDesignerUnderReview,
  useReviewDecision,
} from '@/features/admin/use-admin-designers';
import { ApiError } from '@/lib/http';

/**
 * One profile, as the reviewer sees it: every portfolio piece including unpublished
 * drafts, because judging unfinished work is the point of reviewing.
 */
const AdminDesignerReview: FC = () => {
  const id = Number(useParams().id);
  const review = useDesignerUnderReview(id);
  const decide = useReviewDecision(id);
  const [note, setNote] = useState('');

  // Every state keeps an h1, so the page always identifies itself — for the
  // reader, for the breadcrumb, and for the navigation guard which treats a
  // page with no heading as not a real page.
  if (review.isPending) {
    return (
      <Container maxWidth="md" sx={{ py: 6 }}>
        <Stack spacing={3}>
          <Typography variant="h3" component="h1">
            Review
          </Typography>
          <CircularProgress />
        </Stack>
      </Container>
    );
  }

  // Rendered inline rather than as the 404 route: this IS a real page, it just
  // has nothing to show for that id. The breadcrumb trail stays intact.
  //
  // A 404 is the only status this page can honestly call "no longer
  // available" — REQ-QUALITY-001. Everything else (a 500, a dead tunnel) is a
  // failure, not a deletion, and gets `FailureNotice` rather than the same
  // reassuring `severity="info"` box. This is the #231 shape: `isError` alone
  // collapsed every cause into `review-missing` here until this fix.
  if (review.isError || !review.data) {
    const missing =
      review.error instanceof ApiError && review.error.status === 404;
    return (
      <Container maxWidth="md" sx={{ py: 6 }}>
        {missing ? (
          <Stack spacing={3}>
            <Typography variant="h3" component="h1">
              Review
            </Typography>
            <Alert severity="info" data-testid="review-missing">
              That profile is no longer available.
            </Alert>
          </Stack>
        ) : (
          <FailureNotice
            error={review.error}
            notFound={{
              title: 'Review',
              body: 'That profile is no longer available.',
            }}
            onRetry={() => review.refetch()}
            testId="review-load-failure"
          />
        )}
      </Container>
    );
  }

  const { profile, portfolioProjects } = review.data;
  const decided =
    profile.status === 'approved' || profile.status === 'rejected';

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Stack spacing={3}>
        <Stack direction="row" spacing={2} alignItems="center">
          <Typography variant="h3" component="h1">
            {profile.studioName}
          </Typography>
          <Chip
            size="small"
            variant="outlined"
            label={profile.status}
            data-testid="review-status"
          />
        </Stack>

        {profile.headline && (
          <Typography variant="h6" color="text.secondary">
            {profile.headline}
          </Typography>
        )}
        {profile.bio && <Typography>{profile.bio}</Typography>}
        {profile.location && (
          <Typography variant="body2" color="text.secondary">
            {profile.location}
          </Typography>
        )}

        <Divider />

        <Typography variant="h6" component="h2">
          Portfolio ({portfolioProjects.length})
        </Typography>
        {portfolioProjects.length === 0 ? (
          <Typography color="text.secondary">
            No portfolio projects yet.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {portfolioProjects.map((project) => (
              <Box key={project.id}>
                <Typography>
                  {project.title}{' '}
                  <Chip
                    size="small"
                    variant="outlined"
                    label={project.status}
                    sx={{ ml: 1 }}
                  />
                </Typography>
                {project.summary && (
                  <Typography variant="body2" color="text.secondary">
                    {project.summary}
                  </Typography>
                )}
              </Box>
            ))}
          </Stack>
        )}

        <Divider />

        {profile.reviewNote && (
          <Alert severity="info">Previous note: {profile.reviewNote}</Alert>
        )}

        <TextField
          label="Note to the designer"
          helperText="Required when rejecting — they need to know what to change."
          multiline
          minRows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />

        {decide.isError && (
          <Alert severity="error" data-testid="review-action-failure">
            {(decide.error as Error).message}
          </Alert>
        )}

        <Stack direction="row" spacing={2}>
          <Button
            variant="contained"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ decision: 'approve', note })}
          >
            Approve
          </Button>
          <Button
            variant="outlined"
            color="error"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ decision: 'reject', note })}
          >
            Reject
          </Button>
        </Stack>

        {decided && (
          <Typography variant="body2" color="text.secondary">
            Last decision recorded {profile.reviewedAt}.
          </Typography>
        )}
      </Stack>
    </Container>
  );
};

export { AdminDesignerReview };
