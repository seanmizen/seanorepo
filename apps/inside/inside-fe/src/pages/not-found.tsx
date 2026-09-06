import { Button, Container, Stack, Typography } from '@mui/material';
import type { FC } from 'react';
import { Link } from 'react-router-dom';

/**
 * The catch-all.
 *
 * It exists so "does this path resolve?" has an honest answer: without it,
 * react-router hands an unknown URL to its own error boundary, which looks
 * like a crash rather than a missing page — and the breadcrumb guard would
 * have nothing to distinguish a real page from a dead one.
 *
 * `data-testid="not-found"` is that signal. The guard asserts its absence on
 * every ancestor path it visits.
 */
const NotFound: FC = () => (
  <Container maxWidth="sm">
    <Stack
      spacing={3}
      sx={{ minHeight: '100vh', justifyContent: 'center' }}
      data-testid="not-found"
    >
      <Typography variant="h3" component="h1">
        Page not found
      </Typography>
      <Typography color="text.secondary">
        That address doesn't lead anywhere. The trail above will take you back.
      </Typography>
      <Button
        component={Link}
        to="/"
        variant="outlined"
        sx={{ alignSelf: 'flex-start' }}
      >
        Back to home
      </Button>
    </Stack>
  </Container>
);

export { NotFound };
