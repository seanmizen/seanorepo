import type { FC } from 'react';
import { useContext, useEffect, useRef, useState } from 'react';
import {
  Navigate,
  Outlet,
  Route,
  BrowserRouter as Router,
  Routes,
  useLocation,
  useMatch,
} from 'react-router-dom';
import { LastUpdated, Portrait, ThemeToggle, ThirtyBg } from '@/components';
import { ThemeContext, ThemeProvider } from '@/providers';
import {
  BabyComeBack,
  Cron,
  HireLab,
  Home,
  Projects,
  Shaders,
  ThirtyPreview,
} from './routes';
import '../index.css';

/* The share of visits that show the face. The others show London. */
const FACE_CHANCE = 0.1;

/* What the home page and /projects share. It stays mounted as you move
   between them, so the background does not restart and the theme toggle
   stays put. The background is the London map, or on one visit in ten the
   face. On /projects, the map fades out, and the core lands in the slot
   beside the theme toggle with the hire text. The face is thrown into the
   slot and shrinks into the core on the way. */
const Layout: FC = () => {
  const { mode, toggleMode } = useContext(ThemeContext);
  const onProjects = useMatch('/projects') !== null;
  const slot = useRef<HTMLSpanElement>(null);
  const [face] = useState(() => Math.random() < FACE_CHANCE);
  return (
    <>
      <Outlet />
      {face ? (
        <Portrait reveal={onProjects} thrown={onProjects} landing={slot} />
      ) : (
        <>
          <ThirtyBg hidden={onProjects} />
          {onProjects && <Portrait reveal thrown landed landing={slot} />}
        </>
      )}
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

/* cous is a site of its own. Old links still land there. */
const CousMoved: FC = () => {
  useEffect(() => {
    location.replace('https://cous.seanmizen.com');
  }, []);
  return null;
};

const App: FC = () => {
  return (
    <ThemeProvider>
      <Router basename="/">
        <Routes>
          {/* The old name for /projects. Old links still land. */}
          <Route path="/apps" element={<Navigate to="/projects" replace />} />
          <Route path="/cous" element={<CousMoved />} />
          <Route path="/shaders" element={<ShadersMoved />} />
          <Route path="/projects/shaders" element={<Shaders />} />
          <Route path="/projects/shaders/thirty" element={<ThirtyPreview />} />
          <Route path="/shaders-hire" element={<HireLab />} />
          <Route path="/babycomeback" element={<BabyComeBack />} />
          {/* The scheduled jobs. apps/cron serves its data at /api/cron. */}
          <Route path="/cron" element={<Cron />} />
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
