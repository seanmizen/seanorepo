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
    // The dense theme (REQ-DENSE). It fits the page to the viewport.
    { id: 'tone', label: 'Tone', fit: true },
    // The fewest pixels (REQ-PIXEL).
    { id: 'pixel-1', label: 'Pixel-1' },
    { id: 'pixel-2', label: 'Pixel-2' },
    // Pixel-2 with a designed control panel.
    { id: 'pixel-3', label: 'Pixel-3' },
  ];
  // "auto" follows the system light or dark setting.
  const MODES = [
    { id: 'auto', label: 'Auto' },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
  ];
  const SETTINGS = {
    theme: { list: THEMES, key: 'autosam:theme', fallback: 'pixel-3' },
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

  // A dense theme fits the page to the viewport (REQ-DENSE-002). It sets
  // two values: --fit, the base text size, and --cols, the number of bars in
  // a row of the chart. For each row length from COLS, up to the longest
  // section, it finds the largest size in FIT at which the page does not
  // scroll and no bar wraps its chords. It keeps the row length with the
  // largest size, and the shortest row of those. When nothing fits, it uses the largest size, rows of 4,
  // and the page scrolls. Each try is a layout, so the search stops at a
  // quarter pixel.
  const FIT = { min: 10, max: 16 };
  const COLS = [4, 8, 12, 16];
  const fit = () => {
    root.style.removeProperty('--fit');
    root.style.removeProperty('--cols');
    if (!THEMES.find((t) => t.id === current.theme).fit) return;
    const sections = document.getElementById('sections');
    const longest = Number(sections.dataset.longest) || 4;
    const chords = sections.getElementsByClassName('cs');
    const set = (px, cols) => {
      root.style.setProperty('--fit', `${px}px`);
      root.style.setProperty('--cols', String(cols));
    };
    const fits = (px, cols) => {
      set(px, cols);
      if (root.scrollHeight > root.clientHeight) return false;
      if (root.scrollWidth > root.clientWidth) return false;
      // One line of chords is 1.25 em high. Two lines are a wrap.
      for (const cs of chords) if (cs.offsetHeight > px * 1.8) return false;
      return true;
    };
    let best = { px: FIT.max, cols: 4, found: false };
    for (const cols of COLS.filter((c) => c <= longest)) {
      if (!fits(FIT.min, cols)) continue;
      let lo = FIT.min;
      let hi = FIT.max;
      if (fits(hi, cols)) lo = hi;
      while (hi - lo > 0.25) {
        const mid = (lo + hi) / 2;
        if (fits(mid, cols)) lo = mid;
        else hi = mid;
      }
      if (!best.found || lo > best.px) best = { px: lo, cols, found: true };
      if (lo === FIT.max) break;
    }
    set(best.px, best.cols);
  };

  // The fit runs inside apply, so a morph reads the page at its new size.
  const apply = () => {
    const auto = systemDark.matches ? 'dark' : 'light';
    root.dataset.theme = current.theme;
    root.dataset.mode = current.mode === 'auto' ? auto : current.mode;
    if (document.body) fit();
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

  // app.js calls this after it changes what the page shows.
  window.autosamFit = fit;
  // One fit for each frame of a resize.
  let resizing = false;
  addEventListener('resize', () => {
    if (resizing) return;
    resizing = true;
    requestAnimationFrame(() => {
      resizing = false;
      fit();
    });
  });
  document.fonts.ready.then(fit);

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
      const prev = document.getElementById(`${name}Prev`);
      const next = document.getElementById(`${name}Next`);
      const value = button.querySelector('b');
      // The value `by` places from the current one, round the list.
      const at = (by) => {
        const i = s.list.findIndex((t) => t.id === current[name]);
        return s.list[(i + by + s.list.length) % s.list.length];
      };
      const show = () => {
        value.textContent = at(0).label;
        button.title = `Change the ${name} to ${at(1).label} (← →)`;
        prev.title = `Change the ${name} to ${at(-1).label}`;
        next.title = `Change the ${name} to ${at(1).label}`;
      };
      const step = (by) => {
        current[name] = at(by).id;
        save(s.key, current[name]);
        writeUrl();
        show();
        // morph.js is a module, so it can load after a fast first press. A
        // morph ends with no transitionend, so sync the bar when it ends.
        Promise.resolve(
          window.autosamMorph ? window.autosamMorph(apply) : apply(),
        ).then(syncBar);
      };
      show();
      button.addEventListener('click', () => step(1));
      prev.addEventListener('click', () => step(-1));
      next.addEventListener('click', () => step(1));
      // The arrow keys step the value while the main button has focus. The
      // event stops here: on the song page the arrows also change section.
      button.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        e.preventDefault();
        e.stopPropagation();
        step(e.key === 'ArrowLeft' ? -1 : 1);
      });
    }
    fit();
    syncBar();
  });
})();
