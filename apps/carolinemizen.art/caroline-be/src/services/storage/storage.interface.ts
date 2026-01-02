export interface StorageProvider {
  /**
   * Upload a file to storage
   * @returns The storage path and public URL for the uploaded file
   */
  upload(
    file: Buffer,
    filename: string,
    options?: {
      mimeType?: string;
      folder?: string;
    },
  ): Promise<{ path: string; url: string }>;

  /**
   * Delete a file from storage
   */
  delete(path: string): Promise<void>;

  /**
   * Get a public URL for a stored file
   */
  getUrl(path: string): string;

  /**
   * Check if a file exists
   */
  exists(path: string): Promise<boolean>;
}
