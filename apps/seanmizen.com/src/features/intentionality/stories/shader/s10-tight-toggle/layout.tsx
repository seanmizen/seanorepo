import type { FC } from 'react';
import { useContext, useRef } from 'react';
import { Outlet, useMatch } from 'react-router-dom';
import { LastUpdated } from '@/components';
import { ThemeContext } from '@/providers';
import { Portrait } from './components/portrait';
import { ThemeToggle } from './components/theme-toggle';
import { EatPanel, useEat } from './eat-panel';

/* What the home page and /projects share. It stays mounted as you move
   between them, so the face does not restart and the theme toggle stays
   put. On /projects, the face is thrown into the slot beside the theme
   toggle and shrinks into a core on the way, and the hire text fades in. */
const Layout: FC = () => {
  const { mode, toggleMode } = useContext(ThemeContext);
  const onProjects = useMatch('/projects') !== null;
  const slot = useRef<HTMLSpanElement>(null);
  const [eat, setEat] = useEat();
  return (
    <>
      <Outlet />
      <Portrait
        reveal={onProjects}
        thrown={onProjects}
        landing={slot}
        eat={eat}
      />
      <div className="bottom-right-controls">
        {!onProjects && (
          <LastUpdated
            apiRepoUrl="https://api.github.com/repos/seanmizen/seanorepo"
            branch="release"
          />
        )}
        {onProjects && (
          <span ref={slot} className="singularity-slot" aria-hidden="true" />
        )}
        <ThemeToggle mode={mode} toggleMode={toggleMode} />
      </div>
      <EatPanel eat={eat} setEat={setEat} />
    </>
  );
};

export { Layout };
