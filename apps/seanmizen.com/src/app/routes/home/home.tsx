import type { FC } from 'react';
import { useContext, useState } from 'react';
import {
  EntityList,
  HomeLi,
  ShaderSean,
  Spacer,
  SSHModal,
  ThemeToggle,
} from '@/components';
import { Donate, Github, Projects, ThisPage } from '@/features';
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
    {
      component: <Projects />,
      trigger: 'projects',
      subLink: '/apps',
      subLinkLabel: 'see all projects',
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
          >
            {subsection.component}
          </HomeLi>
        ))}
      </EntityList>
      <Spacer />
      <div className="shader-container">
        <ShaderSean />
      </div>
      <div className="bottom-right-controls">
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
