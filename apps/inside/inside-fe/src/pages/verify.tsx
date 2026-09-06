import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Stack,
  Typography,
} from '@mui/material';
import { type FC, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/auth-context';
import { useBreadcrumbTitle } from '@/contexts/breadcrumb-context';

/**
 * Consumes the magic-link token, then returns the user to whatever they were
 * doing when they were asked to sign in.
 */
const Verify: FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { verify } = useAuth();
  const [error, setError] = useState<string | null>(null);

  // The route table can only call this crumb "sign-in link". Once the attempt
  // has resolved, the page knows something better than the URL does, so it
  // names its own crumb. Null while in flight, which falls back to the label.
  useBreadcrumbTitle(error ? 'sign-in failed' : null);

  // Tokens are single-use. StrictMode double-invokes effects in development,
  // so without this guard the second run consumes an already-used token and
  // shows a spurious failure.
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    const token = params.get('token');
    if (!token) {
      setError('This sign-in link is missing its token.');
      return;
    }

    verify(token, params.get('returnTo') ?? undefined)
      .then(({ returnTo }) => navigate(returnTo, { replace: true }))
      .catch((e: unknown) =>
        setError(
          e instanceof Error ? e.message : 'Could not complete sign-in.',
        ),
      );
  }, [params, verify, navigate]);

  if (error) {
    return (
      <Container maxWidth="sm">
        <Stack
          spacing={2}
          sx={{ minHeight: '100vh', justifyContent: 'center' }}
        >
          <Typography variant="h4" component="h1">
            Sign-in failed
          </Typography>
          <Alert severity="error">{error}</Alert>
          <Button component={Link} to="/login" variant="contained">
            Request a new link
          </Button>
        </Stack>
      </Container>
    );
  }

  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      <Stack spacing={2} alignItems="center">
        <CircularProgress />
        <Typography color="text.secondary">Signing you in…</Typography>
      </Stack>
    </Box>
  );
};

export { Verify };
