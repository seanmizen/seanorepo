import type { ReactNode } from 'react';

/** The text of each theme and mode, as the steppers show it. */
const TEXT: Record<string, string> = {
  'pixel-3': 'Pixel-3',
  bare: 'Bare',
  auto: 'Auto',
  light: 'Light',
  dark: 'Dark',
};

/**
 * The footer of every page: plain text, not a part of the device.
 *
 * - The page links: the `pager` of a long list, if there is one, and `top`.
 * - The theme stepper. The theme is in the URL (`?theme=bare`), so its two
 *   steps are links to this URL in the other theme.
 * - The mode stepper (auto, light, dark). Each step is a key in a POST form
 *   to `/mode`, which keeps the mode in a cookie and opens `next` again.
 *
 * The steppers look like the small steppers under the device of autosam.
 * With no page styles, each one is text with a link or a key on each side.
 */
export const Footer = ({
  pager,
  theme,
  otherTheme,
  otherThemeHref,
  mode,
  prevMode,
  nextMode,
  next,
}: {
  pager?: ReactNode;
  theme: string;
  otherTheme: string;
  otherThemeHref: string;
  mode: string;
  prevMode: string;
  nextMode: string;
  next: string;
}) => (
  <footer className="foot">
    <nav className="foot-links" aria-label="Page">
      {pager}
      {pager && ' '}
      <a href="#top">top</a>
    </nav>
    <div className="stepper">
      <a
        className="step"
        href={otherThemeHref}
        aria-label={`Theme: ${TEXT[otherTheme]}`}
      >
        ‹
      </a>{' '}
      <span className="step-value">
        <small>Theme</small> <b>{TEXT[theme]}</b>
      </span>{' '}
      <a
        className="step"
        href={otherThemeHref}
        aria-label={`Theme: ${TEXT[otherTheme]}`}
      >
        ›
      </a>
    </div>
    <form className="stepper" method="post" action="/mode" aria-label="Mode">
      <input type="hidden" name="next" value={next} />
      <button
        type="submit"
        className="step"
        name="mode"
        value={prevMode}
        aria-label={`Mode: ${TEXT[prevMode]}`}
      >
        ‹
      </button>{' '}
      <span className="step-value">
        <small>Mode</small> <b>{TEXT[mode]}</b>
      </span>{' '}
      <button
        type="submit"
        className="step"
        name="mode"
        value={nextMode}
        aria-label={`Mode: ${TEXT[nextMode]}`}
      >
        ›
      </button>
    </form>
  </footer>
);
