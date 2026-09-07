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
 * REQ-CHIPS-007. Deployment chrome is useful to whoever runs the site and
 * noise to everyone else, so it is a visitor's choice — but only after they
 * make one. The default is ON, because the card's whole job is to say which
 * backend you are looking at and whether it is up, and a default of OFF would
 * mean the one person who needs that has to go find it first.
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
  statusCardVisible: boolean;
  setStatusCardVisible: (visible: boolean) => void;
}

const ChromeContext = createContext<ChromeValue>({
  statusCardVisible: true,
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
  const [statusCardVisible, setVisible] = useState(readPreference);

  const setStatusCardVisible = useCallback((visible: boolean) => {
    setVisible(visible);
    try {
      localStorage.setItem(STORAGE_KEY, visible ? 'on' : 'off');
    } catch {
      // The choice still applies to this session; it just will not persist.
    }
  }, []);

  const value = useMemo(
    () => ({ statusCardVisible, setStatusCardVisible }),
    [statusCardVisible, setStatusCardVisible],
  );

  return (
    <ChromeContext.Provider value={value}>{children}</ChromeContext.Provider>
  );
};

export const useChrome = (): ChromeValue => useContext(ChromeContext);
