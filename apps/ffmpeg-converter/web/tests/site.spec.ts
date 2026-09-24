import { statSync } from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { FIXTURES, TEST_CHUNK_BYTES } from './fixtures';

const fixture = (name: string) => path.join(FIXTURES, name);

async function expectDownload(page: Page, name: string) {
  const link = page.getByRole('link', { name: /^Download/ });
  await expect(link).toBeVisible({ timeout: 60_000 });
  await expect(link).toHaveAttribute('download', name);
  const href = await link.getAttribute('href');
  const res = await page.request.get(href ?? '');
  expect(res.status()).toBe(200);
  expect((await res.body()).length).toBeGreaterThan(100);
}

test('a tool page converts after one click', async ({ page }) => {
  await page.goto('/mov-to-mp4');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'MOV to MP4',
  );
  await page.getByLabel('Choose MOV file').setInputFiles(fixture('clip.mov'));
  await expectDownload(page, 'clip.mp4');
  await page.getByRole('button', { name: 'Convert another file' }).click();
  await expect(page.getByText('Choose MOV file')).toBeVisible();
});

test('the home page asks what to do with the file', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Choose a file').setInputFiles(fixture('clip.mp4'));
  await page.getByRole('button', { name: 'Save the sound as MP3' }).click();
  await expectDownload(page, 'clip.mp3');
});

test('trim asks for a start and an end', async ({ page }) => {
  await page.goto('/trim-video');
  await page.getByLabel('Choose video file').setInputFiles(fixture('clip.mp4'));
  await expect(page.getByText(/Clip length: 3\.0 seconds/)).toBeVisible();
  await page.getByLabel('Start (seconds)').fill('1');
  await page.getByRole('button', { name: 'Trim video' }).click();
  await expectDownload(page, 'clip-trimmed.mp4');
});

test('the wrong kind of file gets a plain error', async ({ page }) => {
  await page.goto('/mov-to-mp4');
  await page
    .getByLabel('Choose MOV file')
    .setInputFiles(fixture('picture.png'));
  await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toContainText(
    'This page converts video files',
  );
});

test('there is no drop zone and no ffmpeg jargon', async ({ page }) => {
  for (const url of ['/', '/mov-to-mp4', '/compress-video-to-10mb']) {
    await page.goto(url);
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(
      /ffmpeg -i|-crf|libx264|Advanced|drag and drop|drop (a|your) file/i,
    );
  }
});

for (const url of ['/', '/mov-to-mp4', '/trim-video']) {
  test(`no serious accessibility problems on ${url}`, async ({ page }) => {
    await page.goto(url);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    const bad = violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(bad.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
}

test.describe('on this device', () => {
  test('loads nothing until the user chooses it', async ({
    page,
    isMobile,
  }) => {
    const wasm: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/ffmpeg/')) wasm.push(r.url());
    });
    await page.goto('/mov-to-mp4');
    const button = page.getByLabel('Convert on this device');
    if (isMobile) {
      // No phone measurements yet, so phones do not get the option.
      await expect(button).toHaveCount(0);
    } else {
      await expect(button).toBeVisible();
    }
    await page.getByLabel('Choose MOV file').setInputFiles(fixture('clip.mov'));
    await expectDownload(page, 'clip.mp4');
    expect(wasm).toEqual([]);
  });

  test('converts on the device', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop only');
    const uploads: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/convert')) uploads.push(r.url());
    });
    await page.goto('/mov-to-mp4');
    await page
      .getByLabel('Convert on this device')
      .setInputFiles(fixture('clip.mov'));
    const link = page.getByRole('link', { name: 'Download MP4' });
    await expect(link).toBeVisible({ timeout: 90_000 });
    await expect(link).toHaveAttribute('href', /^blob:/);
    await expect(link).toHaveAttribute('download', 'clip.mp4');
    await expect(page.getByText('Your file did not leave it.')).toBeVisible();
    expect(uploads).toEqual([]);
  });

  test('makes a GIF on the device', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop only');
    await page.goto('/mp4-to-gif');
    await page
      .getByLabel('Convert on this device')
      .setInputFiles(fixture('clip.mp4'));
    await expect(page.getByText(/Clip length: 3\.0 seconds/)).toBeVisible();
    await page.getByRole('button', { name: 'Make GIF on this device' }).click();
    const link = page.getByRole('link', { name: 'Download GIF' });
    await expect(link).toBeVisible({ timeout: 90_000 });
    const size = await page.evaluate(
      async (href) => (await (await fetch(href)).blob()).size,
      (await link.getAttribute('href')) ?? '',
    );
    expect(size).toBeGreaterThan(1000);
  });

  test('audio and image pages have no device option', async ({ page }) => {
    for (const url of [
      '/mp4-to-mp3',
      '/png-to-jpg',
      '/compress-video-to-10mb',
    ]) {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByLabel('Convert on this device')).toHaveCount(0);
    }
  });
});

test.describe('chunked upload', () => {
  // The Go server under test uses TEST_CHUNK_BYTES (playwright.config.ts).
  const chunkRequests = (page: Page) => {
    const urls: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'PUT' && r.url().includes('/api/uploads/')) {
        urls.push(r.url());
      }
    });
    return urls;
  };

  test('a file goes up in chunks, each under the chunk size', async ({
    page,
  }) => {
    // Playwright does not show a Blob body, so read Content-Length: the
    // number that Cloudflare checks.
    const sizes: Promise<number>[] = [];
    page.on('request', (r) => {
      if (r.method() === 'PUT' && r.url().includes('/api/uploads/')) {
        sizes.push(r.allHeaders().then((h) => Number(h['content-length'])));
      }
    });
    const urls = chunkRequests(page);
    const size = statSync(fixture('clip.mov')).size;
    await page.goto('/mov-to-mp4');
    await page.getByLabel('Choose MOV file').setInputFiles(fixture('clip.mov'));
    await expectDownload(page, 'clip.mp4');
    expect(urls.length).toBe(Math.ceil(size / TEST_CHUNK_BYTES));
    expect(urls.length).toBeGreaterThan(1);
    const got = await Promise.all(sizes);
    for (const s of got) {
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThanOrEqual(TEST_CHUNK_BYTES);
    }
    expect(got.reduce((a, b) => a + b, 0)).toBe(size);
  });

  test('a failed chunk is sent again, and the upload finishes', async ({
    page,
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
    const urls = chunkRequests(page);
    await page.goto('/mov-to-mp4');
    await page.getByLabel('Choose MOV file').setInputFiles(fixture('clip.mov'));
    await expectDownload(page, 'clip.mp4');
    expect(failed).toBe(1);
    expect(urls.filter((u) => u.endsWith('/1'))).toHaveLength(2);
  });
});
