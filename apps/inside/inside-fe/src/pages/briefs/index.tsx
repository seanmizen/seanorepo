import {
  Card,
  CardContent,
  Chip,
  Container,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import type { FC } from 'react';
import { Link } from 'react-router-dom';
import { FailureNotice } from '@/components';
import { useBreadcrumbTitle } from '@/contexts/breadcrumb-context';
import { useBriefBoard } from '@/features/briefs/use-briefs';

const BAND: Record<string, string> = {
  under_10k: 'Under £10k',
  '10k_25k': '£10k–£25k',
  '25k_50k': '£25k–£50k',
  '50k_100k': '£50k–£100k',
  '100k_250k': '£100k–£250k',
  '250k_plus': '£250k+',
};

/**
 * The public board. REQ-BRIEF-002.
 *
 * Anonymous by design — a homeowner's job is meant to be found — and the
 * shape the server sends carries no `buyerId`, so nothing here can lead a
 * stranger back to the person who posted it. The bid count is the only thing
 * said about responses, because a count identifies nobody.
 */
const Briefs: FC = () => {
  useBreadcrumbTitle('briefs');
  const query = useBriefBoard(1);

  if (query.isPending) {
    return (
      <Container maxWidth="md" sx={{ py: 6 }}>
        <Typography variant="h1" sx={{ fontSize: { xs: 32, sm: 44 } }}>
          Projects
        </Typography>
        <Skeleton
          variant="rectangular"
          height={220}
          sx={{ mt: 3 }}
          data-testid="briefs-loading"
        />
      </Container>
    );
  }

  if (query.isError) {
    return (
      <Container maxWidth="md" sx={{ py: 6 }}>
        <FailureNotice
          error={query.error}
          notFound={{
            title: 'Projects',
            body: 'The project board could not be loaded.',
          }}
          onRetry={() => query.refetch()}
          testId="briefs-load-failure"
        />
      </Container>
    );
  }

  const briefs = query.data.briefs;

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Stack spacing={4}>
        <Stack spacing={1}>
          <Typography variant="h1" sx={{ fontSize: { xs: 32, sm: 44 } }}>
            Projects
          </Typography>
          <Typography color="text.secondary" sx={{ maxWidth: 620 }}>
            Homeowners and project managers post what they are planning.
            Designers answer with a bid.
          </Typography>
        </Stack>

        {briefs.length === 0 ? (
          <Typography color="text.secondary" data-testid="briefs-empty">
            No open projects right now. This is where they appear once somebody
            posts one.
          </Typography>
        ) : (
          <Stack spacing={2} data-testid="briefs-list">
            {briefs.map((brief) => (
              <Card key={brief.id} variant="outlined">
                <CardContent>
                  <Stack spacing={1.5} alignItems="flex-start">
                    <Typography
                      component={Link}
                      to={`/briefs/${brief.slug}`}
                      variant="h2"
                      sx={{
                        fontSize: 22,
                        textDecoration: 'none',
                        color: 'text.primary',
                      }}
                    >
                      {brief.title}
                    </Typography>
                    <Stack
                      direction="row"
                      spacing={1}
                      flexWrap="wrap"
                      useFlexGap={true}
                    >
                      {brief.location && (
                        <Chip size="small" label={brief.location} />
                      )}
                      {brief.budgetBand && (
                        <Chip
                          size="small"
                          label={BAND[brief.budgetBand] ?? brief.budgetBand}
                        />
                      )}
                      <Chip
                        size="small"
                        variant="outlined"
                        label={`${brief.bidCount} ${
                          brief.bidCount === 1 ? 'bid' : 'bids'
                        }`}
                      />
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

export { Briefs, BAND };
