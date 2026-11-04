// Where: every page (the `main` entry of crm-fe/rsbuild.config.ts).
// When: a person submits a form, clicks an in-app link, or goes Back or
// Forward.
// Why: a press changes only its effect (REQ-CRM-MORPH-001). The page does
// not load again, so the focus and the scroll position stay. With no
// JavaScript, the same form or link loads the full page (REQ-CRM-BARE-001).
//
// The steps:
// 1. Send the request that the browser would send, with `fetch`.
// 2. Morph the body of the response into the page (idiomorph). A node that
//    the response also has stays the same node, so it keeps its focus and
//    its listeners.
// 3. Put the new URL in history: push a changed URL, and replace the same
//    URL (a post that redirects back to the same page).
// 4. Move the focus back to the same control (by id, then by name) when the
//    morph removed the control that had it. On the same page, keep the
//    scroll position. On a different page, go to the top, or to the target
//    of the `#hash`, as a full load does.
// 5. On a network error, or a response that is not a crm page, send the
//    request again as a normal browser submit or load, so no press is lost.
//
// A full load happens for a link or a form to a different origin, with a
// `target`, with `download`, or with `data-reload`. Another script can
// handle a submit or a click itself with `preventDefault` (passkeys.ts).
// After each morph, the document gets a `crm:morph` event, so a script can
// set up its controls again.
import { Idiomorph } from 'idiomorph';

/** The request in progress. A new press stops it. */
let current: AbortController | undefined;

/** The URL of the page on screen, with no `#hash`. */
let shown = location.href.split('#')[0];

/** The form that a failed fetch submits again with no morph. */
let passThrough: HTMLFormElement | undefined;

/**
 * A key for one control, the same before and after a morph. It ignores the
 * text after the first child, so a key with the state text ", A to Z" has
 * the same key as before.
 */
const keyOf = (element: Element) =>
  [
    element.tagName,
    element.getAttribute('name'),
    element.getAttribute('value'),
    element.getAttribute('rel') ?? element.getAttribute('href'),
    element.closest('form')?.getAttribute('action'),
    element.firstChild?.textContent,
  ].join('|');

const CONTROLS = 'a, button, input, select, textarea, summary';

/** A text field that the person changed. A morph does not reset it. */
const changed = (node: Node) =>
  (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) &&
  node.value !== node.defaultValue;

/** The scroll position, as the state of a history entry holds it. */
type Scroll = { scroll?: [number, number] } | null;

/** The scroll position goes in the history entry, for Back and Forward. */
const saveScroll = () =>
  history.replaceState({ scroll: [scrollX, scrollY] } satisfies Scroll, '');

/** The `src` of each script, and the `href` of each stylesheet, of `doc`. */
const assets = (doc: Document) => ({
  scripts: [...doc.querySelectorAll('script[src]')].map(
    (script) => script.getAttribute('src') ?? '',
  ),
  styles: [...doc.querySelectorAll('link[rel="stylesheet"]')].map(
    (link) => link.getAttribute('href') ?? '',
  ),
});

/**
 * True when the new page can go into this page: it has the same
 * stylesheets, and the `main` script (its first script) is already on this
 * page. A different `main` or stylesheet is a new build of crm-fe.
 */
const fits = (next: Document) => {
  const now = assets(document);
  const then = assets(next);
  return (
    then.styles.join() === now.styles.join() &&
    then.scripts.length > 0 &&
    now.scripts.includes(then.scripts[0])
  );
};

interface Press {
  url: URL;
  init: RequestInit;
  /** The form that sent the press. Its own fields reset in the morph. */
  form?: HTMLFormElement;
  /**
   * Back or Forward: the history entry is already there, and this is its
   * state.
   */
  pop?: Scroll;
  /** Send the press again with no morph. */
  fallback: () => void;
}

