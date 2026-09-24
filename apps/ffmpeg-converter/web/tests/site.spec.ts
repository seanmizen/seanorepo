import { statSync } from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { FIXTURES, TEST_CHUNK_BYTES } from './fixtures';

const fixture = (name: string) => path.join(FIXTURES, name);

/** Waits for the Download link and checks the file. Returns its href. */
async function expectDownload(page: Page, name: string): Promise<string> {
  const link = page.getByRole('link', { name: /^Download/ });
  await expect(link).toBeVisible({ timeout: 90_000 });
  await expect(link).toHaveAttribute('download', name);
  const href = (await link.getAttribute('href')) ?? '';
  // A device conversion gives a blob: URL, which only the page can read.
  const size = href.startsWith('blob:')
    ? await page.evaluate(
        async (h) => (await (await fetch(h)).blob()).size,
        href,
      )
    : (await (await page.request.get(href)).body()).length;
  expect(size).toBeGreaterThan(100);
  return href;
}

const DEVICE_PROMISE = 'Your file never leaves your device.';

/**
 * On desktop, video pages make the device the default once the page knows
 * this browser can do it. Wait for that, so a test never catches the brief
 * server-only first paint.
 */
async function ready(page: Page, url: string, isMobile: boolean) {
  await page.goto(url);
  if (!isMobile)
    await expect(page.getByText(DEVICE_PROMISE, { exact: true })).toBeVisible();
}

/** Choose a file for the server: the secondary link on desktop video pages. */
async function chooseOnServer(
  page: Page,
  isMobile: boolean,
  primary: string,
  file: string,
) {
  const label = isMobile ? primary : 'Or convert on our servers';
  await page.getByLabel(label).setInputFiles(fixture(file));
}

/** Records requests whose URL contains one of the parts. */
function record(page: Page, ...parts: string[]) {
  const seen: string[] = [];
  page.on('request', (r) => {
    if (parts.some((p) => r.url().includes(p)))
      seen.push(`${r.method()} ${r.url()}`);
  });
  return seen;
}

test('a tool page converts after one click', async ({ page, isMobile }) => {
  await ready(page, '/mov-to-mp4', isMobile);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'MOV to MP4',
  );
  await page.getByLabel('Choose MOV file').setInputFiles(fixture('clip.mov'));
  const href = await expectDownload(page, 'clip.mp4');
  // Desktop: on the device. Phone: our server.
  expect(href.startsWith('blob:')).toBe(!isMobile);
  await page.getByRole('button', { name: 'Convert another file' }).click();
  await expect(page.getByText('Choose MOV file')).toBeVisible();
});

test('the home page asks what to do with the file', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Choose a file').setInputFiles(fixture('clip.mp4'));
  await page.getByRole('button', { name: 'Save the sound as MP3' }).click();
  await expectDownload(page, 'clip.mp3');
});

test('the home page converts video on the device on desktop', async ({
  page,
  isMobile,
}) => {
  const server = record(page, '/api/uploads', '/api/convert');
  await page.goto('/');
  await page.getByLabel('Choose a file').setInputFiles(fixture('clip.mp4'));
  await page.getByRole('button', { name: 'Convert to MOV' }).click();
  const href = await expectDownload(page, 'clip.mov');
  expect(href.startsWith('blob:')).toBe(!isMobile);
  expect(server.length > 0).toBe(isMobile);
});

test('trim asks for a start and an end', async ({ page, isMobile }) => {
  await ready(page, '/trim-video', isMobile);
  await page.getByLabel('Choose video file').setInputFiles(fixture('clip.mp4'));
  await expect(page.getByText(/Clip length: 3\.0 seconds/)).toBeVisible();
  await page.getByLabel('Start (seconds)').fill('1');
  await page.getByRole('button', { name: /^Trim video/ }).click();
  await expectDownload(page, 'clip-trimmed.mp4');
});

test('the wrong kind of file gets a plain error', async ({
  page,
  isMobile,
}) => {
  await ready(page, '/mov-to-mp4', isMobile);
  await page
    .getByLabel('Choose MOV file')
    .setInputFiles(fixture('picture.png'));
  await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toContainText(
    'This page converts video files',
  );
});

test('no drop zone, no ffmpeg jargon, no "slower"', async ({
  page,
  isMobile,
}) => {
  for (const url of [
    '/',
    '/mov-to-mp4',
    '/compress-video-to-10mb',
    '/trim-video',
  ]) {
    await page.goto(url);
    if (!isMobile && url !== '/' && !url.startsWith('/compress-video-to')) {
      await expect(
        page.getByText(DEVICE_PROMISE, { exact: true }),
      ).toBeVisible();
    }
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(
      /ffmpeg -i|-crf|libx264|Advanced|drag and drop|drop (a|your) file/i,
    );
    expect(text).not.toMatch(/slower/i);
  }
});

