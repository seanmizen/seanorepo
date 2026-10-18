import type { FC } from 'react';
import { Outlet, useMatch } from 'react-router-dom';
import { Portrait } from './components/portrait';

/* The pages that share the portrait. It stays mounted as you move between
   them, so the face does not restart. On /projects, the hire text fades
   in. */
const WithPortrait: FC = () => {
  const onProjects = useMatch('/projects') !== null;
  return (
    <>
      <Outlet />
      <Portrait reveal={onProjects} />
    </>
  );
};

export { WithPortrait };
