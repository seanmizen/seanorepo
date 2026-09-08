import { api } from '@/config';

/**
 * The one HTTP client. REQ-NET-001.
 *
 * Before this there were four copies of the same wrapper with three
 * incompatible error shapes — two of them threw `Error("404 from http://…")`,
 * a debug string with the status embedded as unparsed text. That is why only
 * one page in the app could tell a 404 from a dead backend, and why five
 * others told a visitor "that studio is not listed" when the real answer was
 * "our server is down".
 *
 * Everything that talks to the API goes through here.
 */

/** What went wrong, at the level a page can actually act on. */
export type FailureKind =
  /** The server answered, and said no. `status` is meaningful. */
  | 'http'
  /** No answer within the deadline. `status` is 0. */
  | 'timeout'
  /** The request never reached a server at all. `status` is 0. */
  | 'network';

/**
 * A request that failed, carrying enough for the caller to say something true.
 *
 * `status` is 0 for anything that never got an HTTP response, which is the
 * distinction that lets "your wifi died" stop being rendered as "that studio
 * is not listed".
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: FailureKind = 'http',
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when the server never answered — offline, DNS, CORS, timeout. */
  get isTransport(): boolean {
    return this.kind !== 'http';
  }
}

/**
 * How long to wait before calling it.
 *
 * `fetch` has no default timeout, so before this a hung backend left a query
 * in `isPending` forever — `retry` never fired, because the promise never
 * settled, so there was no failure state to render at all. Generous enough for
 * a slow tunnel, short enough that a visitor learns something.
 */
export const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Retry a server fault or an unreachable server. Never a 4xx, never a timeout.
 *
 * Three separate judgements, and the middle one is the non-obvious part:
 *
 * - A **4xx is an answer.** Retrying it twice with backoff — which is what the
 *   previous blanket `retry: 2` did — only makes the app slower to admit it.
 * - A **timeout is expensive to retry.** The deadline has already been paid
 *   once. Two more attempts means the visitor stares at a skeleton for 45
 *   seconds instead of being told at 15. Failing fast and offering a retry
 *   they choose to press beats deciding to wait on their behalf.
 * - A **network error is cheap to retry** — it fails immediately, so a second
 *   attempt costs almost nothing and genuinely rescues a blip.
 */
export const isRetryable = (error: unknown): boolean => {
  if (!(error instanceof ApiError)) return false;
  if (error.kind === 'timeout') return false;
  return error.kind === 'network' || error.status >= 500;
};

const messageFor = (status: number): string =>
  status >= 500
    ? 'Something went wrong at our end.'
    : `That request was refused (${status}).`;

/**
 * Told whenever any request comes back 401. REQ-AUTH-008.
 *
 * A session can end mid-flow — expired, or revoked from another browser — and
 * before this nothing in the app noticed. The 401 surfaced as whatever generic
 * error the page happened to own, while the header still showed the visitor
 * signed in and `ProtectedRoute` still admitted them. They were left pressing
 * Save against a red box.
 *
 * Registered by AuthProvider rather than imported by it, so `lib/` keeps
 * knowing nothing about auth — this module's job is transport.
 */
type UnauthorizedHandler = (url: string) => void;

let onUnauthorized: UnauthorizedHandler | null = null;

export const setUnauthorizedHandler = (
  handler: UnauthorizedHandler | null,
): void => {
  onUnauthorized = handler;
};

export interface RequestOptions extends RequestInit {
  /** Override the deadline. Uploads use their own path. See `uploadImage`. */
  timeoutMs?: number;
}

export async function request<T>(
  url: string,
  { timeoutMs = REQUEST_TIMEOUT_MS, ...init }: RequestOptions = {},
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, {
      credentials: 'include',
      signal: AbortSignal.timeout(timeoutMs),
      headers:
        init.body && !(init.body instanceof FormData)
          ? { 'Content-Type': 'application/json', ...init.headers }
          : init.headers,
      ...init,
    });
  } catch (caught) {
    // A thrown fetch means no response at all. `AbortSignal.timeout` raises a
    // TimeoutError. Everything else here is DNS, CORS, or the network being
    // gone. Neither is an HTTP status, so neither gets one.
    const timedOut =
      caught instanceof DOMException && caught.name === 'TimeoutError';
    throw new ApiError(
      timedOut
        ? 'That took too long to answer.'
        : 'We could not reach the server.',
      0,
      timedOut ? 'timeout' : 'network',
    );
  }

  const requestId = response.headers.get('x-request-id') ?? undefined;

  if (!response.ok) {
    // The server's own wording wherever it has any: "That file is 14MB. The
    // limit is 8MB" beats a generic failure, and is the only message that says
    // what to do next.
    let message = messageFor(response.status);
    try {
      const body = (await response.json()) as { error?: string };
      if (typeof body.error === 'string' && body.error.length > 0) {
        message = body.error;
      }
    } catch {
      // A non-JSON error body is not itself worth surfacing.
    }
    /*
     * The session check is exempt, deliberately. `/auth/me` answers 401 for a
     * cookie that is present but revoked (REQ-AUTH-005), and that IS how the
     * app learns the session ended — but it is answered by AuthProvider's own
     * boot logic. Routing it through the global handler as well would have the
     * provider reacting to its own request.
     */
    if (response.status === 401 && !url.includes('/auth/me')) {
      onUnauthorized?.(url);
    }

    throw new ApiError(message, response.status, 'http', requestId);
  }

  return response.json() as Promise<T>;
}

/** `GET`, which is most of them. */
export const get = <T>(url: string, options?: RequestOptions): Promise<T> =>
  request<T>(url, options);

/** Sends `body` as JSON. */
export const send = <T>(
  url: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown,
  options?: RequestOptions,
): Promise<T> =>
  request<T>(url, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...options,
  });

export { api };

export interface FailureDescription {
  /** Heading. What kind of nothing this is. */
  title: string;
  /** Body copy. What actually happened, as far as we know it. */
  body: string;
  severity: 'info' | 'error' | 'warning';
  /** For a test to assert on, and for a support conversation to quote. */
  requestId?: string;
}

/**
 * Say what actually went wrong. REQ-NET-007.
 *
 * Every public read page used to render the same `severity="info"` line —
 * "that studio is not listed" — for a 404, a 500, a dead tunnel and a dropped
 * wifi connection. Three of those four are the app asserting something it has
 * not verified, which is exactly what REQ-STATE-003 forbids. It just happened
 * one layer up from where that requirement was being applied.
 *
 * `notFound` is the caller's, because only the caller knows what was missing.
 */
export const describeFailure = (
  error: unknown,
  notFound: { title: string; body: string },
): FailureDescription => {
  if (!(error instanceof ApiError)) {
    return {
      title: 'Something went wrong',
      body: 'That did not work. Try again in a moment.',
      severity: 'error',
    };
  }

  if (error.kind === 'network') {
    return {
      title: 'No connection',
      body: 'We could not reach the server. Check your connection and try again.',
      severity: 'warning',
    };
  }

  if (error.kind === 'timeout') {
    return {
      title: 'That took too long',
      body: 'The server did not answer in time. It may be busy — try again in a moment.',
      severity: 'warning',
    };
  }

  if (error.status >= 500) {
    return {
      title: 'Something went wrong at our end',
      body: 'This is our fault, not yours. Try again shortly.',
      severity: 'error',
      requestId: error.requestId,
    };
  }

  return { ...notFound, severity: 'info' };
};
