/**
 * API configuration and endpoints.
 */
export const api = {
  baseUrl: 'http://localhost:4041',
  wsUrl: 'ws://localhost:4041',
  endpoints: {
    health: 'http://localhost:4041',
    userSession: 'http://localhost:4041/api/user-session',
    gameSession: 'http://localhost:4041/api/game-session',
  },
};
