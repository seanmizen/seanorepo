import type { AppConfig } from '@shared/types';
import { useQuery } from '@tanstack/react-query';
import {
  createContext,
  type FC,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

/**
 * Whether the floating deployment status card is showing.
 *
 * REQ-CHIPS-008. Deployment chrome belongs to whoever runs the site, so it
 * exists only where the SERVER reports a non-production backend — a visitor to
 * a public marketplace never sees it, whatever they have stored.
 *
 * Where it can appear, showing it is the default: the card's whole job is to
 * say which backend you are on and whether it is up, and a default of OFF
 * would mean the one person who needs it has to go and find it first.
 *
 * The whole card, never individual chips. Which chips exist is a property of
 * the deployment, not a preference, and offering six switches for something
 * nobody wants to curate would be a settings page pretending to be a feature.
 *
 * Per browser, in `localStorage`. It is a display preference, not account
 * state — it has no business on the server, and it should differ between the
 * laptop you develop on and the phone you demo from.
 */
const STORAGE_KEY = 'inside:status-card';

interface ChromeValue {
  /** Whether the card is showing right now. */
  statusCardVisible: boolean;
  /**
   * Whether it COULD show — i.e. this is a non-production backend.
   *
   * Separate from `statusCardVisible` so the account page can hide its
   * preference row entirely rather than offering a switch for something that
   * cannot happen.
   */
  statusCardAvailable: boolean;
  setStatusCardVisible: (visible: boolean) => void;
}

const ChromeContext = createContext<ChromeValue>({
  statusCardVisible: false,
  statusCardAvailable: false,
  setStatusCardVisible: () => {},
});

/** Absent means "not chosen", which is on. Only an explicit 'off' hides it. */
const readPreference = (): boolean => {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    // Storage blocked — a private window, or site data disabled. Falling back
    // to visible keeps the default rather than treating a broken read as a
    // decision the visitor made.
    return true;
  }
};

export const ChromeProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [wanted, setVisible] = useState(readPreference);

  /*
   * REQ-CHIPS-008. Availability comes from the SERVER, never from a build-time
   * flag, and for a strong reason: this decides whether a member of the public
   * sees deployment chrome on a marketplace. A bundle flag says what the
   * frontend was compiled to believe, which is a different claim from what it
   * is actually talking to.
   *
   * Shares the query key with StatusChips, so this costs no extra request.
   * While it is in flight `devMode` is undefined and the card stays hidden —
   * a pending state must not be drawn as the permissive one.
   */
  const config = useQuery({
    queryKey: ['config'],
    queryFn: async () => {
      const { get } = await import('@/lib/http');
      const { api } = await import('@/config');
      return get<AppConfig>(api.endpoints.config);
    },
    staleTime: Number.POSITIVE_INFINITY,
  });

  const statusCardAvailable = config.data?.devMode === true;
  const statusCardVisible = statusCardAvailable && wanted;

  const setStatusCardVisible = useCallback((visible: boolean) => {
    setVisible(visible);
    try {
      localStorage.setItem(STORAGE_KEY, visible ? 'on' : 'off');
    } catch {
      // The choice still applies to this session. It just will not persist.
    }
  }, []);

  const value = useMemo(
    () => ({ statusCardVisible, statusCardAvailable, setStatusCardVisible }),
    [statusCardVisible, statusCardAvailable, setStatusCardVisible],
  );

  return (
    <ChromeContext.Provider value={value}>{children}</ChromeContext.Provider>
  );
};

export const useChrome = (): ChromeValue => useContext(ChromeContext);
