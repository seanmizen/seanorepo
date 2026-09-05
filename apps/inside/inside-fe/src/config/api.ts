/**
 * Backend base URL, baked in at build time by rsbuild `source.define`.
 *
 * There is deliberately only one strategy here — no runtime hostname sniffing.
 * Local dev points at http://localhost:4061/api; production builds ship '/api'
 * and cloudflared routes it.
 */
const baseUrl = import.meta.env.API_URL;

export const api = {
  baseUrl,
  endpoints: {
    health: `${baseUrl}/health`,
    config: `${baseUrl}/config`,
  },
};
