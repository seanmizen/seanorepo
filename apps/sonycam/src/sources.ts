import { type ChildProcess, spawn } from 'node:child_process';
import { JpegSplitter, LiveviewParser } from './streams.ts';

export type SourceKind = 'wifi' | 'usb';

export interface Source {
  readonly kind: SourceKind;
  // Known after start(): the camera decides what it supports.
  readonly canRecord: boolean;
  readonly canPhoto: boolean;
  start(onFrame: (jpeg: Uint8Array) => void): Promise<void>;
  stop(): Promise<void>;
  record?(on: boolean): Promise<void>;
  photo?(): Promise<string | null>;
}

export class CameraError extends Error {}

// --- Wi-Fi: Sony Camera Remote API (JSON-RPC over HTTP) ---

// The camera runs its own access point and answers at 192.168.122.1. The
// port differs between models, so try each base URL until one answers.
const DEFAULT_BASES = [
  'http://192.168.122.1:8080/sony',
  'http://192.168.122.1:10000/sony',
];

type RpcResponse = { result?: unknown[]; error?: [number, string] };

export class WifiSource implements Source {
  readonly kind = 'wifi';
  private base: string | null = null;
  private abort: AbortController | null = null;
  private mode: 'still' | 'movie' | null = null;
  private modes: string[] = [];
  canRecord = false;
  readonly canPhoto = true;

  constructor(private readonly bases: string[] = configuredBases()) {}

  async call(method: string, params: unknown[] = []): Promise<unknown[]> {
    const base = this.base ?? (await this.findBase());
    const res = await fetch(`${base}/camera`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, params, id: 1, version: '1.0' }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json()) as RpcResponse;
    if (body.error) {
      throw new CameraError(
        `Camera refused ${method}: ${body.error[1]} (${body.error[0]})`,
      );
    }
    return body.result ?? [];
  }

  private async findBase(): Promise<string> {
    for (const base of this.bases) {
      try {
        const res = await fetch(`${base}/camera`, {
          method: 'POST',
          body: JSON.stringify({
            method: 'getVersions',
            params: [],
            id: 1,
            version: '1.0',
          }),
          signal: AbortSignal.timeout(3_000),
        });
        if (res.ok) {
          this.base = base;
          return base;
        }
      } catch {
        // Try the next base URL.
      }
    }
    throw new CameraError(
      'No camera found on Wi-Fi. Start "Smart Remote" on the camera and connect this PC to its Wi-Fi network.',
    );
  }

  async start(onFrame: (jpeg: Uint8Array) => void): Promise<void> {
    // Older bodies (the A6000 included) must enter remote mode first.
    // Newer bodies do not know this method, so ignore an error.
    await this.call('startRecMode').catch(() => undefined);
    // The A6000 supports "still" only over Wi-Fi, so it cannot record video.
    const [modes] = (await this.call('getSupportedShootMode').catch(() => [
      ['still'],
    ])) as [string[]];
    this.modes = modes;
    this.canRecord = modes.includes('movie');
    const [url] = (await this.call('startLiveview')) as [string];
    this.abort = new AbortController();
    const res = await fetch(url, { signal: this.abort.signal });
    if (!res.body) throw new CameraError('Live view stream has no body.');
    const parser = new LiveviewParser(onFrame);
    const reader = res.body.getReader();
    (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.push(value);
        }
      } catch {
        // Stream ended: stop() aborted it, or the camera dropped off Wi-Fi.
      }
    })();
  }

  async stop(): Promise<void> {
    this.abort?.abort();
    this.abort = null;
    await this.call('stopLiveview').catch(() => undefined);
  }

  private async shootMode(mode: 'still' | 'movie'): Promise<void> {
    if (this.mode === mode) return;
    if (!this.modes.includes(mode)) {
      throw new CameraError(`This camera does not support ${mode} mode.`);
    }
    // A camera with one mode refuses setShootMode, and needs no switch.
    if (this.modes.length > 1) await this.call('setShootMode', [mode]);
    this.mode = mode;
  }

  async record(on: boolean): Promise<void> {
    if (on) {
      await this.shootMode('movie');
      await this.call('startMovieRec');
    } else {
      await this.call('stopMovieRec');
    }
  }

  // The A6000 does not list actTakePicture in getAvailableApiList, but it
  // obeys it. The mode dial must be on P or Auto: Movie blocks the shutter.
  async photo(): Promise<string | null> {
    await this.shootMode('still');
    const [urls] = (await this.call('actTakePicture')) as [string[]];
    return urls?.[0] ?? null;
  }
}

const configuredBases = (): string[] => {
  const env = process.env.SONYCAM_CAMERA_URL;
  return env ? [env.replace(/\/$/, '')] : DEFAULT_BASES;
};

// --- USB: gphoto2 live view (camera in "PC Remote" USB mode) ---

export class UsbSource implements Source {
  readonly kind = 'usb';
  readonly canRecord = false;
  readonly canPhoto = false;
  private proc: ChildProcess | null = null;

  async start(onFrame: (jpeg: Uint8Array) => void): Promise<void> {
    const splitter = new JpegSplitter(onFrame);
    // gphoto2 is Linux-only. On Windows, run it inside WSL, where usbipd
    // attaches the camera. wsl.exe passes the binary stdout through as is.
    const args = ['gphoto2', '--capture-movie', '--stdout'];
    const [cmd, ...rest] =
      process.platform === 'win32' ? ['wsl.exe', '-e', ...args] : args;
    const proc = spawn(cmd, rest, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;
    let stderr = '';
    proc.stdout?.on('data', (chunk: Buffer) => splitter.push(chunk));
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    // Fail fast if gphoto2 is missing or exits at once (no camera found).
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 2_000);
      proc.once('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        reject(
          new CameraError(
            err.code === 'ENOENT'
              ? 'gphoto2 is not installed. In WSL, run: sudo apt install gphoto2'
              : `gphoto2 failed: ${err.message}`,
          ),
        );
      });
      proc.once('exit', (code) => {
        clearTimeout(timer);
        if (/execvpe\(gphoto2\)|gphoto2: not found/.test(stderr)) {
          reject(
            new CameraError(
              'gphoto2 is not installed. In WSL, run: sudo apt install gphoto2',
            ),
          );
          return;
        }
        reject(
          new CameraError(
            `gphoto2 stopped (exit ${code}). Set the camera's USB Connection to "PC Remote" and attach it to WSL with usbipd. ${stderr.trim()}`,
          ),
        );
      });
    });
  }

  async stop(): Promise<void> {
    this.proc?.kill('SIGINT');
    this.proc = null;
  }
}

export const createSource = (kind: SourceKind): Source =>
  kind === 'wifi' ? new WifiSource() : new UsbSource();
