import { access, mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StorageProvider } from './storage.interface';

export class LocalStorageProvider implements StorageProvider {
  private basePath: string;
  private baseUrl: string;

  constructor(basePath: string, baseUrl: string) {
    this.basePath = basePath;
    this.baseUrl = baseUrl;
  }

  async upload(
    file: Buffer,
    filename: string,
    options?: { mimeType?: string; folder?: string },
  ): Promise<{ path: string; url: string }> {
    const folder = options?.folder || 'images';
    const folderPath = path.join(this.basePath, folder);

    // Ensure folder exists
    await mkdir(folderPath, { recursive: true });

    const filePath = path.join(folder, filename);
    const fullPath = path.join(this.basePath, filePath);

    await writeFile(fullPath, file);

    return {
      path: filePath,
      url: this.getUrl(filePath),
    };
  }

  async delete(storagePath: string): Promise<void> {
    const fullPath = path.join(this.basePath, storagePath);
    await unlink(fullPath);
  }

  getUrl(storagePath: string): string {
    return `${this.baseUrl}/${storagePath}`;
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
