/**
 * The route that serves the uploads. The static route in src/index.ts and the
 * default UPLOADS_URL both use it, so the URLs that the API returns resolve.
 */
export const UPLOADS_ROUTE = '/api/uploads';

/**
 * The directory that holds the uploads. Every reader of UPLOADS_PATH uses
 * this function, so the static route and the storage provider agree. Docker
 * sets UPLOADS_PATH to /app/uploads.
 *
 * It reads the environment on each call, because the e2e tests set
 * UPLOADS_PATH after the modules load.
 */
export const uploadsPath = (): string =>
  process.env.UPLOADS_PATH ||
  (process.env.NODE_ENV === 'production' ? '/app/uploads' : './uploads');