const go = async ({ url, init, form, pop, fallback }: Press) => {
  current?.abort();
  const controller = new AbortController();
  current = controller;
  let response: Response;
  let html: string;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.headers.get('content-type')?.includes('text/html')) {
      throw new Error(`Not HTML: ${response.headers.get('content-type')}`);
    }
    html = await response.text();
  } catch {
    if (!controller.signal.aborted) fallback();
    return;
  }
  if (controller.signal.aborted) return;

  const next = new DOMParser().parseFromString(html, 'text/html');
  // The URL of the new page. fetch drops the `#hash`: keep the hash of the
  // request when there was no redirect.
  const target = new URL(response.url);
  if (!response.redirected) target.hash = url.hash;
  const post = init.method === 'POST';
  // A post with no redirect shows its page at the URL of the page on screen,
  // so a reload does not send a GET to a POST-only path.
  if (post && !response.redirected) target.href = location.href;
  if (!fits(next)) {
    if ((post && !response.redirected) || pop !== undefined) fallback();
    else location.assign(target);
    return;
  }

  const samePage = target.pathname === new URL(shown).pathname;
  const active = document.activeElement;
  const key = active && active !== document.body ? keyOf(active) : undefined;
  const activeId = active?.id;
  const [x, y] = [scrollX, scrollY];

  if (pop === undefined) {
    if (target.href === location.href) {
      history.replaceState(history.state, '', target);
    } else {
      saveScroll();
      history.pushState(null, '', target);
    }
  }
  shown = target.href.split('#')[0];
  document.title = next.title;
  Idiomorph.morph(document.body, next.body, {
    morphStyle: 'outerHTML',
    // While a person types in a search field, the GET does not reset it.
    ignoreActiveValue: !post,
    callbacks: {
      // On the same page, a text field that the person changed, outside the
      // form that sent the press, keeps its text.
      beforeNodeMorphed: (old) =>
        !(samePage && changed(old) && !form?.contains(old)),
      // On the same page, a `<details>` that the person opened stays open.
      beforeAttributeUpdated: (name, element, action) =>
        !(
          samePage &&
          name === 'open' &&
          action === 'remove' &&
          element instanceof HTMLDetailsElement
        ),
    },
  });

  // A script that only the new page has (for example passkeys.ts).
  for (const src of assets(next).scripts) {
    if (assets(document).scripts.includes(src)) continue;
    const script = document.createElement('script');
    script.src = src;
    document.head.append(script);
  }
  document.dispatchEvent(new Event('crm:morph'));

  if (key && document.activeElement !== active) {
    const match =
      (activeId && document.getElementById(activeId)) ||
      [...document.querySelectorAll(CONTROLS)].find(
        (element) => keyOf(element) === key,
      );
    if (match instanceof HTMLElement) match.focus({ preventScroll: true });
  }
  if (pop !== undefined) {
    scrollTo(pop?.scroll?.[0] ?? 0, pop?.scroll?.[1] ?? 0);
  } else if (samePage) {
    scrollTo(x, y);
  } else {
    const hashTarget = target.hash
      ? document.getElementById(decodeURIComponent(target.hash.slice(1)))
      : null;
    if (hashTarget) hashTarget.scrollIntoView();
    else scrollTo(0, 0);
  }
};

// The script restores the scroll position of each history entry, also
// after a reload.
history.scrollRestoration = 'manual';
const saved = (history.state as Scroll)?.scroll;
if (saved) scrollTo(saved[0], saved[1]);
let scrollTimer: ReturnType<typeof setTimeout> | undefined;
addEventListener(
  'scroll',
  () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(saveScroll, 200);
  },
  { passive: true },
);
addEventListener('pagehide', saveScroll);

// The listener is on `window`, so a listener on `document` (passkeys.ts)
// runs first and can handle the submit itself.
addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || event.defaultPrevented) return;
  if (form === passThrough) return;
  const submitter = event.submitter;
  const button =
    submitter instanceof HTMLButtonElement ||
    submitter instanceof HTMLInputElement
      ? submitter
      : undefined;
  const action = new URL(
    button?.hasAttribute('formaction') ? button.formAction : form.action,
  );
  const method = (
    button?.hasAttribute('formmethod') ? button.formMethod : form.method
  ).toLowerCase();
  if (method !== 'get' && method !== 'post') return;
  if (action.origin !== location.origin) return;
  if (form.hasAttribute('data-reload')) return;
  if ((button?.formTarget || form.target || '_self') !== '_self') return;
  event.preventDefault();

  const data = new FormData(form, submitter);
  const fields = new URLSearchParams();
  for (const [name, value] of data) {
    if (typeof value === 'string') fields.append(name, value);
  }
  const fallback = () => {
    passThrough = form;
    try {
      form.requestSubmit(button);
    } finally {
      passThrough = undefined;
    }
  };
  if (method === 'get') {
    action.search = fields.toString();
    void go({
      url: action,
      init: {},
      form,
      fallback: () => location.assign(action),
    });
    return;
  }
  void go({
    url: action,
    init: {
      method: 'POST',
      body: form.enctype === 'multipart/form-data' ? data : fields,
    },
    form,
    fallback,
  });
});

addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = (event.target as Element | null)?.closest?.('a[href]');
  if (!(link instanceof HTMLAnchorElement)) return;
  if (link.hasAttribute('download') || link.hasAttribute('data-reload')) {
    return;
  }
  if ((link.target || '_self') !== '_self') return;
  const url = new URL(link.href);
  if (url.origin !== location.origin) return;
  // A link to a `#hash` on this page: the browser scrolls to it.
  if (url.hash && url.href.split('#')[0] === shown) return;
  event.preventDefault();
  void go({ url, init: {}, fallback: () => location.assign(url) });
});

addEventListener('popstate', (event) => {
  // Back or Forward to a `#hash` on the same page: the browser handles it.
  if (location.href.split('#')[0] === shown) return;
  const url = new URL(location.href);
  void go({
    url,
    init: {},
    pop: (event.state as Scroll) ?? null,
    fallback: () => location.reload(),
  });
});
