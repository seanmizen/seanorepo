import { useCallback, useEffect, useState } from 'react';

/**
 * Form state that survives a refresh or a wander away mid-edit.
 *
 * REQ-ONBOARD-002. Onboarding is the funnel that decides whether good
 * designers join, and it is long: a studio name, a bio worth reading, a
 * location, several pieces of work. Losing half of that to a stray refresh or
 * a phone call is the point at which someone gives up and does not come back.
 *
 * The server holds everything already saved. This holds the keystrokes since.
 * The two are layered rather than merged — the draft wins when present,
 * because by construction it is newer than the last save.
 *
 * `localStorage` throws outright in some contexts (private windows, blocked
 * site data), so every access is guarded and a failure degrades to ordinary
 * unsaved form state rather than taking the page down.
 */
export function useDraft<T extends object>(
  key: string,
  initial: T,
): [T, (next: Partial<T>) => void, () => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (!stored) return initial;
      return { ...initial, ...(JSON.parse(stored) as Partial<T>) };
    } catch {
      return initial;
    }
  });

  // Re-seed when the server's copy arrives after first render, but never over
  // the top of a draft: the draft is the newer of the two.
  useEffect(() => {
    try {
      if (localStorage.getItem(key) === null) setValue(initial);
    } catch {
      setValue(initial);
    }
    // Keyed on the serialised initial value so a fresh object literal from the
    // caller does not re-seed on every render.
  }, [key, JSON.stringify(initial)]);

  const update = useCallback(
    (next: Partial<T>) => {
      setValue((current) => {
        const merged = { ...current, ...next };
        try {
          localStorage.setItem(key, JSON.stringify(merged));
        } catch {
          // Unsaved-but-in-memory is still better than losing the keystroke.
        }
        return merged;
      });
    },
    [key],
  );

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing to clear if it could never be written.
    }
  }, [key]);

  return [value, update, clear];
}
