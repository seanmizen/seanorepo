import CloudOffIcon from '@mui/icons-material/CloudOff';
import { Box, Stack, Typography } from '@mui/material';
import { onlineManager } from '@tanstack/react-query';
import { type FC, useEffect, useState } from 'react';

/**
 * One app-level statement that the network is gone.
 *
 * REQ-FAIL-002. Without it, losing connection produced an error *storm*: every
 * page in flight failed separately and each said, individually, that the thing
 * being looked for did not exist. Six honest-looking messages, all wrong, for
 * one cause.
 *
 * Driven by TanStack's `onlineManager` rather than a bare `navigator.onLine`
 * listener, so the banner and the query layer cannot disagree about whether we
 * are online — the same value decides both what is shown and whether queries
 * are paused.
 *
 * `role="status"` with `aria-live="polite"`: a screen-reader user needs to
 * learn the network dropped, but not urgently enough to interrupt them
 * mid-sentence.
 */
export const OfflineBanner: FC = () => {
  const [online, setOnline] = useState(() => onlineManager.isOnline());

  useEffect(() => onlineManager.subscribe(setOnline), []);

  if (online) return null;

  return (
    <Box
      role="status"
      aria-live="polite"
      data-testid="offline-banner"
      sx={{
        backgroundColor: 'warning.light',
        color: 'warning.contrastText',
        px: { xs: 3, md: 5 },
        py: 1.25,
      }}
    >
      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        sx={{ maxWidth: 'lg', mx: 'auto' }}
      >
        <CloudOffIcon fontSize="small" />
        <Typography variant="body2">
          You are offline. Anything already loaded is still here, and the site
          will catch up when you reconnect.
        </Typography>
      </Stack>
    </Box>
  );
};
