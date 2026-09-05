import { LocalStorageProvider } from './local-storage';
import type { StorageProvider } from './storage.interface';

const STORAGE_TYPE = process.env.STORAGE_TYPE || 'local';
const UPLOADS_PATH = process.env.UPLOADS_PATH || './uploads';
// Must match the fastify-static prefix in index.ts, or the URLs we hand the
// frontend will 404.
const UPLOADS_URL =
  process.env.UPLOADS_URL || 'http://localhost:4061/api/uploads';

function createStorageProvider(): StorageProvider {
  switch (STORAGE_TYPE) {
    case 'local':
      return new LocalStorageProvider(UPLOADS_PATH, UPLOADS_URL);
    // The planned swap. An S3StorageProvider implements the same four methods
    // against a bucket; nothing above this line changes.
    // case 's3':
    //   return new S3StorageProvider(process.env.S3_BUCKET, ...);
    default:
      console.warn(
        `[Storage] Unknown STORAGE_TYPE "${STORAGE_TYPE}", falling back to local`,
      );
      return new LocalStorageProvider(UPLOADS_PATH, UPLOADS_URL);
  }
}

export const storage = createStorageProvider();
export type { StorageProvider } from './storage.interface';
