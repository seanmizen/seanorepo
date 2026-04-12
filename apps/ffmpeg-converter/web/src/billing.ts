// Billing module — session management, account fetching, and Stripe redirects.
// All network calls go through /api/billing/* (proxied by the dev server).

const SESSION_KEY = 'ffmpeg-converter:session';
const API = '/api';

// ── types ─────────────────────────────────────────────────────────────────────

export interface BillingAccount {
  logged_in: boolean;
  email?: string;
  tier: 'free' | 'pro' | 'enterprise';
  token_balance: number;
  daily_ops_used: number;
  daily_ops_max: number; // -1 = unlimited
}

export interface BillingError {
  error: string;
  kind:
    | 'auth_required'
    | 'insufficient_tokens'
    | 'daily_limit'
    | 'billing_error';
  message: string;
  required_tokens?: number;
  balance?: number;
  daily_used?: number;
  daily_max?: number;
}

// ── session token helpers ─────────────────────────────────────────────────────

export function getSessionToken(): string | null {
  return localStorage.getItem(SESSION_KEY);
}

export function setSessionToken(token: string): void {
  localStorage.setItem(SESSION_KEY, token);
}

export function clearSessionToken(): void {
  localStorage.removeItem(SESSION_KEY);
}

// ── API helpers ───────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const token = getSessionToken();
  if (!token) return {};
  return { 'X-Session-Token': token };
}

// ── account ───────────────────────────────────────────────────────────────────

export async function fetchAccount(): Promise<BillingAccount> {
  const res = await fetch(`${API}/billing/me`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    // Gracefully return anonymous on any error.
    return {
      logged_in: false,
      tier: 'free',
      token_balance: 0,
      daily_ops_used: 0,
      daily_ops_max: -1,
    };
  }
  return res.json() as Promise<BillingAccount>;
}

// ── identify ──────────────────────────────────────────────────────────────────

/** Creates or retrieves an account for the given email. Returns the session token. */
export async function identify(email: string): Promise<string> {
  const res = await fetch(`${API}/billing/identify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const data = (await res.json()) as { error?: string };
    throw new Error(data.error ?? 'identify failed');
  }
  const data = (await res.json()) as { session_token: string; email: string };
  setSessionToken(data.session_token);
  return data.session_token;
}

// ── checkout ──────────────────────────────────────────────────────────────────

/** Redirects the browser to a Stripe Checkout session for a subscription plan. */
export async function redirectToSubscriptionCheckout(
  plan: 'pro' | 'enterprise',
): Promise<void> {
  const res = await fetch(`${API}/billing/checkout/subscription`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ plan }),
  });
  if (!res.ok) {
    const data = (await res.json()) as { error?: string };
    throw new Error(data.error ?? 'checkout failed');
  }
  const { url } = (await res.json()) as { url: string };
  window.location.href = url;
}

/** Redirects the browser to a Stripe Checkout session for a token pack purchase. */
export async function redirectToTokenCheckout(
  pack: '50' | '250' | '1000',
): Promise<void> {
  const res = await fetch(`${API}/billing/checkout/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ pack }),
  });
  if (!res.ok) {
    const data = (await res.json()) as { error?: string };
    throw new Error(data.error ?? 'checkout failed');
  }
  const { url } = (await res.json()) as { url: string };
  window.location.href = url;
}

/** Redirects the browser to the Stripe Billing Portal. */
export async function redirectToPortal(): Promise<void> {
  const res = await fetch(`${API}/billing/portal`, {
    method: 'POST',
    headers: { ...authHeaders() },
  });
  if (!res.ok) {
    const data = (await res.json()) as { error?: string };
    throw new Error(data.error ?? 'portal redirect failed');
  }
  const { url } = (await res.json()) as { url: string };
  window.location.href = url;
}
