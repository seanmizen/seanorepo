import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Put the address bar on an entity's current slug, and tell search engines
 * which URL is the real one.
 *
 * REQ-SLUG-003. Slugs are permanent but not immutable: a studio may rename
 * itself, and every slug it has ever held keeps resolving. The API answers on
 * an old slug and returns the entity's CURRENT one, and this closes the loop by
 * moving the visitor onto it.
 *
 * ## Why `replace` rather than a redirect
 *
 * A true HTTP 301 is not available to us. `inside-fe` is a static SPA: every
 * path returns `index.html`, and the server has no database, so it cannot know
 * that `/designers/old` should become `/designers/new`. That would need SSR or
 * an edge worker with DB access, and neither exists.
 *
 * So the rewrite happens client-side, and `replace: true` is the load-bearing
 * part. It swaps the current history entry instead of pushing a new one, which
 * is what keeps Back working: with a push, Back would return to the old slug,
 * which would immediately rewrite forward again — a trap the visitor cannot
 * escape without holding the button down. With replace, the old slug never
 * occupies an entry, so Back goes wherever they actually came from.
 *
 * ## Why the canonical tag as well
 *
 * The 301 was also doing SEO work — consolidating link equity on one URL
 * instead of splitting it across every historical slug. A client-side rewrite
 * cannot do that, so `<link rel="canonical">` does it instead, which is the
 * correct signal for a client-rendered page.
 */
export function useCanonicalPath(canonicalPath: string | undefined): void {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();

  useEffect(() => {
    if (!canonicalPath) return;

    if (canonicalPath !== pathname) {
      // The query string is carried across: a filtered or campaign-tagged link
      // that happens to use an old slug should not lose its parameters.
      navigate(`${canonicalPath}${search}`, { replace: true });
    }

    let link = document.head.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );
    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      document.head.appendChild(link);
    }
    link.href = new URL(canonicalPath, window.location.origin).toString();
  }, [canonicalPath, pathname, search, navigate]);

  // Left in place deliberately on unmount: the next slugged page overwrites it,
  // and removing it would blank the tag for a moment on every navigation.
}
