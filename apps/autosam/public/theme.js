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
    // The dense theme (REQ-DENSE). It fits the chart to the viewport.
    { id: 'tone', label: 'Tone', fit: true },
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

  // A dense theme fits the chart to the viewport (REQ-DENSE-002). It sets
  // two values: --fit, the text size of the chart, and --cols, the number
  // of bars in a row. The controls keep their size. For each row length
  // from COLS, up to the longest section, it finds the largest size in FIT
  // at which the page does not scroll and no bar wraps its chords. It keeps
  // the row length with the largest size, and the shortest row of those.
  // When nothing fits (a phone), it uses FIT.fallback and rows of 4, and the
  // page scrolls. Each try is a layout, so the sizes are whole pixels.
  const FIT = { min: 12, max: 40, step: 1, fallback: 16 };
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
    // The chart grows in proportion to its text size, so one layout at
    // FIT.fallback gives a first guess. Steps up from the guess, or a binary
    // search below it, find the size. A longer row only wins with a larger size, so the
    // search for it starts one step above the best size so far.
    let best = { px: FIT.fallback, cols: 4, found: false };
    for (const cols of COLS.filter((c) => c <= longest)) {
      const floor = best.found ? best.px + FIT.step : FIT.min;
      if (floor > FIT.max) break;
      set(FIT.fallback, cols);
      const chart = sections.offsetHeight;
      const room = root.clientHeight - (document.body.offsetHeight - chart);
      let px = Math.floor((FIT.fallback * room) / chart);
      px = Math.max(floor, Math.min(FIT.max, px));
      if (fits(px, cols)) {
        while (px < FIT.max && fits(px + FIT.step, cols)) px += FIT.step;
      } else {
        // Too large, often because a bar wraps. Halve the range to the floor.
        if (!fits(floor, cols)) continue;
        let lo = floor;
        let hi = px;
        while (hi - lo > FIT.step) {
          const mid = Math.round((lo + hi) / 2);
          if (fits(mid, cols)) lo = mid;
          else hi = mid;
        }
        px = lo;
      }
      best = { px, cols, found: true };
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
