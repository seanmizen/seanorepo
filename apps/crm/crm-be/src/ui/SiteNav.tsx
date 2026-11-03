import { Fragment } from 'react';

/**
 * The app links of the nav, in order. "sign out" comes after them. `also`
 * is a different path of the same page: `/` shows the same list as
 * `/orgs`.
 */
const LINKS = [
  { href: '/orgs', text: 'orgs', also: '/' },
  { href: '/orgs/new', text: 'new lead' },
  { href: '/account', text: 'account' },
];

/** A path segment as text. A segment that does not decode stays as it is. */
const segmentText = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/**
 * The nav at the top of every page: plain text, not a part of the device.
 *
 * 1. The title is the path of the page, as on seanmizen.com: `crm`, then
 *    each segment of the URL. Each segment above the page is a link. The
 *    page itself is dimmed and has `aria-current="page"`. The title is the
 *    first element in `<body>`.
 * 2. For a signed-in person, one line of links: orgs, new lead, account,
 *    sign out. The link to this page is text, not a link. "sign out" is a
 *    form, because it sends a POST.
 *
 * With no page styles, the title is a heading and the links are a list.
 */
export const SiteNav = ({
  path,
  signedIn,
}: {
  path: string;
  signedIn: boolean;
}) => {
  const segments = path.split('/').filter(Boolean);
  const page = segments.pop();
  return (
    <>
      <h1 id="top" className="title">
        {page === undefined ? (
          <span aria-current="page">crm</span>
        ) : (
          <>
            <a href="/">crm</a>
            <span className="path">
              {segments.map((segment, i) => (
                <Fragment key={segments.slice(0, i + 1).join('/')}>
                  {' / '}
                  <a href={`/${segments.slice(0, i + 1).join('/')}`}>
                    {segmentText(segment)}
                  </a>
                </Fragment>
              ))}
              {' / '}
              <span className="here" aria-current="page">
                {segmentText(page)}
              </span>
            </span>
          </>
        )}
      </h1>
      {signedIn && (
        <nav className="links" aria-label="crm">
          <ul>
            {LINKS.map(({ href, text, also }) => (
              <li key={href}>
                {href === path || also === path ? (
                  <span aria-current="page">{text}</span>
                ) : (
                  <a href={href}>{text}</a>
                )}
              </li>
            ))}
            <li>
              <form method="post" action="/logout">
                <button type="submit" className="link">
                  sign out
                </button>
              </form>
            </li>
          </ul>
        </nav>
      )}
    </>
  );
};
