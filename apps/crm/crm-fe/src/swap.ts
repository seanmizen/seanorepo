// Where: every page (the `main` entry of crm-fe/rsbuild.config.ts).
// When: a person submits a GET form, or clicks a link, that has
// `data-swap="<selector list>"`.
// Why: the page updates in place, and the focus and the caret stay where
// they were. With no JavaScript, the same form or link loads the full page
// (REQ-CRM-BARE-001).
//
// The steps:
// 1. Fetch the URL that the browser would load: the form action with the
//    form fields as the query, or the href of the link.
// 2. Replace each element on the page that matches the selector list with
//    the element in the same place in the response.
// 3. Put the URL in the address bar (`history.replaceState`).
// 4. When the focus was in a replaced element, move it to the same control
//    in the new element. Focus outside the replaced elements does not move.
// 5. On a network error, a status that is not 200, a redirect, or a
//    response with a different count of matches, load the full page.

/** The fetch in progress. A new swap stops it. */
let current: AbortController | undefined;

/**
 * A key for one control, the same before and after a swap. It ignores the
 * text after the first child, so a key with the state text ", A to Z" has
 * the same key as before. A row of the list keeps its href.
 */
const keyOf = (element: Element) =>
  [
    element.tagName,
    element.id,
    element.getAttribute('name'),
    element.getAttribute('rel') ?? element.getAttribute('href'),
    element.firstChild?.textContent,
  ].join('|');

const CONTROLS = 'a, button, input, select, textarea';

const swap = async (url: URL, selectors: string) => {
  current?.abort();
  const controller = new AbortController();
  current = controller;
  let html: string;
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (response.status !== 200 || response.redirected) {
      throw new Error(`HTTP ${response.status}`);
    }
    html = await response.text();
  } catch {
    if (controller.signal.aborted) return;
    location.assign(url);
    return;
  }
  if (controller.signal.aborted) return;

  const next = new DOMParser().parseFromString(html, 'text/html');
  const olds = [...document.querySelectorAll(selectors)];
  const news = [...next.querySelectorAll(selectors)];
  if (olds.length === 0 || olds.length !== news.length) {
    location.assign(url);
    return;
  }

  const active = document.activeElement;
  const input = active instanceof HTMLInputElement ? active : undefined;
  const caret = [input?.selectionStart, input?.selectionEnd] as const;
  olds.forEach((old, i) => {
    const replacement = news[i];
    if (active && old.contains(active)) {
      const key = keyOf(active);
      const match = [
        replacement,
        ...replacement.querySelectorAll(CONTROLS),
      ].find((element) => keyOf(element) === key);
      old.replaceWith(replacement);
      if (match instanceof HTMLElement) match.focus();
      if (match instanceof HTMLInputElement && caret[0] != null) {
        match.setSelectionRange(caret[0], caret[1] ?? caret[0]);
      }
    } else {
      old.replaceWith(replacement);
    }
  });
  history.replaceState(null, '', url);
};

document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const selectors = form.dataset.swap;
  if (!selectors || form.method !== 'get') return;
  event.preventDefault();
  const url = new URL(form.action);
  url.search = '';
  for (const [name, value] of new FormData(form, event.submitter)) {
    if (typeof value === 'string') url.searchParams.append(name, value);
  }
  void swap(url, selectors);
});

document.addEventListener('click', (event) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey) return;
  if (event.shiftKey || event.altKey) return;
  const link = (event.target as Element | null)?.closest?.('a[data-swap]');
  if (!(link instanceof HTMLAnchorElement)) return;
  const selectors = link.dataset.swap;
  if (!selectors) return;
  event.preventDefault();
  void swap(new URL(link.href), selectors);
});
