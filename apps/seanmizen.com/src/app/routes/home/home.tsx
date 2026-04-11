import type { FC } from 'react';
import { useContext, useState } from 'react';
import {
  HomeLi,
  LastUpdated,
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
    { component: <Projects />, trigger: 'projects', subLink: '/apps' },
    { component: <Github />, trigger: 'github' },
    { component: <Donate />, trigger: 'donate' },
    { component: <ThisPage />, trigger: 'this page' },
  ];

  return (
    <main className="container">
      <h1 id="main-content">seanmizen.com</h1>
      <p>developer | automator | person</p>
      <Spacer />
      <ul>
        {subsections.map((subsection) => (
          <HomeLi
            key={subsection.trigger}
            trigger={subsection.trigger}
            subLink={subsection.subLink}
          >
            {subsection.component}
          </HomeLi>
        ))}
      </ul>
      <Spacer />
      <div className="shader-container">
        <ShaderSean />
      </div>
      <div className="bottom-right-controls">
        <LastUpdated apiRepoUrl="https://api.github.com/repos/seanmizen/seanorepo" />
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
