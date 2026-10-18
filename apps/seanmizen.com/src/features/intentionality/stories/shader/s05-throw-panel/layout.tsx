import type { FC } from 'react';
import { useContext, useRef } from 'react';
import { Outlet, useMatch } from 'react-router-dom';
import { LastUpdated, ThemeToggle } from '@/components';
import { ThemeContext } from '@/providers';
import { Portrait } from './components/portrait';
import type { ShaderRippleHandle } from './components/shader-ripple';
import { FlightPanel, useFlight } from './flight-panel';

/* What the home page and /projects share. It stays mounted as you move
   between them, so the face does not restart and the theme toggle stays
   put. On /projects, the face falls into a core that is thrown to the
   bottom of the view, and the hire text fades in. */
const Layout: FC = () => {
  const { mode, toggleMode } = useContext(ThemeContext);
  const onProjects = useMatch('/projects') !== null;
  const portrait = useRef<ShaderRippleHandle>(null);
  const [flight, setFlight] = useFlight();
  return (
    <>
      <Outlet />
      <Portrait
        ref={portrait}
        reveal={onProjects}
        collapse={onProjects}
        flight={flight}
      />
      <div className="bottom-right-controls">
        {!onProjects && (
          <LastUpdated
            apiRepoUrl="https://api.github.com/repos/seanmizen/seanorepo"
            branch="release"
          />
        )}
        <ThemeToggle mode={mode} toggleMode={toggleMode} />
      </div>
      <FlightPanel
        flight={flight}
        setFlight={setFlight}
        onReplay={() => portrait.current?.rethrow()}
      />
    </>
  );
};

export { Layout };
