import { useEffect, useState } from 'react';

const API_URL = import.meta.env.API_URL;
const HEALTH_CHECK_INTERVAL = 10000; // Check every 10 seconds

export function useBackendHealth() {
  const [isHealthy, setIsHealthy] = useState(true);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const response = await fetch(`${API_URL}/health`, {
          method: 'GET',
        });
        setIsHealthy(response.ok);
      } catch (_error) {
        setIsHealthy(false);
      }
    };

    // Check immediately on mount
    checkHealth();

    // Then check periodically
    const interval = setInterval(checkHealth, HEALTH_CHECK_INTERVAL);

    return () => clearInterval(interval);
  }, []);

  return isHealthy;
}
