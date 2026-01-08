import { useEffect, useState } from 'react';

const API_URL = import.meta.env.API_URL;

interface AppConfig {
  site: {
    name: string;
    adminTitle: string;
  };
  dashboard: {
    welcome: {
      title: string;
      text: string;
    };
    cards: {
      artworks: { title: string; description: string };
      galleries: { title: string; description: string };
      images: { title: string; description: string };
      content: { title: string; description: string };
    };
  };
  uploads: {
    maxFileSizeMB: number;
    maxFiles: number;
  };
}

export function useAppConfig() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch(`${API_URL}/config`);
        if (response.ok) {
          const data = await response.json();
          setConfig(data);
        }
      } catch (error) {
        console.error('Failed to fetch app config:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, []);

  return { config, loading };
}
