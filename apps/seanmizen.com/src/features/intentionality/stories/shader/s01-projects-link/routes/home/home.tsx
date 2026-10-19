import type { FC } from 'react';
import { useContext, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Entity,
  EntityList,
  LastUpdated,
  Spacer,
  SSHModal,
  ThemeToggle,
} from '@/components';
import { Donate, Github, ThisPage } from '@/features';
import { useKeySequence } from '@/hooks';
import { ThemeContext } from '@/providers';
import { HomeLi } from '../../components/home-li';

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
