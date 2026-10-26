// autosam theme switch.
//
// Where: index.html loads this file in <head>, before the stylesheets. It is
// a classic script because the page CSP blocks inline scripts.
// When: it sets data-theme and data-mode at once, so the first paint uses
// the right theme. When the page is ready, it wires the two buttons of the
// floating pane.
// Why: themes.css holds the tokens of each theme in a light and a dark mode.
// This file only selects the block. morph.js morphs each glyph from the old
// theme to the new one, and the CSS morphs the tokens under it.
//
// The URL wins: ?theme=kbbq&mode=dark opens the page in that theme and mode,
// and the device keeps the choice for the next pages. A button press writes
// the choice back to the URL, so the address always gives the current look.
// The defaults stay out of the URL.

(() => {
  const THEMES = [
    { id: 'baseline', label: 'Baseline' },
    { id: 'kbbq', label: 'KBBQ' },
    // No page styles: browser defaults and modern-normalize only.
    { id: 'bare', label: 'Bare' },
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
      const button = document.getElementById(`${name}Btn`);
      const value = button.querySelector('b');
      const show = () => {
        const i = s.list.findIndex((t) => t.id === current[name]);
        const next = s.list[(i + 1) % s.list.length];
        value.textContent = s.list[i].label;
        button.title = `Change the ${name} to ${next.label}`;
      };
      show();
      button.addEventListener('click', () => {
        const i = s.list.findIndex((t) => t.id === current[name]);
        current[name] = s.list[(i + 1) % s.list.length].id;
        save(s.key, current[name]);
        writeUrl();
        show();
        // morph.js is a module, so it can load after a fast first press. A
        // morph ends with no transitionend, so sync the bar when it ends.
        Promise.resolve(
          window.autosamMorph ? window.autosamMorph(apply) : apply(),
        ).then(syncBar);
      });
    }
    syncBar();
  });
})();
