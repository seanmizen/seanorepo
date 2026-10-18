"""Stage 01: projects becomes a link, the face moves to a layout, the hire
text fades in. Run from the replayed src folder."""
import os
from lib import apply, write

os.rename('app/routes/apps', 'app/routes/projects')
os.rename('app/routes/projects/apps.tsx', 'app/routes/projects/projects.tsx')
os.rename('app/routes/projects/apps.module.css', 'app/routes/projects/projects.module.css')

# --- the fade, in the shader -------------------------------------------
apply('components/shader-ripple/frag-glyph-light.glsl', [
("""// The hire field: text that a reveal front writes out from the middle,
// clear of the face and of the page content.
uniform float u_hire;          // 1: the hire field; 0: the playground grid
uniform float u_textStrength;  // how strongly the resting text shows
uniform float u_textDrift;     // how much the drifting cloud makes it breathe
uniform float u_revealR;       // the reveal front's distance from the middle
uniform float u_revealEdge;    // how soft that front is
uniform float u_revealMoving;  // 1 while the front is moving
uniform float u_revealGlow;    // how brightly the moving front glows
uniform float u_revealFade;    // an overall fade, for reduced motion
""",
"""// The hire field: text that fades in around the face, clear of the face
// and of the page content.
uniform float u_hire;          // 1: the hire field; 0: the playground grid
uniform float u_textStrength;  // how strongly the resting text shows
uniform float u_textDrift;     // how much the drifting cloud makes it breathe
uniform float u_revealFade;    // how far the text has faded in, 0 to 1
"""),
("""  if (u_hire > 0.5) {
    // The text exists behind the reveal front. The front scrambles the
    // letters as it passes and glows only as far as u_revealGlow.
    float behind = u_revealR - length(p);
    float shown = smoothstep(-u_revealEdge, u_revealEdge, behind);
    float front = u_revealMoving * exp(-behind * behind / (u_revealEdge * u_revealEdge));
    tint = max(tint, u_revealGlow * front);
    roused += 1.5 * front;

    // Resting text breathes with the drifting cloud.
    float breath = mix(1.0, smoothstep(-0.45, 0.5, c), u_textDrift);
    lit = max(u_textStrength * breath, max(max(tint, haze), rouse)) * shown;
""",
"""  if (u_hire > 0.5) {
    // Resting text breathes with the drifting cloud.
    float breath = mix(1.0, smoothstep(-0.45, 0.5, c), u_textDrift);
    lit = max(u_textStrength * breath, max(max(tint, haze), rouse));
"""),
("""    lit *= min(face, content) * u_revealFade;
    tint *= shown;
    haze *= shown;
  } else {""",
"""    lit *= min(face, content) * u_revealFade;
  } else {"""),
])

apply('components/shader-ripple/shader-ripple.tsx', [
("""  /* Turns on the hire field: the message as text around the edges of the
     view, written out by a reveal front while `reveal` is true. */""",
"""  /* Turns on the hire field: the message as text around the edges of the
     view, faded in while `reveal` is true. */"""),
("""/* The reveal front's soft edge, in world units. */
const REVEAL_EDGE = 2.5;

""", ""),
("""      u_revealR: { value: 0 },
      u_revealEdge: { value: REVEAL_EDGE },
      u_revealMoving: { value: 0 },
      u_revealGlow: { value: 0 },
      u_revealFade: { value: 1 },
""", """      u_revealFade: { value: 0 },
"""),
("""    // The reveal: `r` runs from 0 (no text) to 1 (text out to the corners).
    // A change of `reveal` eases it from where it is to the other end.
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const revealState""",
"""    // The reveal: `r` runs from 0 (no text) to 1 (the text at full
    // strength). A change of `reveal` eases it from where it is to the
    // other end.
    const revealState"""),
("""        revealState.duration = reducedMotion.matches
          ? 0.3
          : Math.max(0.05, (h?.revealTime ?? 1) * distance);
        // The content has just changed size (the list opened or closed), so
        // measure now rather than a few frames late.
""",
"""        revealState.duration = Math.max(0.05, (h?.revealTime ?? 1) * distance);
        // The page has just changed (a navigation), so measure now rather
        // than a few frames late.
"""),
("""          const reach = Math.hypot(view.halfX, view.halfY) + 2 * REVEAL_EDGE;
          const reduced = reducedMotion.matches;
          lightUniforms.u_hire.value = 1;""",
"""          lightUniforms.u_hire.value = 1;"""),
("""          lightUniforms.u_revealR.value = reduced
            ? reach
            : revealState.r * reach;
          lightUniforms.u_revealMoving.value =
            reduced || progress >= 1 ? 0 : 1 - progress ** 4;
          lightUniforms.u_revealFade.value = reduced ? revealState.r : 1;
          lightUniforms.u_revealGlow.value = h.revealGlow;
""",
"""          lightUniforms.u_revealFade.value = revealState.r;
"""),
])

