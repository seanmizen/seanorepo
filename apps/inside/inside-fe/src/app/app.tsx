import { Box, Chip, Container, Stack, Typography } from '@mui/material';
import type { AppConfig, HealthResponse } from '@shared/types';
import { useQuery } from '@tanstack/react-query';
import type { FC } from 'react';
import { ThemeToggle } from '@/components';
import { api } from '@/config';

const fetchJson = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`${response.status} from ${url}`);
  return response.json() as Promise<T>;
};

const App: FC = () => {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => fetchJson<HealthResponse>(api.endpoints.health),
  });

  const config = useQuery({
    queryKey: ['config'],
    queryFn: () => fetchJson<AppConfig>(api.endpoints.config),
  });

  return (
    <Container maxWidth="md">
      <Box sx={{ position: 'fixed', top: 16, right: 16 }}>
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
        <Typography variant="h1" sx={{ fontSize: { xs: 48, sm: 72 } }}>
          {config.data?.siteName ?? 'inside'}
        </Typography>

        <Typography variant="h5" color="text.secondary" sx={{ maxWidth: 520 }}>
          {config.data?.tagline ?? 'Find the designer for your space'}
        </Typography>

        <Typography variant="body2" color="text.secondary">
          A marketplace for architects and interior designers. Under
          construction.
        </Typography>

        <Chip
          size="small"
          variant="outlined"
          color={
            health.isPending
              ? 'default'
              : health.isError
                ? 'error'
                : 'secondary'
          }
          label={
            health.isPending
              ? 'checking backend…'
              : health.isError
                ? 'backend unreachable'
                : `backend ok · up ${health.data.uptime}s`
          }
        />
      </Stack>
    </Container>
  );
};

export { App };
