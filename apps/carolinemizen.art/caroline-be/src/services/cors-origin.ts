/** The CORS allow-list. Outside production, the default is the dev frontend. */
export const corsOrigin = (): string =>
  process.env.CORS_ORIGIN || 'http://localhost:4020';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The warning for a production process whose CORS allow-list names a local
 * host. It is null when there is no problem.
 *
 * The site and the API have the same origin, so the browser does not use the
 * allow-list now. A cross-origin client fails when the allow-list is wrong,
 * so the server tells the operator at startup.
 *
 * It is a warning and not a refusal: a refusal stops a production backend
 * that has the old value in its .env.
 */
export const corsOriginWarning = (
  nodeEnv: string | undefined,
  origin: string,
): string | null => {
  if (nodeEnv !== 'production') return null;
  let hostname: string;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return `CORS_ORIGIN is not a URL: "${origin}". Set it to the site origin, for example https://carolinemizen.art.`;
  }
  if (!LOCAL_HOSTS.has(hostname)) return null;
  return `CORS_ORIGIN is ${origin} in production. Set it to the site origin, for example https://carolinemizen.art.`;
};
