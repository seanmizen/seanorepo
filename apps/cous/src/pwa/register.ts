/** How long after `load` the page lists its files. The sprites load late. */
const LIST_DELAY_MS = 3000;

/**
 * Registers the service worker (public/sw.js) in a production build.
 * The dev server does not register it, so that it never serves stale
 * files during development. After the page loads, it sends the service
 * worker the list of files that it loaded, for offline play.
 */
const registerServiceWorker = () => {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('/sw.js');
      const registration = await navigator.serviceWorker.ready;
      await new Promise((resolve) => setTimeout(resolve, LIST_DELAY_MS));
      const urls = performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((u) => {
          const url = new URL(u);
          return (
            url.origin === location.origin && !url.pathname.startsWith('/api/')
          );
        });
      registration.active?.postMessage({ type: 'cache-files', urls });
    } catch {
      // Offline play is optional. The game works without it.
    }
  });
};

export { registerServiceWorker };
