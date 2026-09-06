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
            await logout();
          }}
        >
          Sign out
        </Button>
      </Stack>
    </Container>
  );
};

export { Account };
