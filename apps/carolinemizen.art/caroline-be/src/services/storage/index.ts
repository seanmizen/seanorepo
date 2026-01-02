import { LocalStorageProvider } from './local-storage';
import type { StorageProvider } from './storage.interface';

// Configuration from environment variables
const STORAGE_TYPE = process.env.STORAGE_TYPE || 'local';
const UPLOADS_PATH = process.env.UPLOADS_PATH || '/app/uploads';
const UPLOADS_URL = process.env.UPLOADS_URL || 'http://localhost:4021/uploads';

// Factory function to create storage provider
function createStorageProvider(): StorageProvider {
  switch (STORAGE_TYPE) {
    case 'local':
      return new LocalStorageProvider(UPLOADS_PATH, UPLOADS_URL);
    // Future storage providers can be added here:
    // case 's3':
    //   return new S3StorageProvider(...);
    // case 'r2':
    //   return new R2StorageProvider(...);
    default:
      console.warn(
        `Unknown storage type: ${STORAGE_TYPE}, defaulting to local`,
      );
      return new LocalStorageProvider(UPLOADS_PATH, UPLOADS_URL);
  }
}

// Export singleton instance
export const storage = createStorageProvider();

// Re-export interface for use in other modules
export type { StorageProvider } from './storage.interface';
