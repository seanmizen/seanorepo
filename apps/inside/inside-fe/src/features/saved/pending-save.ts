/**
 * The pending "save this designer" intent that survives an anonymous
 * visitor's signup round trip. REQ-PRODUCT-003's whole reason for existing:
 * a buyer who clicks Save while signed out must not lose the action to the
 * login wall — it has to complete itself once they sign up.
 *
 * Stored client-side, in this browser only, and consumed at most once. It
 * carries only a `designerProfileId` — public information, not a secret —
 * never a userId. That is what makes "cannot be used to save on behalf of
 * another user" true by construction rather than by a check someone has to
 * remember: whoever completes the next sign-in on this browser is who the
 * save executes for, because the server derives ownership from the session
 * (`getAuthUser`), not from anything this intent carries. See
 * `auth-context.tsx`'s `verify()`, which reads and clears it, and
 * `saved-designers.ts` (backend) for the session-scoped write.
 *
 * TTL mirrors the magic link's own 15-minute expiry (`login.tsx`), so an
 * abandoned signup does not resurface days later against an unrelated
 * sign-in on a shared or borrowed browser.
 */

const KEY = 'inside:pending-save-designer';
const TTL_MS = 15 * 60 * 1000;

interface PendingSave {
  designerProfileId: number;
  createdAt: number;
}

function isPendingSave(value: unknown): value is PendingSave {
  const v = value as Partial<PendingSave> | null;
  return (
    v !== null &&
    typeof v === 'object' &&
    typeof v.designerProfileId === 'number' &&
    typeof v.createdAt === 'number'
  );
}

/** Called when an anonymous visitor clicks Save, just before redirecting. */
export function setPendingSave(designerProfileId: number): void {
  try {
    const value: PendingSave = { designerProfileId, createdAt: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private browsing, a blocked origin, quota).
    // The save simply does not survive the round trip in that case — no
    // worse than the login wall this feature exists to soften.
  }
}

/**
 * Reads and clears in one step, so an intent is used at most once — including
 * a stale or malformed one, which is discarded rather than retried forever.
 */
export function takePendingSave(): number | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    localStorage.removeItem(KEY);

    const parsed: unknown = JSON.parse(raw);
    if (!isPendingSave(parsed)) return null;
    if (Date.now() - parsed.createdAt > TTL_MS) return null;
    return parsed.designerProfileId;
  } catch {
    return null;
  }
}
