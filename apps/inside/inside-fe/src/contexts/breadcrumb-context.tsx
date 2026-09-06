import {
  createContext,
  type FC,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

interface BreadcrumbTitleValue {
  /** The current page's own name for itself, or null to use the route label. */
  title: string | null;
  setTitle: (title: string | null) => void;
}

const BreadcrumbTitleContext = createContext<BreadcrumbTitleValue>({
  title: null,
  setTitle: () => {},
});

/**
 * Lets the page currently rendering name its own crumb.
 *
 * The route table can only know static labels. A designer profile knows the
 * studio name, a portfolio piece knows its title, and `/verify` knows whether the link
 * worked — all things the URL alone cannot say. This carries that name up to
 * the breadcrumb without the breadcrumb having to know about any page.
 */
export const BreadcrumbTitleProvider: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [title, setTitle] = useState<string | null>(null);
  const value = useMemo(() => ({ title, setTitle }), [title]);

  return (
    <BreadcrumbTitleContext.Provider value={value}>
      {children}
    </BreadcrumbTitleContext.Provider>
  );
};

/** Read by the breadcrumb only; pages should use `useBreadcrumbTitle`. */
export const useBreadcrumbTitleValue = (): string | null =>
  useContext(BreadcrumbTitleContext).title;

/**
 * Name the current page's crumb.
 *
 * Pass `undefined` or `null` while the real name is still loading — the crumb
 * falls back to the route label, and then to the URL segment, rather than
 * rendering blank. Cleared on unmount so a stale name never leaks onto the
 * next page.
 */
export const useBreadcrumbTitle = (title?: string | null): void => {
  const { setTitle } = useContext(BreadcrumbTitleContext);

  useEffect(() => {
    const trimmed = typeof title === 'string' ? title.trim() : '';
    setTitle(trimmed.length > 0 ? trimmed : null);
    return () => setTitle(null);
  }, [title, setTitle]);
};
