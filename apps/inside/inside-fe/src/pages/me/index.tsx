import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import type { DesignerProfileStatus } from '@shared/types';
import type { FC } from 'react';
import { Link } from 'react-router-dom';
import { useBreadcrumbTitle } from '@/contexts/breadcrumb-context';
import {
  useMyPortfolio,
  useMyProfile,
} from '@/features/designer-onboarding/use-my-studio';

/**
 * One value, one presentation — REQ-STATE-004 applied to review status.
 *
 * Label, colour and explanation are read from a single map rather than
 * branched separately, so a "pending" chip can never end up next to approved
 * wording.
 */
const REVIEW: Record<
  DesignerProfileStatus,
  {
    label: string;
    colour: 'default' | 'info' | 'success' | 'warning';
    note: string;
  }
> = {
  draft: {
    label: 'draft',
    colour: 'default',
    note: 'Only you can see this. Submit it when you are ready for review.',
  },
  pending: {
    label: 'in review',
    colour: 'info',
    note: 'With us for review. We will email you when it has been looked at.',
  },
  approved: {
    label: 'listed',
    colour: 'success',
    note: 'Your studio is live and appears in search.',
  },
  rejected: {
    label: 'changes needed',
    colour: 'warning',
    note: 'Not listed yet. Make the changes below and submit again.',
  },
};

const MyStudio: FC = () => {
  useBreadcrumbTitle('my studio');
  const profile = useMyProfile();
  const portfolio = useMyPortfolio();

  if (profile.isPending) {
    return (
      <Container maxWidth="md" sx={{ py: 6 }}>
        {/* The heading is real even while the rest is a skeleton: every page
            owes a visitor an h1 immediately, and the navigation guard reads it
            as the marker that a route resolved at all. */}
        <Typography variant="h1" sx={{ fontSize: { xs: 32, sm: 44 } }}>
          Your studio
        </Typography>
        <Skeleton variant="rectangular" height={140} sx={{ mt: 3 }} />
      </Container>
    );
  }

  // A designer who has just signed up has no profile. That is the ordinary
  // first visit, not a failure, so it gets an invitation rather than an error.
  if (!profile.data?.profile) {
    return (
      <Container maxWidth="md" sx={{ py: 6 }}>
        <Stack spacing={3} alignItems="flex-start">
          <Typography variant="h1" sx={{ fontSize: { xs: 36, sm: 48 } }}>
            Set up your studio
          </Typography>
          <Typography color="text.secondary" sx={{ maxWidth: 560 }}>
            Tell us who you are and show us your work. Nothing is public until
            you submit it and we have reviewed it.
          </Typography>
          <Button
            component={Link}
            to="/me/profile"
            variant="contained"
            size="large"
            data-testid="start-profile"
          >
            Start your profile
          </Button>
        </Stack>
      </Container>
    );
  }

  const { profile: mine } = profile.data;
  const review = REVIEW[mine.status];
  const pieces = portfolio.data?.portfolioProjects ?? [];

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Stack spacing={4}>
        <Box>
          <Stack
            direction="row"
            spacing={2}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap={true}
          >
            <Typography variant="h1" sx={{ fontSize: { xs: 32, sm: 44 } }}>
              {mine.studioName}
            </Typography>
            <Chip
              label={review.label}
              color={review.colour}
              size="small"
              data-testid="profile-status"
            />
          </Stack>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {review.note}
          </Typography>
        </Box>

        {/*
          A rejection the designer cannot act on is a dead end, so the note is
          shown as prominently as the status itself (REQ-ONBOARD-003).
        */}
        {mine.status === 'rejected' && mine.reviewNote && (
          <Alert severity="warning" data-testid="review-note">
            {mine.reviewNote}
          </Alert>
        )}

        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2} alignItems="flex-start">
              <Typography variant="h2" sx={{ fontSize: 22 }}>
                Your profile
              </Typography>
              <Typography color="text.secondary">
                {mine.headline || 'No headline yet.'}
              </Typography>
              <Button component={Link} to="/me/profile" variant="outlined">
                Edit profile
              </Button>
            </Stack>
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2} alignItems="flex-start">
              <Typography variant="h2" sx={{ fontSize: 22 }}>
                Your work
              </Typography>
              <Typography color="text.secondary" data-testid="piece-count">
                {pieces.length === 0
                  ? 'No pieces yet. Studios with work get enquiries; studios without do not.'
                  : `${pieces.length} ${pieces.length === 1 ? 'piece' : 'pieces'}.`}
              </Typography>
              <Button component={Link} to="/me/portfolio" variant="outlined">
                Manage portfolio
              </Button>
            </Stack>
          </CardContent>
        </Card>

        {mine.status === 'approved' && (
          <Button
            component={Link}
            to={`/designers/${mine.slug}`}
            variant="text"
            sx={{ alignSelf: 'flex-start' }}
          >
            View your public page
          </Button>
        )}
      </Stack>
    </Container>
  );
};

export { MyStudio };
