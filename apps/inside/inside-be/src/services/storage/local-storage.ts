import { access, mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StorageProvider } from './storage.interface';

/**
 * Writes to a directory on the runner's disk, served back by fastify-static.
 * In Docker that directory is a named volume, so uploads survive rebuilds.
 */
export class LocalStorageProvider implements StorageProvider {
  private basePath: string;
  private baseUrl: string;

  constructor(basePath: string, baseUrl: string) {
    this.basePath = basePath;
    // Trailing slashes would produce `//` in every URL we hand out.
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async upload(
    file: Buffer,
    filename: string,
    options?: { mimeType?: string; folder?: string },
  ): Promise<{ path: string; url: string }> {
    const folder = options?.folder || 'images';
    await mkdir(path.join(this.basePath, folder), { recursive: true });

    const storagePath = path.join(folder, filename);
    await writeFile(path.join(this.basePath, storagePath), file);

    return { path: storagePath, url: this.getUrl(storagePath) };
  }

  async delete(storagePath: string): Promise<void> {
    try {
      await unlink(path.join(this.basePath, storagePath));
    } catch (error) {
      // Deleting something already gone is the desired end state, not an error.
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return;
      }
      throw error;
    }
  }

  getUrl(storagePath: string): string {
    // Storage paths are POSIX-shaped in URLs even if built on Windows.
    return `${this.baseUrl}/${storagePath.split(path.sep).join('/')}`;
  }

  async exists(storagePath: string): Promise<boolean> {
    try {
      await access(path.join(this.basePath, storagePath));
      return true;
    } catch {
      return false;
    }
  }
}
