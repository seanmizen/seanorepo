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

export type SignupRole = 'buyer' | 'designer';

interface AuthContextValue {
  user: User | null;
  /** True until the initial /me check resolves — routes must wait for this. */
  loading: boolean;
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
  requestMagicLink: async () => ({}),
  verify: async () => ({ returnTo: '/' }),
  logout: async () => {},
});

export const useAuth = (): AuthContextValue => useContext(AuthContext);

/**
 * Only same-site relative paths are ever followed after signing in. The
 * backend applies the same rule; this is the second half of the same guard,
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

  // Cookie is httpOnly, so the only way to know who we are is to ask.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(api.endpoints.me, { credentials: 'include' });
        const resolved = res.ok ? ((await res.json()).user ?? null) : null;
        if (!cancelled && !settledByAction.current) setUser(resolved);
      } catch {
        if (!cancelled && !settledByAction.current) setUser(null);
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
      const res = await fetch(api.endpoints.magicLink, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, role, returnTo: safeReturnTo(returnTo) }),
      });
      if (!res.ok) {
        throw new Error(
          (await res.json().catch(() => ({}))).error ??
            'Could not send the sign-in link',
        );
      }
      return res.json();
    },
    [],
  );

  const verify = useCallback(async (token: string, returnTo?: string) => {
    const url = `${api.endpoints.verify}?token=${encodeURIComponent(token)}&returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      throw new Error(
        (await res.json().catch(() => ({}))).error ??
          'This sign-in link is invalid or has expired',
      );
    }
    const data = await res.json();
    settledByAction.current = true;
    setUser(data.user);
    return { returnTo: safeReturnTo(data.returnTo) };
  }, []);

  const logout = useCallback(async () => {
    await fetch(api.endpoints.logout, {
      method: 'POST',
      credentials: 'include',
    });
    settledByAction.current = true;
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, requestMagicLink, verify, logout }),
    [user, loading, requestMagicLink, verify, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
