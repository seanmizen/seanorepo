import { configs } from '../../../configs';

type Mode = 'development' | 'production';

const mode = (import.meta.env.MODE as Mode) ?? 'development';
const config = configs[mode];

// Check if running locally in production (localhost or 127.0.0.1)
const isLocalhost =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1');

// Dev API origin: http://localhost:<serverPort>
// Prod API origin:
//   - If localhost: http://localhost:<backendPort> (for local prod testing)
//   - Otherwise: same-origin (cloudflared/nginx handles /api → backend)
const devApiOrigin = `http://localhost:${config.backendPort}`;
const prodApiOrigin = isLocalhost
  ? `http://localhost:${config.backendPort}`
  : '';

const baseUrl = mode === 'development' ? devApiOrigin : prodApiOrigin;

// WebSocket URL:
// - dev: ws://localhost:<serverPort>
// - prod local: ws://localhost:<serverPort>
// - prod gateway: ws(s)://<host> (same-origin)
const wsUrl =
  mode === 'development' || isLocalhost
    ? `ws://localhost:${config.backendPort}`
    : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${
        window.location.host
      }`;

export const api = {
  baseUrl,
  wsUrl,
  endpoints: {
    health: mode === 'development' || isLocalhost ? `${baseUrl}` : '/api',
    userSession:
      mode === 'development' || isLocalhost
        ? `${baseUrl}/user-session`
        : `/api/user-session`,
    gameSession:
      mode === 'development' || isLocalhost
        ? `${baseUrl}/api/game-session`
        : `/api/game-session`,
  },
};
