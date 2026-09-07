import {
  createContext,
  type FC,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useLocation } from 'react-router-dom';

/** Real names for crumbs, keyed by the path each crumb stands for. */
type CrumbTitles = Readonly<Record<string, string>>;

interface BreadcrumbTitleValue {
  titles: CrumbTitles;
  setTitles: (patch: CrumbTitles) => void;
  clearTitles: (paths: readonly string[]) => void;
}

const BreadcrumbTitleContext = createContext<BreadcrumbTitleValue>({
  titles: {},
  setTitles: () => {},
  clearTitles: () => {},
});

/**
 * Lets pages give crumbs their real names.
 *
 * The route table can only hold placeholders, and for a parameterised path
 * even a good placeholder says nothing: `/designers/:slug` is "studio" for
 * every studio. Names are keyed BY PATH rather than "the current page", so a
 * nested page can name its ancestors too — a portfolio piece knows the studio
 * it belongs to, and that name belongs on the studio's crumb, not only its own.
 */
export const BreadcrumbTitleProvider: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [titles, setTitlesState] = useState<CrumbTitles>({});

  const setTitles = useCallback((patch: CrumbTitles) => {
    setTitlesState((current) => {
      // Skip the update when nothing changed, or every render of a page that
      // passes a fresh object literal would loop.
      const changed = Object.entries(patch).some(
        ([path, title]) => current[path] !== title,
      );
      return changed ? { ...current, ...patch } : current;
    });
  }, []);

  const clearTitles = useCallback((paths: readonly string[]) => {
    setTitlesState((current) => {
      const next = { ...current };
      for (const path of paths) delete next[path];
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ titles, setTitles, clearTitles }),
    [titles, setTitles, clearTitles],
  );

  return (
    <BreadcrumbTitleContext.Provider value={value}>
      {children}
    </BreadcrumbTitleContext.Provider>
  );
};

/** Read by the breadcrumb only; pages use the hooks below. */
export const useBreadcrumbTitles = (): CrumbTitles =>
  useContext(BreadcrumbTitleContext).titles;

/**
 * Name crumbs by path.
 *
 * Entries whose value is undefined or blank are ignored, so a page can pass
 * `{ [path]: data?.name }` while the data is still loading and the crumb keeps
 * degrading to the URL segment rather than rendering blank. Everything set is
 * cleared on unmount, so a name never leaks onto the next page.
 */
export const useCrumbTitles = (
  entries: Readonly<Record<string, string | null | undefined>>,
): void => {
  const { setTitles, clearTitles } = useContext(BreadcrumbTitleContext);
  // Stringified so a fresh object literal on every render does not re-fire.
  const serialised = JSON.stringify(entries);

  useEffect(() => {
    const parsed = JSON.parse(serialised) as Record<
      string,
      string | null | undefined
    >;
    const usable: Record<string, string> = {};
    for (const [path, title] of Object.entries(parsed)) {
      const trimmed = typeof title === 'string' ? title.trim() : '';
      if (trimmed.length > 0) usable[path] = trimmed;
    }

    setTitles(usable);
    return () => clearTitles(Object.keys(usable));
  }, [serialised, setTitles, clearTitles]);
};

/**
 * Name the crumb for the page currently rendering.
 *
 * A thin wrapper over `useCrumbTitles` for the common case.
 */
export const useBreadcrumbTitle = (title?: string | null): void => {
  const { pathname } = useLocation();
  useCrumbTitles({ [pathname]: title });
};
