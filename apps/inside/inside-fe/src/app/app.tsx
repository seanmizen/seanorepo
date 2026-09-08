import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Container,
  Divider,
  Grid,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import type { AppConfig } from '@shared/types';
import { useQuery } from '@tanstack/react-query';
import type { FC } from 'react';
import { Link } from 'react-router-dom';
import { Wordmark } from '@/components/wordmark';
import { api } from '@/config';
import { useAuth } from '@/contexts/auth-context';
import { get as fetchJson } from '@/lib/http';

/**
 * A plain index of what exists.
 *
 * Deliberately data rather than markup: every page built so far should be
 * reachable from the homepage, and a list makes it obvious when a new one has
 * been added without a way in.
 */
const SECTIONS: ReadonlyArray<{
  to: string;
  title: string;
  blurb: string;
  adminOnly?: boolean;
}> = [
  {
    to: '/designers',
    title: 'Designers',
    blurb: 'Browse and filter approved studios, and see their work.',
  },
  {
    to: '/designers/studio-mercer',
    title: 'A studio profile',
    blurb: 'Bio, specialisms and selected projects.',
  },
  {
    to: '/designers/studio-mercer/portfolio',
    title: 'A full portfolio',
    blurb: 'Every published piece from one studio.',
  },
  {
    to: '/account',
    title: 'Your account',
    blurb: 'Who you are signed in as, and how to sign out.',
  },
  {
    to: '/admin/designers',
    title: 'Review queue',
    blurb: 'Approve or reject studios before they are listed.',
    adminOnly: true,
  },
];

const App: FC = () => {
  const { user, loading } = useAuth();

  const config = useQuery({
    queryKey: ['config'],
    queryFn: () => fetchJson<AppConfig>(api.endpoints.config),
  });

  return (
    <Container maxWidth="lg" sx={{ pb: 12 }}>
      <Stack spacing={{ xs: 6, md: 10 }} sx={{ pt: { xs: 6, md: 12 } }}>
        {/* The masthead. Deliberately quiet and very large — an architecture
            monograph's opening spread, not a hero banner. */}
        <Stack spacing={3} sx={{ maxWidth: 900 }}>
          {/*
            The name is the app's own brand, not server data — it is in the
            document title before any request is made, so rendering it
            directly asserts nothing unverified.
          */}
          <Wordmark
            variant="h1"
            sx={{ fontSize: { xs: 56, sm: 88, md: 120 } }}
          />

          {/*
            REQ-STATE-001 and REQ-STATE-003. The tagline IS server-driven, so it
            gets three honest states. It previously fell back to a hardcoded
            string indistinguishable from loaded content — a placeholder that
            lies when the real value differs, and lies silently when the request
            fails. The `: null` on failure is deliberate, not an oversight:
            rendering nothing beats rendering a guess.

            The `Wordmark` above is exempt — that is static branding, and the
            site's own name never came from the server.
          */}
          {config.isPending ? (
            <Skeleton
              variant="text"
              width={420}
              sx={{ maxWidth: '100%', fontSize: '1.75rem' }}
              data-testid="tagline-loading"
            />
          ) : config.data ? (
            <Typography
              variant="h4"
              color="text.secondary"
              sx={{ maxWidth: 640 }}
            >
              {config.data.tagline}
            </Typography>
          ) : null}

          <Stack direction="row" spacing={2} sx={{ pt: 1 }}>
            <Button
              component={Link}
              to="/designers"
              variant="contained"
              size="large"
            >
              Browse designers
            </Button>
          </Stack>
        </Stack>

        <Divider />

        {/*
          A plain index of what exists, so nothing that has been built is
          unreachable. It will be replaced by real editorial sections as those
          pages arrive — until then this is the map.
        */}
        <Box>
          <Typography
            variant="overline"
            color="text.secondary"
            component="h2"
            sx={{ display: 'block', mb: 3 }}
          >
            Everything here so far
          </Typography>

          <Grid container spacing={3} data-testid="site-index">
            {SECTIONS.filter(
              (section) => !section.adminOnly || user?.role === 'admin',
            ).map((section) => (
              <Grid key={section.to} size={{ xs: 12, sm: 6, md: 4 }}>
                <Card variant="outlined" sx={{ height: '100%' }}>
                  <CardActionArea
                    component={Link}
                    to={section.to}
                    sx={{ height: '100%', p: 3, display: 'block' }}
                  >
                    <Typography variant="h6" component="h3">
                      {section.title}
                    </Typography>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mt: 0.5 }}
                    >
                      {section.blurb}
                    </Typography>
                  </CardActionArea>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Box>

        {/*
          REQ-PRODUCT-003 — the sign-up invitation, offered alongside something
          worth an account for rather than as a condition of browsing
          (REQ-PRODUCT-001). Never shown to a signed-in visitor: inviting
          someone to create an account they already have reads as the site not
          knowing who they are. It waits for `loading` rather than guessing,
          which is REQ-STATE-002 — a pending session is not an absent one.
        */}
        {!loading && !user && (
          <Card
            variant="outlined"
            data-testid="signup-cta"
            sx={{ maxWidth: 720 }}
          >
            <CardContent sx={{ p: { xs: 3, sm: 5 } }}>
              <Stack spacing={2.5} alignItems="flex-start">
                <Typography variant="h3" component="h2">
                  Buy or sell design services
                </Typography>
                <Typography color="text.secondary" sx={{ maxWidth: 520 }}>
                  Create an account to commission a designer for your space, or
                  to list your studio and take on new work.
                </Typography>

                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1.5}
                  sx={{ width: '100%', pt: 1 }}
                >
                  <Button
                    component={Link}
                    to="/login"
                    variant="contained"
                    size="large"
                  >
                    Create an account
                  </Button>
                  <Button
                    component={Link}
                    to="/login"
                    variant="text"
                    size="large"
                  >
                    I already have one
                  </Button>
                </Stack>

                <Typography variant="caption" color="text.secondary">
                  No password — we'll email you a sign-in link.
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        )}
      </Stack>
    </Container>
  );
};

export { App };
