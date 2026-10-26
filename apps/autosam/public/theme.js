// autosam theme switch.
//
// Where: index.html loads this file in <head>, before the stylesheets. It is
// a classic script because the page CSP blocks inline scripts.
// When: it sets data-theme and data-mode at once, so the first paint uses
// the right theme. When the page is ready, it fills the two pickers.
// Why: themes.css holds the tokens of each theme in a light and a dark mode.
// This file only selects the block. The CSS morphs the page from one theme
// to the next.
//
// The URL wins: ?theme=kbbq&mode=dark opens the page in that theme and mode,
// and the device keeps the choice for the next pages. A picker change writes
// the choice back to the URL, so the address always gives the current look.
// The defaults stay out of the URL.

(() => {
  const THEMES = [
    { id: 'baseline', label: 'Baseline' },
    { id: 'kbbq', label: 'KBBQ' },
  ];
  // "auto" follows the system light or dark setting.
  const MODES = [
    { id: 'auto', label: 'Auto' },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
  ];
  const SETTINGS = {
    theme: { list: THEMES, key: 'autosam:theme', fallback: 'baseline' },
    mode: { list: MODES, key: 'autosam:mode', fallback: 'auto' },
  };
  const root = document.documentElement;
  const systemDark = matchMedia('(prefers-color-scheme: dark)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  const saved = (key) => {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  };
  const save = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage is off (a private window). The choice lasts for this visit.
    }
  };

  // The URL first, then the device, then the fallback. An unknown value is
  // ignored.
  const params = new URLSearchParams(location.search);
  const current = {};
  for (const [name, s] of Object.entries(SETTINGS)) {
    const known = (id) => s.list.some((t) => t.id === id);
    const fromUrl = params.get(name);
    const fromDevice = saved(s.key);
    if (known(fromUrl)) {
      current[name] = fromUrl;
      save(s.key, fromUrl);
    } else {
      current[name] = known(fromDevice) ? fromDevice : s.fallback;
    }
  }

  const apply = () => {
    const auto = systemDark.matches ? 'dark' : 'light';
    root.dataset.theme = current.theme;
    root.dataset.mode = current.mode === 'auto' ? auto : current.mode;
  };

  const writeUrl = () => {
    const url = new URL(location.href);
    for (const [name, s] of Object.entries(SETTINGS)) {
      if (current[name] === s.fallback) url.searchParams.delete(name);
      else url.searchParams.set(name, current[name]);
    }
    history.replaceState(history.state, '', url);
  };

  // The browser bar uses the color of --bg. During a morph --bg is between
  // two colors, so read it again when the morph ends.
  const syncBar = () => {
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.content = bg;
    }
  };

  apply();

  root.addEventListener('transitionend', (e) => {
    if (e.target === root && e.propertyName === '--bg') syncBar();
  });
  systemDark.addEventListener('change', () => {
    apply();
    // With reduced motion there is no morph and no transitionend.
    syncBar();
  });

  document.addEventListener('DOMContentLoaded', () => {
    for (const [name, s] of Object.entries(SETTINGS)) {
      const select = document.getElementById(`${name}Select`);
      for (const t of s.list) select.add(new Option(t.label, t.id));
      select.value = current[name];
      select.addEventListener('change', () => {
        current[name] = select.value;
        save(s.key, select.value);
        writeUrl();
        // The view transition cross-fades what cannot morph (the fonts).
        // Without it, or with reduced motion, the fonts change at once.
        if (document.startViewTransition && !reducedMotion.matches) {
          document.startViewTransition(apply);
        } else {
          apply();
          syncBar();
        }
      });
    }
    syncBar();
  });
})();
