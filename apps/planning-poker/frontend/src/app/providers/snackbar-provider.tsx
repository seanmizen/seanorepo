import { AllInclusive } from '@mui/icons-material';
import { Alert, Box, Paper, Stack } from '@mui/material';
import { type FC, useEffect, useState } from 'react';
import { env } from '@/config';
import { eventBus } from '@/lib';

type SnackbarItem = {
  id: string;
  message: string;
  severity: 'success' | 'error' | 'info' | 'warning';
  timeRemaining: number;
};

const SnackbarProvider: FC = () => {
  const [snackbars, setSnackbars] = useState<SnackbarItem[]>([]);

  /**
   * Subscribes to snackbar events (add, update, remove).
   */
  useEffect(() => {
    const addHandler = (payload: unknown) => {
      const { id, message, severity, noExpiry } = payload as {
        id: string;
        message: string;
        severity: SnackbarItem['severity'];
        noExpiry?: boolean;
      };
      setSnackbars((prev) => {
        const existing = prev.find((s) => s.id === id);
        const timeRemaining = noExpiry ? -1 : 6000;
        if (existing) {
          return prev.map((s) =>
            s.id === id ? { ...s, message, severity, timeRemaining } : s,
          );
        }
        return [...prev, { id, message, severity, timeRemaining }];
      });
    };

    const updateHandler = (payload: unknown) => {
      const { id, message, severity, noExpiry } = payload as {
        id: string;
        message: string;
        severity: SnackbarItem['severity'];
        noExpiry?: boolean;
      };
      setSnackbars((prev) => {
        const existing = prev.find((s) => s.id === id);
        const timeRemaining = noExpiry ? -1 : 6000;
        if (existing) {
          return prev.map((s) =>
            s.id === id ? { ...s, message, severity, timeRemaining } : s,
          );
        }
        return [...prev, { id, message, severity, timeRemaining }];
      });
    };

    const removeHandler = (payload: unknown) => {
      const { id } = payload as { id: string };
      setSnackbars((prev) => prev.filter((s) => s.id !== id));
    };

    eventBus.on('snackbar:add', addHandler);
    eventBus.on('snackbar:update', updateHandler);
    eventBus.on('snackbar:remove', removeHandler);

    return () => {
      eventBus.off('snackbar:add', addHandler);
      eventBus.off('snackbar:update', updateHandler);
      eventBus.off('snackbar:remove', removeHandler);
    };
  }, []);

  /**
   * Decrements timeRemaining and removes expired snackbars.
   */
  useEffect(() => {
    const interval = setInterval(() => {
      setSnackbars((prev) =>
        prev
          .map((s) =>
            s.timeRemaining === -1
              ? s
              : { ...s, timeRemaining: Math.max(0, s.timeRemaining - 100) },
          )
          .filter((s) => s.timeRemaining !== 0),
      );
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const handleClose = (id: string) => {
    setSnackbars((prev) => prev.filter((s) => s.id !== id));
  };

  return (
    <Box sx={{ position: 'fixed', bottom: 16, right: 16, zIndex: 9999 }}>
      <Stack spacing={1}>
        {snackbars.map((snackbar) => (
          <Alert
            key={snackbar.id}
            onClose={() => handleClose(snackbar.id)}
            severity={snackbar.severity}
            variant="filled"
          >
            {snackbar.message}
            {env.debugShowSnackbarTimer && (
              <Paper
                elevation={3}
                sx={{ display: 'inline-block', px: 0.5, ml: 1 }}
              >
                {snackbar.timeRemaining === -1 ? (
                  <AllInclusive
                    sx={{ fontSize: 16, verticalAlign: 'middle' }}
                  />
                ) : (
                  `${(snackbar.timeRemaining / 1000).toFixed(1)}s`
                )}
              </Paper>
            )}
          </Alert>
        ))}
      </Stack>
    </Box>
  );
};

export { SnackbarProvider };
