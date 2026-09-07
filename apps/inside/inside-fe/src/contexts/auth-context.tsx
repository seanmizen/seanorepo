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
import { get, send } from '@/lib/http';

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
        const { user: resolved } = await get<{ user: User | null }>(
          api.endpoints.me,
        );
        if (!cancelled && !settledByAction.current) setUser(resolved ?? null);
      } catch {
        /*
         * Every failure becomes "signed out", which is the behaviour this
         * replaced and is deliberately unchanged here.
         *
         * It is also wrong, and #215 fixes it: `/me` answers 200 with a null
         * user when signed out and 401 only for a cookie that is present but
         * revoked (REQ-AUTH-005), so flattening them loses the one case worth
         * knowing about — and a transport failure currently reads as a
         * sign-out too. Splitting them is a behaviour change with its own
         * tests, so it is not smuggled in here.
         */
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
    setUser(data.user);
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
    () => ({ user, loading, requestMagicLink, verify, logout }),
    [user, loading, requestMagicLink, verify, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
