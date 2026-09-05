/**
 * A blob store. Deliberately dumb: it moves bytes and hands back a path and a
 * public URL, and knows nothing about images, users or the database.
 *
 * Everything image-specific (resizing, variants, srcset) lives above this in
 * `services/images.ts`, so swapping local disk for S3 is a one-file change:
 * add an `S3StorageProvider` and flip `STORAGE_TYPE`.
 */
export interface StorageProvider {
  /**
   * Write `file` and return where it landed.
   *
   * `path` is storage-relative and is what you persist to the database.
   * `url` is publicly fetchable and is what you hand to the frontend —
   * always use it rather than rebuilding the URL from `path` at the call
   * site, or the two will drift apart when the provider changes.
   */
  upload(
    file: Buffer,
    filename: string,
    options?: { mimeType?: string; folder?: string },
  ): Promise<{ path: string; url: string }>;

  /** Remove a stored object. Resolves quietly if it was already gone. */
  delete(path: string): Promise<void>;

  /** Public URL for a storage-relative path. */
  getUrl(path: string): string;

  exists(path: string): Promise<boolean>;
}
