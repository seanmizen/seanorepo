import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Container,
  Link as MuiLink,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { type FC, type FormEvent, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  type SignupRole,
  safeReturnTo,
  useAuth,
} from '@/contexts/auth-context';

const Login: FC = () => {
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const { requestMagicLink } = useAuth();

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<SignupRole>('buyer');
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await requestMagicLink(email, role, returnTo);
      setDevLink(result.devLink);
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Container maxWidth="sm">
        <Stack
          spacing={2}
          sx={{ minHeight: '100vh', justifyContent: 'center' }}
        >
          <Typography variant="h4" component="h1">
            Check your email
          </Typography>
          <Typography color="text.secondary">
            We've sent a sign-in link to {email}. It expires in 15 minutes and
            can only be used once.
          </Typography>
          {devLink && (
            // Present only when the SERVER chose to send a link, which it
            // cannot do in production. The page never builds one itself, so
            // this block is unreachable against a production backend
            // regardless of how the frontend was built.
            <Alert severity="warning" data-testid="dev-magic-link-notice">
              <AlertTitle>Development sign-in</AlertTitle>
              No email was sent because this backend is not configured to send
              any. Use the link below — it is a real, single-use sign-in
              credential and only ever appears outside production.
              <Box sx={{ mt: 1 }}>
                <MuiLink href={devLink} data-testid="dev-magic-link">
                  Sign in as {email}
                </MuiLink>
              </Box>
            </Alert>
          )}
        </Stack>
      </Container>
    );
  }

  return (
    <Container maxWidth="sm">
      <Stack
        spacing={3}
        component="form"
        onSubmit={handleSubmit}
        sx={{ minHeight: '100vh', justifyContent: 'center' }}
      >
        <Typography variant="h3" component="h1">
          Sign in
        </Typography>
        <Typography color="text.secondary">
          No password. We'll email you a link.
        </Typography>

        {/*
          REQ-AUTH-008. Why they are here, when they did not come here on
          purpose. A visitor bounced to a login page with no explanation
          reasonably concludes the site dropped them — and the honest answer,
          that their session expired or was signed out elsewhere, is the one
          that tells them what to do next.
        */}
        {params.get('reason') === 'expired' && (
          <Alert severity="info" data-testid="session-expired">
            You were signed out. That happens when a session expires, or when it
            is ended from another browser. Signing in again picks up where you
            left off.
          </Alert>
        )}

        <Box>
          <Typography
            variant="body2"
            color="text.secondary"
            id="role-label"
            gutterBottom
          >
            I'm joining as
          </Typography>
          <ToggleButtonGroup
            exclusive
            value={role}
            onChange={(_, next) => next && setRole(next as SignupRole)}
            aria-labelledby="role-label"
          >
            <ToggleButton value="buyer">Looking for a designer</ToggleButton>
            <ToggleButton value="designer">I'm a designer</ToggleButton>
          </ToggleButtonGroup>
        </Box>

        <TextField
          label="Email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />

        {error && (
          <Alert severity="error" data-testid="login-failure">
            {error}
          </Alert>
        )}

        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={busy || !email}
        >
          {busy ? 'Sending…' : 'Email me a link'}
        </Button>
      </Stack>
    </Container>
  );
};

export { Login };
