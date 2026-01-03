// Runtime API URL detection (same pattern as planning-poker)

type Mode = 'development' | 'production';

const mode =
  (import.meta.env.MODE as Mode) ??
  (import.meta.env.NODE_ENV as Mode) ??
  'development';

// Check if running locally (localhost or 127.0.0.1)
const isLocalhost =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1');

// Dev: http://localhost:4021
// Prod local: http://localhost:4021 (for testing)
// Prod remote: same-origin (cloudflared/nginx routes /api → backend)
const backendPort = 4021;
const devApiUrl = `http://localhost:${backendPort}/api`;
const prodApiUrl = isLocalhost ? `http://localhost:${backendPort}/api` : '/api'; // same-origin

export const API_URL = mode === 'development' ? devApiUrl : prodApiUrl;

// DEBUG_MODE: Check env var (string) or default to dev mode
export const DEBUG_MODE = mode === 'development';
