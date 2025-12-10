import {
  Box,
  Button,
  Container,
  Input,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { type FC, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ThemeToggle } from '@/components';
import { api } from '@/config';
import { showSnackbar } from '@/lib';

const App: FC = () => {
  const navigate = useNavigate();
  // const theme = useTheme();
  const [sessionCode, setSessionCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  const handleCreateSession = async () => {
    try {
      const res = await fetch(api.endpoints.gameSession, { method: 'POST' });
      const data = await res.json();
      navigate(`/session?session-code=${data.shortId}`);
    } catch {
      showSnackbar('Failed to create session', 'error');
    }
  };

  const handleJoinSession = async () => {
    const trimmedCode = sessionCode.trim();
    if (!trimmedCode) return;

    setIsJoining(true);
    try {
      const res = await fetch(`${api.baseUrl}/api/session/${trimmedCode}`);
      const data = await res.json();
      if (!res.ok || data.wasCreated) {
        showSnackbar('Session not found', 'error');
        return;
      }
      navigate(`/session?session-code=${trimmedCode}`);
    } catch {
      showSnackbar('Failed to verify session', 'error');
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <Container maxWidth="lg">
      <Box sx={{ position: 'fixed', top: 16, right: 16, zIndex: 1000 }}>
        <ThemeToggle />
      </Box>
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          position: 'relative',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            flexDirection: {
              xs: 'column',
              lg: 'row',
            },
            alignItems: 'center',
            gap: {
              xs: 4,
              lg: 6,
            },
          }}
        >
          <Typography variant="h4" component="h4" mb={2}>
            Sean's Simple
          </Typography>
          <Typography variant="h2" component="h1" mb={2}>
            Planning Poker
          </Typography>
          <Stack spacing={2}>
            <Paper elevation={3} sx={{ p: 2, width: 'fit-content' }}>
              <Button variant="contained" onClick={handleCreateSession}>
                Start Session
              </Button>
            </Paper>
            <Paper elevation={3} sx={{ p: 2 }}>
              <form onSubmit={handleJoinSession}>
                <Stack spacing={1} direction={'row'}>
                  <Input
                    placeholder="Enter Session Code"
                    sx={{ ml: 2 }}
                    value={sessionCode}
                    onChange={(e) => setSessionCode(e.currentTarget.value)}
                  />
                  <Button
                    type="submit"
                    variant="contained"
                    onClick={handleJoinSession}
                    disabled={!sessionCode.trim() || isJoining}
                  >
                    Join Session
                  </Button>
                </Stack>
              </form>
            </Paper>
          </Stack>
        </Box>
      </Box>
    </Container>
  );
};

export { App };
