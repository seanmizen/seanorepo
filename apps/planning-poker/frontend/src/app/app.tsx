import {
  Box,
  Button,
  CircularProgress,
  Container,
  Input,
  Paper,
  Stack,
  Typography,
  // useTheme,
} from '@mui/material';
import { type FC, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
      if (!res.ok) {
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
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
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
            gap: 6,
          }}
        >
          <Typography variant="h4" component="h4">
            Sean's Simple
          </Typography>
          <Typography variant="h2" component="h1">
            Planning Poker
          </Typography>
          <Stack spacing={2}>
            <Paper elevation={3} sx={{ p: 2, width: 'fit-content' }}>
              <Button variant="contained" onClick={handleCreateSession}>
                Start Session
              </Button>
            </Paper>
            <Paper elevation={3} sx={{ p: 2 }}>
              <Stack spacing={1} direction={'row'}>
                <Input
                  placeholder="Enter Session Code"
                  sx={{ ml: 2 }}
                  value={sessionCode}
                  onChange={(e) => setSessionCode(e.currentTarget.value)}
                />
                <Button
                  variant="contained"
                  onClick={handleJoinSession}
                  disabled={!sessionCode.trim() || isJoining}
                >
                  {isJoining ? (
                    <CircularProgress size={24} color="inherit" />
                  ) : (
                    'Join Session'
                  )}
                </Button>
              </Stack>
            </Paper>
          </Stack>
        </Box>
      </Box>
    </Container>
  );
};

export { App };
