import { type FC, useEffect } from 'react';
import { api, env } from '@/config';
import { eventBus, showSnackbar } from '@/lib';

const SessionProvider: FC = () => {
  /**
   * Listens for backend:healthy event and creates a session.
   */
  useEffect(() => {
    if (!env.debugBackend) return;

    const handleHealthCheck = () => {
      const existingSession = localStorage.getItem('user-session-id');
      if (existingSession) {
        showSnackbar(
          `Session ID: ${existingSession}`,
          'info',
          'session-id',
          true,
        );
        return;
      }

      fetch(api.endpoints.userSession, { method: 'POST' })
        .then((res) => res.json())
        .then((data) => {
          localStorage.setItem('user-session-id', data.id);
          showSnackbar(`Session ID: ${data.id}`, 'info', 'session-id', true);
        })
        .catch(() => {
          showSnackbar('Session creation failed', 'error');
        });
    };

    eventBus.on('backend:healthy', handleHealthCheck);
    return () => eventBus.off('backend:healthy', handleHealthCheck);
  }, []);

  return null;
};

export { SessionProvider };
