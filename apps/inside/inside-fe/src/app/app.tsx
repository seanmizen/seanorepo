import {
  Box,
  Button,
  Card,
  CardContent,
  Container,
  Divider,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import type { AppConfig } from '@shared/types';
import { useQuery } from '@tanstack/react-query';
import type { FC } from 'react';
import { Link } from 'react-router-dom';
import { ThemeToggle } from '@/components';
import { api } from '@/config';
import { useAuth } from '@/contexts/auth-context';

const fetchJson = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`${response.status} from ${url}`);
  return response.json() as Promise<T>;
};

const App: FC = () => {
  const { user, loading } = useAuth();

  const config = useQuery({
    queryKey: ['config'],
    queryFn: () => fetchJson<AppConfig>(api.endpoints.config),
  });

  return (
    <Container maxWidth="md">
      <Box
        sx={{
          position: 'fixed',
          top: 16,
          right: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
        }}
      >
        {!loading &&
          (user ? (
            <Button component={Link} to="/account" size="small">
              Account
            </Button>
          ) : (
            <Button component={Link} to="/login" size="small">
              Sign in
            </Button>
          ))}
        <ThemeToggle />
      </Box>

      <Stack
        spacing={3}
        sx={{
          minHeight: '100vh',
          justifyContent: 'center',
          alignItems: 'flex-start',
        }}
      >
        {/*
          The name is the app's own brand, not server data — it is in the
          document title before any request is made, so rendering it directly
          asserts nothing unverified.
        */}
        <Typography variant="h1" sx={{ fontSize: { xs: 48, sm: 72 } }}>
          inside
        </Typography>

        {/*
          The tagline IS server-driven, so it gets three honest states. It
          previously fell back to a hardcoded string indistinguishable from
          loaded content — a placeholder that lies when the real value differs,
          and lies silently when the request fails.
        */}
        {config.isPending ? (
          <Skeleton
            variant="text"
            width={360}
            sx={{ maxWidth: '100%', fontSize: '1.5rem' }}
            data-testid="tagline-loading"
          />
        ) : config.data ? (
          <Typography
            variant="h5"
            color="text.secondary"
            sx={{ maxWidth: 520 }}
          >
            {config.data.tagline}
          </Typography>
        ) : null}

        <Typography variant="body2" color="text.secondary">
          A marketplace for architects and interior designers.
        </Typography>

        {/*
          The front door. The top-right button is a utility affordance for
          people who already know what this is; this is the one that explains
          the site to someone who does not.

          Never shown to a signed-in visitor — inviting someone to create an
          account they already have reads as the site not knowing who they are.
          It waits for `loading` rather than guessing, per the standing rule
          that a pending state must not be presented as a known one.
        */}
        {!loading && !user && (
          <Card
            variant="outlined"
            data-testid="signup-cta"
            sx={{
              width: '100%',
              maxWidth: 560,
              mt: 2,
              // Squarer than MUI's default: the theme's 2px radius reads as
              // editorial rather than app-like, which is the positioning.
              borderColor: 'divider',
            }}
          >
            <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
              <Stack spacing={2.5} alignItems="flex-start">
                <Typography variant="h4" component="h2">
                  Buy or sell design services
                </Typography>
                <Typography color="text.secondary">
                  Create an account to commission a designer for your space, or
                  to list your studio and take on new work.
                </Typography>

                <Divider flexItem />

                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1.5}
                  sx={{ width: '100%' }}
                >
                  <Button
                    component={Link}
                    to="/login"
                    variant="contained"
                    size="large"
                    sx={{ px: 4 }}
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
