import { useEffect, useState } from 'react';

/* Whether a media query matches, kept current as the viewport changes. */
export const useMatchMedia = (query: string) => {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const list = matchMedia(query);
    const onChange = () => setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
};
