import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { HealthResponse } from '@shared/types';
import { openDatabase } from './db';
import { buildApp } from './index';

describe('GET /api/health', () => {
  test('returns { ok: true }', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json<HealthResponse>()).toEqual({ ok: true });
    await app.close();
  });
});

describe('openDatabase', () => {
  test('opens the file in WAL mode', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'crm-db-'));
    const db = openDatabase(path.join(dir, 'nested', 'crm.db'));
    const row = db.query('PRAGMA journal_mode;').get() as {
      journal_mode: string;
    };
    expect(row.journal_mode).toBe('wal');
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
