import type { FC } from 'react';
import { useContext, useRef } from 'react';
import {
  Navigate,
  Outlet,
  Route,
  BrowserRouter as Router,
  Routes,
  useLocation,
  useMatch,
} from 'react-router-dom';
import { LastUpdated, Portrait, ThemeToggle } from '@/components';
import { StoryPage, stories } from '@/features';
import { MapNetwork } from '@/features/Glasto/Map';
import { ThemeContext, ThemeProvider } from '@/providers';
import { Cous, HireLab, Home, Projects, Shaders } from './routes';
import '../index.css';

/* What the home page and /projects share. It stays mounted as you move
   between them, so the face does not restart and the theme toggle stays
   put. On /projects, the face is thrown into the slot beside the theme
   toggle and shrinks into a core on the way, and the hire text fades in. */
const Layout: FC = () => {
  const { mode, toggleMode } = useContext(ThemeContext);
  const onProjects = useMatch('/projects') !== null;
  const slot = useRef<HTMLSpanElement>(null);
  return (
    <>
      <Outlet />
      <Portrait reveal={onProjects} thrown={onProjects} landing={slot} />
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
    </>
  );
};

/* The old path of the shader playground. Old links still land, with their
   settings in the hash. */
const ShadersMoved: FC = () => (
  <Navigate to={`/projects/shaders${useLocation().hash}`} replace />
);

const App: FC = () => {
  return (
    <ThemeProvider>
      <Router basename="/">
        <Routes>
          {/* The old name for /projects. Old links still land. */}
          <Route path="/apps" element={<Navigate to="/projects" replace />} />
          <Route path="/cous" element={<Cous />} />
          <Route path="/glasto" element={<MapNetwork />} />
          <Route path="/shaders" element={<ShadersMoved />} />
          <Route path="/projects/shaders" element={<Shaders />} />
          <Route path="/shaders-hire" element={<HireLab />} />
          {/* The intentionality stories: one page each. */}
          {stories.map((story) => (
            <Route
              key={story.slug}
              path={`/${story.slug}`}
              element={<StoryPage story={story} />}
            />
          ))}
          <Route element={<Layout />}>
            <Route path="/projects" element={<Projects />} />
            <Route path="/*" element={<Home />} />
          </Route>
        </Routes>
      </Router>
    </ThemeProvider>
  );
};

export { App };
