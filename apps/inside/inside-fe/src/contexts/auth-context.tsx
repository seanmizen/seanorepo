import type { User } from '@shared/types';
import {
  createContext,
  type FC,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api } from '@/config';
import { takePendingSave } from '@/features/saved/pending-save';
import { ApiError, get, send, setUnauthorizedHandler } from '@/lib/http';

export type SignupRole = 'buyer' | 'designer';

interface AuthContextValue {
  user: User | null;
  /** True until the initial /me check resolves — routes must wait for this. */
  loading: boolean;
  /**
   * The session ended rather than never existing. REQ-AUTH-008.
   *
   * Distinct from `user === null`, which is the ordinary anonymous case. This
   * says a cookie was present and the server refused it, so the visitor should
   * be told why they are back at the login page instead of silently bounced.
   */
  sessionEnded: boolean;
  requestMagicLink: (
    email: string,
    role: SignupRole,
    returnTo?: string,
  ) => Promise<{ devLink?: string }>;
  verify: (token: string, returnTo?: string) => Promise<{ returnTo: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  sessionEnded: false,
  requestMagicLink: async () => ({}),
  verify: async () => ({ returnTo: '/' }),
  logout: async () => {},
});

export const useAuth = (): AuthContextValue => useContext(AuthContext);

/**
 * Only same-site relative paths are ever followed after signing in. The
 * backend applies the same rule. This is the second half of the same guard,
 * because the value also reaches `navigate()` on the client.
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value) return '/';
  if (!value.startsWith('/')) return '/';
  if (value.startsWith('//')) return '/';
  if (value.includes('\\')) return '/';
  return value;
}

export const AuthProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * Set once a sign-in or sign-out has given us a definitive answer.
   *
   * The boot check below races anything the page does on mount. On /verify
   * they start together: the boot check asks "who am I" before the cookie
   * exists and gets `null`, while verify signs the user in. If the boot check
   * resolves last it would overwrite the freshly signed-in user with null and
   * bounce them back to login — so it defers to an explicit action.
   */
  const settledByAction = useRef(false);
  const [sessionEnded, setSessionEnded] = useState(false);

  /*
   * Any 401 from anywhere ends the session here, once. Before this each caller
   * met the 401 alone and showed its own generic error, while the header and
   * ProtectedRoute carried on as though nothing had happened.
   */
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setSessionEnded(true);
      settledByAction.current = true;
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // Cookie is httpOnly, so the only way to know who we are is to ask.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { user: resolved } = await get<{ user: User | null }>(
          api.endpoints.me,
        );
        if (!cancelled && !settledByAction.current) setUser(resolved ?? null);
      } catch (error) {
        /*
         * REQ-AUTH-008. The three cases are finally distinguished.
         *
         * `/me` answers 200 with a null user when signed out and 401 only for
         * a cookie that is present but revoked (REQ-AUTH-005) — so a 401 here
         * means a real session ended, and the visitor is owed an explanation.
         *
         * A transport failure is NOT a sign-out. It says nothing about the
         * session, so claiming one ended would be asserting something we have
         * not verified. The offline banner covers that case honestly.
         */
        const revoked = error instanceof ApiError && error.status === 401;

        /*
         * The 401 is recorded BEFORE the cancelled/settled guard, because it is
         * a fact about the session rather than a proposal about the UI. The
         * guard exists to stop a stale boot check overwriting a fresh sign-in
         * (see `settledByAction` above) — it was never meant to discard a
         * server verdict, and discarding one leaves `loading` false with no
         * reason recorded, which is a silent bounce to the login page.
         */
        if (revoked) setSessionEnded(true);

        if (cancelled || settledByAction.current) return;
        setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const requestMagicLink = useCallback(
    async (email: string, role: SignupRole, returnTo?: string) => {
      return send<{ devLink?: string }>(api.endpoints.magicLink, 'POST', {
        email,
        role,
        returnTo: safeReturnTo(returnTo),
      });
    },
    [],
  );

  const verify = useCallback(async (token: string, returnTo?: string) => {
    const url = `${api.endpoints.verify}?token=${encodeURIComponent(token)}&returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
    const data = await get<{ user: User; returnTo?: string }>(url);
    settledByAction.current = true;
    setSessionEnded(false);
    setUser(data.user);

    /*
     * REQ-PRODUCT-003. A signed-out visitor who clicked Save was sent here
     * carrying an intent (`setPendingSave`, in `save-designer-button.tsx`).
     * Completing it BEFORE returning means the caller's navigate(returnTo)
     * always lands on a page that is already correct — no manual refresh,
     * because the query on the returned-to page has not even mounted yet.
     *
     * Best-effort and swallowed: a signup that succeeded must not be undone
     * by a save that failed. The visitor still lands where they were and can
     * press Save again if this silently did not land.
     */
    const pendingDesignerId = takePendingSave();
    if (pendingDesignerId !== null) {
      try {
        await send(
          `${api.endpoints.savedDesigners}/${pendingDesignerId}`,
          'POST',
        );
      } catch {
        // See above — deliberately not surfaced.
      }
    }

    return { returnTo: safeReturnTo(data.returnTo) };
  }, []);

  /*
   * REQ-AUTH-006 is about the SERVER session ending, so a logout that failed
   * must not clear local state and report success. Doing that told a visitor
   * they were signed out while their session stayed live — worst for exactly
   * the person who most needs it, someone on a shared machine.
   *
   * The throw is deliberate: the caller shows it rather than the app quietly
   * pretending.
   */
  const logout = useCallback(async () => {
    await send(api.endpoints.logout, 'POST');
    settledByAction.current = true;
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, sessionEnded, requestMagicLink, verify, logout }),
    [user, loading, sessionEnded, requestMagicLink, verify, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
