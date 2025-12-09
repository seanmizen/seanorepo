/**
 * API configuration and endpoints.
 */
export const api = {
  baseUrl: 'http://localhost:4011',
  wsUrl: 'ws://localhost:4011',
  endpoints: {
    health: 'http://localhost:4011',
    userSession: 'http://localhost:4011/api/user-session',
    gameSession: 'http://localhost:4011/api/game-session',
  },
};
