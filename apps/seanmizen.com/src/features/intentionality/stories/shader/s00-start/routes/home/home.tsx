import type { FC } from 'react';
import { useCallback, useContext, useEffect, useState } from 'react';
import {
  EntityList,
  LastUpdated,
  Spacer,
  SSHModal,
  ThemeToggle,
} from '@/components';
import { Donate, Github, Projects, ThisPage } from '@/features';
import { useKeySequence } from '@/hooks';
import { ThemeContext } from '@/providers';
import { HomeLi } from '../../components/home-li';
import type { HireSettings } from '../../components/shader-ripple';
import {
  HIRE_DEFAULTS,
  HOME_PARAMS,
  ShaderRipple,
} from '../../components/shader-ripple';

/* The page content the hire text keeps clear of. */
const CONTENT = 'main.container > h1, main.container > p, main.container > ul';

/* Below this width the portrait draws at half size. */
const NARROW = '(max-width: 880px)';

const useMatchMedia = (query: string) => {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const list = matchMedia(query);
    const onChange = () => setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
};

type HomeProps = {
  /* The hire field's settings. The /shaders-hire playground passes its
     own to tune them on the real page. */
  hire?: HireSettings;
};

const Home: FC<HomeProps> = ({ hire = HIRE_DEFAULTS }) => {
  const { mode, toggleMode } = useContext(ThemeContext);
  const [isSSHModalOpen, setIsSSHModalOpen] = useState(false);
  // Opening "projects" writes the hire text out across the background.
  const [projectsOpen, setProjectsOpen] = useState(false);
  const openProjects = useCallback(() => setProjectsOpen(true), []);
  const closeProjects = useCallback(() => setProjectsOpen(false), []);
  const narrow = useMatchMedia(NARROW);

  useKeySequence({
    ssh: () => setIsSSHModalOpen(true),
    poop: () => alert('oops, poop!'),
  });

  const subsections = [
    {
      component: <Projects />,
      trigger: 'projects',
      subLink: '/apps',
      subLinkLabel: 'see all projects',
      onOpen: openProjects,
      onClose: closeProjects,
    },
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
        {subsections.map((subsection) => (
          <HomeLi
            key={subsection.trigger}
            trigger={subsection.trigger}
            subLink={subsection.subLink}
            subLinkLabel={subsection.subLinkLabel}
            onOpen={subsection.onOpen}
            onClose={subsection.onClose}
          >
            {subsection.component}
          </HomeLi>
        ))}
      </EntityList>
      <Spacer />
      <div className="shader-container" aria-hidden="true">
        <ShaderRipple
          params={HOME_PARAMS}
          size={0}
          hire={hire}
          reveal={projectsOpen}
          clearSelector={CONTENT}
          portraitScale={narrow ? 0.5 : 1}
        />
      </div>
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