apply('components/shader-ripple/hire.ts', [
("""/* The home page's text field: a message that a reveal front writes out
   from the face when "projects" opens, kept clear of the face and of the
   page content.""",
"""/* The projects page's text field: a message that fades in around the
   face on /projects, kept clear of the face and of the page content."""),
("""  revealTime: number;
  revealGlow: number;
};""", """  revealTime: number;
};"""),
("""  revealTime: 5,
  revealGlow: 0.3,
};""", """  revealTime: 5,
};"""),
("""    key: 'revealTime',
    label: 'reveal time',
    min: 0.3,
    max: 5,
    step: 0.05,
    hint: 'Seconds for the reveal front to write the text out to the edges.',
  },
  {
    key: 'revealGlow',
    label: 'edge glow',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'How brightly the reveal front glows as it writes the text. It scrambles the letters either way.',
  },
];""",
"""    key: 'revealTime',
    label: 'fade time',
    min: 0.3,
    max: 5,
    step: 0.05,
    hint: 'Seconds for the text to fade in, and to fade out again.',
  },
];"""),
])

# --- the hook, the portrait, the routes ---------------------------------
write('hooks/use-match-media.ts', """import { useEffect, useState } from 'react';

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
""")
write('hooks/index.ts', """export { useKeySequence } from './use-key-sequence';
export { useMatchMedia } from './use-match-media';
""")
write('components/portrait/portrait.tsx', """import type { FC } from 'react';
import { useMatchMedia } from '@/hooks';
import type { HireSettings } from '../shader-ripple';
import { HIRE_DEFAULTS, HOME_PARAMS, ShaderRipple } from '../shader-ripple';

/* The page content the hire text keeps clear of. */
const CONTENT = 'main.container > :is(h1, h2, p, ul, nav)';

/* Below this width the portrait draws at half size. */
const NARROW = '(max-width: 880px)';

type PortraitProps = {
  /* The hire field's settings. The /shaders-hire playground passes its
     own to tune them on the real page. */
  hire?: HireSettings;
  /* While true, the hire text fades in. When false, it fades out. */
  reveal?: boolean;
};

/* The face behind the page, fixed to the viewport. Mount it in a layout
   route, and it keeps its particles and ripples across a navigation. */
const Portrait: FC<PortraitProps> = ({
  hire = HIRE_DEFAULTS,
  reveal = false,
}) => {
  const narrow = useMatchMedia(NARROW);
  return (
    <div className="shader-container" aria-hidden="true">
      <ShaderRipple
        params={HOME_PARAMS}
        size={0}
        hire={hire}
        reveal={reveal}
        clearSelector={CONTENT}
        portraitScale={narrow ? 0.5 : 1}
      />
    </div>
  );
};

export { Portrait };
""")
write('components/portrait/index.ts', "export { Portrait } from './portrait';\n")
apply('components/index.ts', [
("export { LastUpdated } from './last-updated';\n",
 "export { LastUpdated } from './last-updated';\nexport { Portrait } from './portrait';\n"),
])
write('components/home-li/home-li.tsx', """import type { FC, ReactNode } from 'react';
import { Accordion } from '../accordion';
import { Entity } from '../entity-list';

interface HomeLiProps {
  children: ReactNode;
  trigger: string;
}

const HomeLi: FC<HomeLiProps> = ({ children, trigger }) => (
  <Entity>
    <Accordion trigger={trigger}>{children}</Accordion>
  </Entity>
);

export { HomeLi };
""")
write('app/routes/projects/index.ts', "export { Projects } from './projects';\n")
write('app/routes/index.ts', """export { Cous } from './cous';
export { HireLab } from './hire-lab';
export { Home } from './home';
export { Projects } from './projects';
export { Shaders } from './shaders';
""")
apply('app/routes/projects/projects.tsx', [
("import { Projects } from '@/features';\nimport styles from './apps.module.css';",
 "import { Projects as ProjectList } from '@/features';\nimport styles from './projects.module.css';"),
("const Apps: FC = () => (", "const Projects: FC = () => ("),
("    <Projects />\n", "    <ProjectList />\n"),
("export { Apps };", "export { Projects };"),
])

