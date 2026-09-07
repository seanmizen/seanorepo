import { Button, Chip, Container, Stack, Typography } from '@mui/material';
import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/auth-context';

/** Minimal signed-in surface — proves the session round trip end to end. */
const Account: FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <Container maxWidth="sm">
      <Stack spacing={3} sx={{ minHeight: '100vh', justifyContent: 'center' }}>
        <Typography variant="h3" component="h1">
          Your account
        </Typography>
        <Typography color="text.secondary" data-testid="account-email">
          {user?.email}
        </Typography>
        <Chip label={user?.role} sx={{ alignSelf: 'flex-start' }} />
        <Button
          variant="outlined"
          sx={{ alignSelf: 'flex-start' }}
          onClick={async () => {
            // Leave the protected route BEFORE clearing the user. Clearing it
            // first makes ProtectedRoute bounce to /login, which is a jarring
            // place to land after deliberately signing out.
            navigate('/', { replace: true });
            try {
              await logout();
            } catch {
              /*
               * `logout` now throws when the server did not actually revoke
               * the session, rather than clearing local state and claiming
               * success (REQ-AUTH-006). Caught here so a failure is not an
               * unhandled rejection.
               *
               * The visible result is already honest: the user stays signed
               * in, because they are. What is missing is telling them so —
               * that needs a surface for session state, which is #215.
               */
            }
          }}
        >
          Sign out
        </Button>
      </Stack>
    </Container>
  );
};

export { Account };
