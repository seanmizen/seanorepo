// The network layer of the model adapters.
//
// - Offline mode (REQ-QC-030): with QC_OFFLINE=1, a model request goes only
//   to a loopback host. Any other host stops the run with OfflineError.
//   An unset QC_OFFLINE changes nothing.
// - postJson (REQ-QC-033): one JSON POST with no headers timeout, a total
//   timeout per provider, and a limit on parallel requests per provider. A
//   local server on one GPU does one request at a time, and one request can
//   take many minutes.
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { Actor, Models, Provider } from '../cast.ts';

/** The run stops on this error. The engine does not journal it as a model error. */
export class OfflineError extends Error {}

export const offlineMode = () => {
  const v = process.env.QC_OFFLINE?.trim().toLowerCase();
  return !!v && v !== '0' && v !== 'false' && v !== 'no';
};

/** True for localhost, *.localhost, 127.0.0.0/8 and ::1. */
export function isLoopback(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  );
}

/** Stop with OfflineError when offline mode is on and the URL is not local. */
export function checkOffline(providerName: string, url: string) {
  if (!offlineMode() || isLoopback(url)) return;
  throw new OfflineError(
    `Offline mode is on (QC_OFFLINE). Provider "${providerName}" points to ${url}. That host is not local. Use a provider on localhost or 127.0.0.1, or unset QC_OFFLINE.`,
  );
}

/** The host that the Anthropic SDK calls. */
export const anthropicBase = (baseUrl?: string) =>
  baseUrl ?? process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com';

export const DEFAULT_OPENAI_BASE = 'http://localhost:11434/v1';

export const baseOf = (provider: Provider) =>
  (provider.base_url ?? DEFAULT_OPENAI_BASE).replace(/\/$/, '');

/**
 * Check an actor before its seat works. A built-in provider (script, idle,
 * external) makes no request, so it always passes.
 */
export function checkActorOffline(models: Models, actor: Actor) {
  const provider = models.providers[actor.provider];
  if (!provider) return;
  checkOffline(
    actor.provider,
    provider.kind === 'anthropic'
      ? anthropicBase(provider.base_url)
      : baseOf(provider),
  );
}

// Parallel requests per provider. A request waits for a free slot.
const slots = new Map<string, { busy: number; queue: (() => void)[] }>();

async function withSlot<T>(
  key: string,
  limit: number | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!limit) return fn();
  const s = slots.get(key) ?? { busy: 0, queue: [] };
  slots.set(key, s);
  if (s.busy >= limit) await new Promise<void>((go) => s.queue.push(go));
  else s.busy += 1;
  try {
    return await fn();
  } finally {
    const next = s.queue.shift();
    if (next) next();
    else s.busy -= 1;
  }
}

/**
 * POST JSON to a provider and return the parsed reply. The total timeout is
 * `timeout_s` of the provider (default 1800 seconds). Throws on an HTTP error.
 * `ms` is the time of the request only. It starts when the request gets its
 * slot, so the wait for the slot is not in it (REQ-QC-032).
 */
export function postJson(
  providerName: string,
  provider: Provider,
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ body: unknown; ms: number }> {
  checkOffline(providerName, url);
  const timeoutMs = (provider.timeout_s ?? 1800) * 1000;
  return withSlot(
    providerName,
    provider.concurrency,
    () =>
      new Promise<{ body: unknown; ms: number }>((resolve, reject) => {
        const t0 = performance.now();
        const u = new URL(url);
        const data = Buffer.from(JSON.stringify(body));
        const req = (u.protocol === 'https:' ? httpsRequest : httpRequest)(
          u,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'content-length': String(data.length),
              ...headers,
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('error', reject);
            res.on('end', () => {
              clearTimeout(timer);
              const text = Buffer.concat(chunks).toString('utf8');
              const status = res.statusCode ?? 0;
              if (status < 200 || status >= 300) {
                reject(
                  new Error(
                    `${url} returned HTTP ${status}: ${text.slice(0, 300)}`,
                  ),
                );
                return;
              }
              try {
                resolve({
                  body: JSON.parse(text),
                  ms: Math.round(performance.now() - t0),
                });
              } catch {
                reject(
                  new Error(
                    `${url} returned text that is not JSON: ${text.slice(0, 300)}`,
                  ),
                );
              }
            });
          },
        );
        const timer = setTimeout(() => {
          req.destroy(
            new Error(
              `${url} gave no reply in ${timeoutMs / 1000} seconds. Increase timeout_s of provider "${providerName}".`,
            ),
          );
        }, timeoutMs);
        req.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        req.end(data);
      }),
  );
}
