import { describe, expect, test } from 'bun:test';
import { getTestEnv } from './setup';

getTestEnv();

const { storage } = await import('../services/storage');

/**
 * Contract tests for StorageProvider. These are deliberately written against
 * the interface, not LocalStorageProvider — when the S3 provider lands it
 * should pass this same suite unchanged.
 */
describe('StorageProvider contract', () => {
  test('upload returns a storage path and a public url', async () => {
    const result = await storage.upload(Buffer.from('hello'), 'storage-a.txt', {
      folder: 'images',
    });

    expect(result.path).toBe('images/storage-a.txt');
    expect(result.url).toBe(
      'http://localhost:4061/api/uploads/images/storage-a.txt',
    );
  });

  test('getUrl matches the url returned by upload', async () => {
    const result = await storage.upload(Buffer.from('x'), 'storage-b.txt');
    expect(storage.getUrl(result.path)).toBe(result.url);
  });

  test('exists reflects reality', async () => {
    const { path } = await storage.upload(Buffer.from('y'), 'storage-c.txt');
    expect(await storage.exists(path)).toBe(true);
    expect(await storage.exists('images/never-written.txt')).toBe(false);
  });

  test('delete removes the object', async () => {
    const { path } = await storage.upload(Buffer.from('z'), 'storage-d.txt');
    await storage.delete(path);
    expect(await storage.exists(path)).toBe(false);
  });

  test('deleting something already gone is not an error', async () => {
    // The desired end state is "not there", which is already true.
    await storage.delete('images/does-not-exist.txt');
  });

  test('creates nested folders on demand', async () => {
    const { path } = await storage.upload(Buffer.from('n'), 'storage-e.txt', {
      folder: 'projects/covers',
    });
    expect(path).toBe('projects/covers/storage-e.txt');
    expect(await storage.exists(path)).toBe(true);
  });
});