write('app/routes/home/home.tsx', """import type { FC } from 'react';
import { useContext, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Entity,
  EntityList,
  HomeLi,
  LastUpdated,
  Spacer,
  SSHModal,
  ThemeToggle,
} from '@/components';
import { Donate, Github, ThisPage } from '@/features';
import { useKeySequence } from '@/hooks';
import { ThemeContext } from '@/providers';

const Home: FC = () => {
  const { mode, toggleMode } = useContext(ThemeContext);
  const [isSSHModalOpen, setIsSSHModalOpen] = useState(false);

  useKeySequence({
    ssh: () => setIsSSHModalOpen(true),
    poop: () => alert('oops, poop!'),
  });

  const subsections = [
    { component: <Github />, trigger: 'github' },
    { component: <Donate />, trigger: 'donate' },
    { component: <ThisPage />, trigger: 'this page' },
  ];

  return (
    <main className="container">
      <h1>seanmizen.com</h1>
      <p>developer | automator | person</p>
      <Spacer />
      <EntityList>
        {/* Projects has a page of its own. The other sections open here. */}
        <Entity>
          <Link to="/projects">projects</Link>
        </Entity>
        {subsections.map((subsection) => (
          <HomeLi key={subsection.trigger} trigger={subsection.trigger}>
            {subsection.component}
          </HomeLi>
        ))}
      </EntityList>
      <Spacer />
      <div className="bottom-right-controls">
        <LastUpdated
          apiRepoUrl="https://api.github.com/repos/seanmizen/seanorepo"
          branch="release"
        />
        <ThemeToggle mode={mode} toggleMode={toggleMode} />
      </div>
      <SSHModal
        isOpen={isSSHModalOpen}
        onClose={() => setIsSSHModalOpen(false)}
      />
    </main>
  );
};

export { Home };
""")
write('app/app.tsx', """import type { FC } from 'react';
import {
  Navigate,
  Outlet,
  Route,
  BrowserRouter as Router,
  Routes,
  useMatch,
} from 'react-router-dom';
import { Portrait } from '@/components';
import { MapNetwork } from '@/features/Glasto/Map';
import { ThemeProvider } from '@/providers';
import { Cous, HireLab, Home, Projects, Shaders } from './routes';
import '../index.css';

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

const App: FC = () => {
  return (
    <ThemeProvider>
      <Router basename="/">
        <Routes>
          {/* The old name for /projects. Old links still land. */}
          <Route path="/apps" element={<Navigate to="/projects" replace />} />
          <Route path="/cous" element={<Cous />} />
          <Route path="/glasto" element={<MapNetwork />} />
          <Route path="/shaders" element={<Shaders />} />
          {/* One path segment: assets load from a relative prefix, so a nested
              path would ask for them under /shaders/. */}
          <Route path="/shaders-hire" element={<HireLab />} />
          <Route element={<WithPortrait />}>
            <Route path="/projects" element={<Projects />} />
            <Route path="/*" element={<Home />} />
          </Route>
        </Routes>
      </Router>
    </ThemeProvider>
  );
};

export { App };
""")

