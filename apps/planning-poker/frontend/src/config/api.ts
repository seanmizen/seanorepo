import { configs } from '../../../configs';

type Mode = 'development' | 'production';

const mode = (import.meta.env.MODE as Mode) ?? 'development';
const config = configs[mode];

// Dev API origin: http://localhost:<serverPort>
// Prod API origin: same-origin (nginx handles /api → backend)
const devApiOrigin = `http://localhost:${config.backendPort}`;

const baseUrl = mode === 'development' ? devApiOrigin : '';

// WebSocket URL:
// - dev: ws://localhost:<serverPort>
// - prod: ws(s)://<host> (same-origin)
const wsUrl =
  mode === 'development'
    ? `ws://localhost:${config.backendPort}`
    : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${
        window.location.host
      }`;

export const api = {
  baseUrl,
  wsUrl,
  endpoints: {
    health: mode === 'development' ? devApiOrigin : '/api',
    userSession:
      mode === 'development'
        ? `${devApiOrigin}/user-session`
        : `/api/user-session`,
    gameSession:
      mode === 'development'
        ? `${devApiOrigin}/game-session`
        : `/api/game-session`,
  },
};
