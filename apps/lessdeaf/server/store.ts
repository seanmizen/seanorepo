// Where: apps/lessdeaf/server/store.ts
// Why: the session files on disk. app.ts calls it. The tests use a temp
// folder.
//
// Layout, one folder per session:
//   <dataDir>/sessions/<id>/session.json             the phone's metadata
//   <dataDir>/sessions/<id>/parts/<seq>.pcm          audio chunks, before finish
//   <dataDir>/sessions/<id>/audio.wav                after finish
//   <dataDir>/sessions/<id>/transcripts/<name>.json  one per pipeline
//
// A chunk is 16-bit little-endian PCM, interleaved, at the rate and channel
// count in session.json (device.sampleRate, device.channels). The phone can
// send a chunk again after a lost response. The second write replaces the
// first, so a retry is safe.

import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const PIPELINE_RE = /^[a-z0-9][a-z0-9.+_-]{0,79}$/;

export class StoreError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: string[],
  ) {
    super(message);
  }
}

export type SessionSummary = {
  id: string;
  metadata: Record<string, unknown>;
  hasAudio: boolean;
  pendingParts: number;
  transcripts: string[];
};

const seqName = (seq: number) => `${String(seq).padStart(6, '0')}.pcm`;

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function list(dir: string) {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

/** Writes to a temp file, then renames it. A reader never sees half a file. */
async function writeAtomic(path: string, data: Uint8Array | string) {
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await Bun.write(temp, data);
  await rename(temp, path);
}

export function wavHeader(
  dataBytes: number,
  sampleRate: number,
  channels: number,
) {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, dataBytes, true);
  return new Uint8Array(header);
}

export function createStore(dataDir: string) {
  const root = join(dataDir, 'sessions');

  function folder(id: string) {
    if (!ID_RE.test(id))
      throw new StoreError(400, 'The session ID is not valid.');
    return join(root, id);
  }

  async function readMetadata(id: string): Promise<Record<string, unknown>> {
    const file = Bun.file(join(folder(id), 'session.json'));
    if (!(await file.exists()))
      throw new StoreError(404, 'The session does not exist.');
    return (await file.json()) as Record<string, unknown>;
  }

  async function summary(id: string): Promise<SessionSummary> {
    const dir = folder(id);
    const transcripts = (await list(join(dir, 'transcripts')))
      .filter((n) => n.endsWith('.json'))
      .map((n) => n.slice(0, -5))
      .sort();
    return {
      id,
      metadata: await readMetadata(id),
      hasAudio: await exists(join(dir, 'audio.wav')),
      pendingParts: (await list(join(dir, 'parts'))).filter((n) =>
        n.endsWith('.pcm'),
      ).length,
      transcripts,
    };
  }

  return {
    async init() {
      await mkdir(root, { recursive: true });
    },

    async count() {
      return (await list(root)).filter((n) => ID_RE.test(n)).length;
    },

    async putMetadata(id: string, metadata: Record<string, unknown>) {
      const dir = folder(id);
      await mkdir(dir, { recursive: true });
      await writeAtomic(
        join(dir, 'session.json'),
        JSON.stringify({ ...metadata, id }, null, 2),
      );
    },

    async putPart(id: string, seq: number, data: Uint8Array) {
      await readMetadata(id);
      if (data.byteLength % 2 !== 0)
        throw new StoreError(
          400,
          'The chunk length must be a whole number of 16-bit samples.',
        );
      const dir = join(folder(id), 'parts');
      await mkdir(dir, { recursive: true });
      await writeAtomic(join(dir, seqName(seq)), data);
    },

    /** Joins parts 0 to parts-1 into audio.wav, then deletes the parts. */
    async finishAudio(id: string, parts: number) {
      const metadata = await readMetadata(id);
      const dir = folder(id);
      const device = (metadata.device ?? {}) as Record<string, unknown>;
      const sampleRate = Math.round(Number(device.sampleRate));
      const channels = Math.round(Number(device.channels));
      if (!(sampleRate > 0) || !(channels > 0))
        throw new StoreError(
          422,
          'session.json must hold device.sampleRate and device.channels before the audio can finish.',
        );

      const wav = join(dir, 'audio.wav');
      const partsDir = join(dir, 'parts');
      const present = new Set(await list(partsDir));
      // A retry of finish after a lost response: the WAV exists and the parts are gone.
      if (present.size === 0 && (await exists(wav))) return;

      const missing: string[] = [];
      for (let seq = 0; seq < parts; seq++)
        if (!present.has(seqName(seq))) missing.push(String(seq));
      if (missing.length)
        throw new StoreError(409, 'Some audio chunks are missing.', missing);

      const files = Array.from({ length: parts }, (_, seq) =>
        Bun.file(join(partsDir, seqName(seq))),
      );
      const bytes = files.reduce((sum, f) => sum + f.size, 0);
      // One part at a time, so a long session never sits in memory.
      const temp = `${wav}.${process.pid}.${Date.now()}.tmp`;
      const out = await open(temp, 'w');
      try {
        await out.write(wavHeader(bytes, sampleRate, channels));
        for (const file of files) await out.write(await file.bytes());
      } finally {
        await out.close();
      }
      await rename(temp, wav);
      await rm(partsDir, { recursive: true, force: true });
    },

    async putTranscript(id: string, pipeline: string, body: string) {
      await readMetadata(id);
      if (!PIPELINE_RE.test(pipeline))
        throw new StoreError(400, 'The pipeline name is not valid.');
      const dir = join(folder(id), 'transcripts');
      await mkdir(dir, { recursive: true });
      await writeAtomic(join(dir, `${pipeline}.json`), body);
    },

    async listSessions() {
      const ids = (await list(root)).filter((n) => ID_RE.test(n));
      const sessions = await Promise.all(
        ids.map((id) => summary(id).catch(() => null)),
      );
      return sessions
        .filter((s): s is SessionSummary => s !== null)
        .sort((a, b) => (a.id < b.id ? 1 : -1));
    },

    summary,

    audioFile(id: string) {
      return Bun.file(join(folder(id), 'audio.wav'));
    },

    transcriptFile(id: string, pipeline: string) {
      if (!PIPELINE_RE.test(pipeline))
        throw new StoreError(400, 'The pipeline name is not valid.');
      return Bun.file(join(folder(id), 'transcripts', `${pipeline}.json`));
    },

    async deleteSession(id: string) {
      await readMetadata(id);
      await rm(folder(id), { recursive: true, force: true });
    },
  };
}

export type Store = ReturnType<typeof createStore>;
