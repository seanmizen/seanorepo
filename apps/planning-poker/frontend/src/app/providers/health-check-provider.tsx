import { type FC, useEffect } from 'react';
import { api, env } from '@/config';
import { eventBus, showSnackbar, updateSnackbar } from '@/lib';

const HealthCheckProvider: FC = () => {
  /**
   * Pings backend API and shows connection status.
   */
  useEffect(() => {
    if (env.debugBackend) {
      const key = 'backend-health';
      let warningTimeout: NodeJS.Timeout;

      const showWarning = () => {
        showSnackbar('Connecting to backend...', 'warning', key, true);
      };

      warningTimeout = setTimeout(showWarning, 200);

      fetch(api.endpoints.health)
        .then((res) => res.json())
        .then((data) => {
          clearTimeout(warningTimeout);
          if (data.status === 'ok') {
            updateSnackbar(key, 'Backend connected', 'success');
            eventBus.emit('backend:healthy');
          }
        })
        .catch(() => {
          clearTimeout(warningTimeout);
          updateSnackbar(key, 'Backend connection failed', 'error');
        });
    }
  }, []);

  return null;
};

export { HealthCheckProvider };
