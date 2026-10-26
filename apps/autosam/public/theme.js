// autosam theme switch.
//
// Where: index.html loads this file in <head>, before the stylesheets. It is
// a classic script because the page CSP blocks inline scripts.
// When: it sets data-theme at once, so the first paint uses the saved theme.
// When the page is ready, it fills the theme picker.
// Why: themes.css holds one block of tokens for each theme. This file only
// selects the block. The CSS morphs the page from one theme to the next.

(() => {
  const KEY = 'autosam:theme';
  // id: the data-theme value. "auto" sets no data-theme, so the system
  // light or dark setting selects the baseline.
  const THEMES = [
    { id: 'auto', label: 'Auto' },
    { id: 'baseline-light', label: 'Baseline light' },
    { id: 'baseline-dark', label: 'Baseline dark' },
  ];
  const root = document.documentElement;

  const saved = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY));
    } catch {
      return null;
    }
  };
  const save = (id) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(id));
    } catch {
      // Storage is off (a private window). The theme lasts for this visit.
    }
  };
  const apply = (id) => {
    if (id !== 'auto' && THEMES.some((t) => t.id === id)) {
      root.dataset.theme = id;
    } else {
      delete root.dataset.theme;
    }
  };

  // The browser bar uses the color of --bg. During a morph --bg is between
  // two colors, so read it again when the morph ends.
  const syncBar = () => {
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.content = bg;
    }
  };

  apply(saved());

  root.addEventListener('transitionend', (e) => {
    if (e.target === root && e.propertyName === '--bg') syncBar();
  });
  // With reduced motion there is no morph and no transitionend.
  matchMedia('(prefers-color-scheme: dark)').addEventListener(
    'change',
    syncBar,
  );

  document.addEventListener('DOMContentLoaded', () => {
    const select = document.getElementById('themeSelect');
    for (const t of THEMES) select.add(new Option(t.label, t.id));
    select.value = root.dataset.theme || 'auto';
    select.addEventListener('change', () => {
      apply(select.value);
      save(select.value);
      syncBar();
    });
    syncBar();
  });
})();