apply('app/routes/hire-lab/hire-lab.tsx', [
("""import { Home } from '../home';
import styles from './hire-lab.module.css';""",
"""import { Portrait } from '@/components';
import { Projects } from '../projects';
import styles from './hire-lab.module.css';"""),
("""import type { FC } from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { HireSettings } from '@/components/shader-ripple';""",
"""import type { FC } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Portrait } from '@/components';
import type { HireSettings } from '@/components/shader-ripple';"""),
("""import { Portrait } from '@/components';
import { Projects } from '../projects';""",
"""import { Projects } from '../projects';"""),
("""/* The real home page, with a small panel to tune its hire field. Open
   "projects" to see the reveal; close it to see it run back. */
const HireLab: FC = () => {
  const initial = useMemo(readHash, []);
  const [hire, setHire] = useState<HireSettings>(initial ?? HIRE_DEFAULTS);
  const [status, setStatus] = useState('');
  // Bumped by "restart" to remount the page: projects closed, no text, no
  // ripples, and a fresh portrait.
  const [run, setRun] = useState(0);""",
"""/* The real projects page, with a small panel to tune its hire field. Turn
   "show text" off to see the text fade out, and on to see it fade in. */
const HireLab: FC = () => {
  const initial = useMemo(readHash, []);
  const [hire, setHire] = useState<HireSettings>(initial ?? HIRE_DEFAULTS);
  const [reveal, setReveal] = useState(true);
  const [status, setStatus] = useState('');
  // Bumped by "restart" to remount the portrait: no text, no ripples, and a
  // fresh face. The text then fades in again.
  const [run, setRun] = useState(0);"""),
("""      <Home key={run} hire={hire} />
      <details className={styles.panel} data-no-ripple open>
        <summary className={styles.title}>hire field</summary>
        <p className={styles.hint}>
          Open and close "projects" to see the reveal. Click anywhere for a
          ripple.
        </p>
""",
"""      <Projects />
      <Portrait key={run} hire={hire} reveal={reveal} />
      <details className={styles.panel} data-no-ripple open>
        <summary className={styles.title}>hire field</summary>
        <p className={styles.hint}>
          Turn "show text" off and on to see the fade. Click anywhere for a
          ripple.
        </p>
        <label className={styles.inline}>
          <input
            type="checkbox"
            checked={reveal}
            onChange={(e) => setReveal(e.target.checked)}
          />
          show text
        </label>
"""),
])
apply('app/routes/hire-lab/hire-lab.module.css', [
(""".inline input {
  flex: 1;
  min-width: 0;
  padding: 0.1rem 0.3rem;
}
""",
""".inline input {
  flex: 1;
  min-width: 0;
  padding: 0.1rem 0.3rem;
}

/* A checkbox keeps its own size. Only the text box grows. */
.inline input[type="checkbox"] {
  flex: none;
}
"""),
])

# --- the follow-up tidy before the first commit attempt -----------------
apply('components/shader-ripple/hire.ts', [
("""/* The projects page's text field: a message that fades in around the
   face on /projects, kept clear of the face and of the page content. A click's front runs out from the portrait in the home
   page's look and, past `crossfade`, in the nebula look. */""",
"""/* The projects page's text field: a message that fades in around the
   face on /projects, kept clear of the face and of the page content. A
   click's front runs out from the portrait in the home page's look and,
   past `crossfade`, in the nebula look. */"""),
])
apply('components/shader-ripple/shader-ripple.tsx', [
("          // Often enough to follow an opening list and a scroll.\n",
 "          // Often enough to follow a scroll or a resize.\n"),
])
