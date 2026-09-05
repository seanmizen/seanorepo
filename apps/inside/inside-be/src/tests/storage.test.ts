import { afterAll, describe, expect, test } from 'bun:test';
import { createTestEnv } from './setup';

const env = createTestEnv('inside-storage');
afterAll(() => env.cleanup());

const { storage } = await import('../services/storage');

/**
 * Contract tests for StorageProvider. These are deliberately written against
 * the interface, not LocalStorageProvider — when the S3 provider lands it
 * should pass this same suite unchanged.
 */
describe('StorageProvider contract', () => {
  test('upload returns a storage path and a public url', async () => {
    const result = await storage.upload(Buffer.from('hello'), 'a.txt', {
      folder: 'images',
    });

    expect(result.path).toBe('images/a.txt');
    expect(result.url).toBe('http://localhost:4061/api/uploads/images/a.txt');
  });

  test('getUrl matches the url returned by upload', async () => {
    const result = await storage.upload(Buffer.from('x'), 'b.txt');
    expect(storage.getUrl(result.path)).toBe(result.url);
  });

  test('exists reflects reality', async () => {
    const { path } = await storage.upload(Buffer.from('y'), 'c.txt');
    expect(await storage.exists(path)).toBe(true);
    expect(await storage.exists('images/never-written.txt')).toBe(false);
  });

  test('delete removes the object', async () => {
    const { path } = await storage.upload(Buffer.from('z'), 'd.txt');
    await storage.delete(path);
    expect(await storage.exists(path)).toBe(false);
  });

  test('deleting something already gone is not an error', async () => {
    // The desired end state is "not there", which is already true.
    await storage.delete('images/does-not-exist.txt');
  });

  test('creates nested folders on demand', async () => {
    const { path } = await storage.upload(Buffer.from('n'), 'e.txt', {
      folder: 'projects/covers',
    });
    expect(path).toBe('projects/covers/e.txt');
    expect(await storage.exists(path)).toBe(true);
  });
});
