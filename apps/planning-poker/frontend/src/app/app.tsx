import {
  Box,
  Button,
  Container,
  Paper,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/config';
import { showSnackbar } from '@/lib';

const App: FC = () => {
  const navigate = useNavigate();
  const theme = useTheme();
  const isSmall = useMediaQuery(theme.breakpoints.down('md'));

  const handleCreateSession = async () => {
    try {
      const res = await fetch(api.endpoints.gameSession, { method: 'POST' });
      const data = await res.json();
      navigate(`/session/${data.shortId}`);
    } catch {
      showSnackbar('Failed to create session', 'error');
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
            flexDirection: isSmall ? 'column' : 'row',
            alignItems: 'center',
            gap: 2,
          }}
        >
          <Typography variant="h2" component="h1">
            Planning Poker
          </Typography>
          <Paper elevation={3} sx={{ p: 2 }}>
            <Button variant="contained" onClick={handleCreateSession}>
              Start Session
            </Button>
          </Paper>
        </Box>
      </Box>
    </Container>
  );
};

export { App };
