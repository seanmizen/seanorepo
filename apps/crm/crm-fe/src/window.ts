// Where: every page (the `main` entry of crm-fe/rsbuild.config.ts). It acts
// on a control unit with tabs (`ControlUnit` in crm-be/src/ui/ControlUnit.tsx).
// When: on a narrow screen, where the modules are the phone window: one
// module wide, with tabs over it (theme.css, "The phone window").
// Why: the page itself never scrolls sideways, and the window moves with
// the task (apps/crm/docs/002-rack.md, Phone window). The CSS does the
// window: a swipe scrolls it, and each tab is an anchor link to its
// module, so the window works with no JavaScript. This script adds three
// things:
// 1. The LED of the tab of the module in view comes on (`aria-current`).
// 2. A tap on a tab moves the window to its module, and the page does not
//    scroll up or down.
// 3. After a press, the window moves to the module of the `#hash` of the
//    URL, for example #next after Call back, with no page jump
//    (REQ-CRM-MORPH-001). morph.ts keeps the scroll position of the page.
// On a wide screen the modules do not scroll, so the script does nothing.

/** The window of a control unit: its modules, which scroll sideways. */
const WINDOW = '.deck > .modules';

/** The windows that have a scroll listener. A morph keeps the node. */
const watched = new WeakSet<Element>();

/** True when `win` scrolls sideways: a narrow screen. */
const scrolls = (win: Element) => win.scrollWidth > win.clientWidth;

/** The modules of a window, in order. A form in it adds no box. */
const modulesOf = (win: Element) =>
  [...win.querySelectorAll<HTMLElement>('.module')].filter(
    (module) => module.closest(WINDOW) === win,
  );

/** Light the tab of the module that is nearest the left edge of `win`. */
const light = (win: HTMLElement) => {
  const tabs = win.parentElement?.querySelectorAll('.tabs a') ?? [];
  let here: string | undefined;
  if (scrolls(win)) {
    let best = Number.POSITIVE_INFINITY;
    for (const module of modulesOf(win)) {
      const distance = Math.abs(module.offsetLeft - win.scrollLeft);
      if (distance < best) {
        best = distance;
        here = `#${module.id}`;
      }
    }
  }
  for (const tab of tabs) {
    if (tab.getAttribute('href') === here) {
      tab.setAttribute('aria-current', 'true');
    } else tab.removeAttribute('aria-current');
  }
};

/** Move the window that holds the module `id` to it. False: no window. */
const show = (id: string, smooth: boolean) => {
  const module = document.getElementById(id);
  const win = module?.closest<HTMLElement>(WINDOW);
  if (!module || !win || !scrolls(win)) return false;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  win.scrollTo({
    left: module.offsetLeft,
    behavior: smooth && !still ? 'smooth' : 'auto',
  });
  return true;
};

/** Set up each window of the page, and show the module of the `#hash`. */
const setUp = (smooth: boolean) => {
  for (const win of document.querySelectorAll<HTMLElement>(WINDOW)) {
    if (!watched.has(win)) {
      watched.add(win);
      let frame = 0;
      win.addEventListener(
        'scroll',
        () => {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => light(win));
        },
        { passive: true },
      );
    }
    light(win);
  }
  if (location.hash) show(decodeURIComponent(location.hash.slice(1)), smooth);
};

setUp(false);
document.addEventListener('crm:morph', () => setUp(true));
addEventListener('resize', () => setUp(false), { passive: true });

// A listener on `document` runs before the link listener of morph.ts on
// `window`.
document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0) return;
  const tab = (event.target as Element | null)?.closest?.('.tabs a[href]');
  const id = tab?.getAttribute('href')?.slice(1);
  if (!id || !show(id, true)) return;
  event.preventDefault();
  history.replaceState(history.state, '', `#${id}`);
});