for (const url of ['/', '/mov-to-mp4', '/trim-video']) {
  test(`no serious accessibility problems on ${url}`, async ({
    page,
    isMobile,
  }) => {
    await ready(page, url, isMobile || url === '/');
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    const bad = violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(bad.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
}

test.describe('the device is the default on desktop', () => {
  test('the default converts on the device, with nothing uploaded', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'desktop only');
    const wasm = record(page, '/ffmpeg/');
    const server = record(page, '/api/uploads', '/api/convert');
    await ready(page, '/mov-to-mp4', false);
    await expect(page.getByText('Nothing to upload')).toBeVisible();
    // Nothing of ffmpeg.wasm loads until a file is chosen.
    expect(wasm).toEqual([]);
    await page.getByLabel('Choose MOV file').setInputFiles(fixture('clip.mov'));
    const href = await expectDownload(page, 'clip.mp4');
    expect(href).toMatch(/^blob:/);
    await expect(
      page.getByText('Done. Your file never left your device.'),
    ).toBeVisible();
    expect(wasm.length).toBeGreaterThan(0);
    expect(server).toEqual([]);
  });

  test('the server option still works on desktop', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'desktop only');
    const wasm = record(page, '/ffmpeg/');
    const server = record(page, '/api/uploads');
    await ready(page, '/mov-to-mp4', false);
    await chooseOnServer(page, false, 'Choose MOV file', 'clip.mov');
    const href = await expectDownload(page, 'clip.mp4');
    expect(href).toMatch(/^\/api\/jobs\//);
    expect(server.length).toBeGreaterThan(0);
    expect(wasm).toEqual([]);
  });

  test('a GIF is made on the device by default', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop only');
    await ready(page, '/mp4-to-gif', false);
    await page.getByLabel('Choose MP4 file').setInputFiles(fixture('clip.mp4'));
    await expect(page.getByText(/Clip length: 3\.0 seconds/)).toBeVisible();
    await page.getByRole('button', { name: 'Make GIF on your device' }).click();
    const href = await expectDownload(page, 'clip.gif');
    expect(href).toMatch(/^blob:/);
  });

  test('phones use the server, with no device promise', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'phone only');
    const server = record(page, '/api/uploads');
    await page.goto('/mov-to-mp4');
    await page.getByLabel('Choose MOV file').setInputFiles(fixture('clip.mov'));
    await expectDownload(page, 'clip.mp4');
    expect(server.length).toBeGreaterThan(0);
    await expect(page.getByText(DEVICE_PROMISE, { exact: true })).toHaveCount(
      0,
    );
  });

  test('audio, image and size pages use the server only', async ({ page }) => {
    for (const url of [
      '/mp4-to-mp3',
      '/png-to-jpg',
      '/compress-video-to-10mb',
    ]) {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForLoadState('networkidle');
      await expect(page.getByText(DEVICE_PROMISE, { exact: true })).toHaveCount(
        0,
      );
      await expect(page.getByLabel('Or convert on our servers')).toHaveCount(0);
    }
  });
});

test.describe('chunked upload', () => {
  // The Go server under test uses TEST_CHUNK_BYTES (fixtures.ts).
  test('a file goes up in chunks, each under the chunk size', async ({
    page,
    isMobile,
  }) => {
    // Playwright does not show a Blob body, so read Content-Length: the
    // number that Cloudflare checks.
    const sizes: Promise<number>[] = [];
    page.on('request', (r) => {
      if (r.method() === 'PUT' && r.url().includes('/api/uploads/')) {
        sizes.push(r.allHeaders().then((h) => Number(h['content-length'])));
      }
    });
    const size = statSync(fixture('clip.mov')).size;
    await ready(page, '/mov-to-mp4', isMobile);
    await chooseOnServer(page, isMobile, 'Choose MOV file', 'clip.mov');
    await expectDownload(page, 'clip.mp4');
    const got = await Promise.all(sizes);
    expect(got.length).toBe(Math.ceil(size / TEST_CHUNK_BYTES));
    expect(got.length).toBeGreaterThan(1);
    for (const s of got) {
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThanOrEqual(TEST_CHUNK_BYTES);
    }
    expect(got.reduce((a, b) => a + b, 0)).toBe(size);
  });

  test('a failed chunk is sent again, and the upload finishes', async ({
    page,
    isMobile,
  }) => {
    let failed = 0;
    await page.route('**/api/uploads/*/1', async (route) => {
      if (failed === 0) {
        failed++;
        await route.fulfill({ status: 502, body: 'Bad gateway' });
        return;
      }
      await route.continue();
    });
    const chunks = record(page, '/api/uploads/');
    await ready(page, '/mov-to-mp4', isMobile);
    await chooseOnServer(page, isMobile, 'Choose MOV file', 'clip.mov');
    await expectDownload(page, 'clip.mp4');
    expect(failed).toBe(1);
    expect(
      chunks.filter((u) => u.startsWith('PUT') && u.endsWith('/1')),
    ).toHaveLength(2);
  });
});
