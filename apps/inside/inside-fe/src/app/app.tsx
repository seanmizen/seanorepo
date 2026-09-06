import {
  Box,
  Button,
  Container,
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
          A marketplace for architects and interior designers. Under
          construction.
        </Typography>
      </Stack>
    </Container>
  );
};

export { App };
