import { useContext, useState } from 'react';

import {
  HomeLi,
  LastUpdated,
  Spacer,
  SSHModal,
  ThemeToggle,
} from '../../components';
import { ShaderSean } from '../../components/ShaderSean';
import { Donate, Github, Projects, ThisPage, Xmas } from '../../features';
import { useKeySequence } from '../../hooks';
import { ThemeContext } from '../../providers/Theme';

const Home = ({ setIsSnowing }) => {
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
    { component: <Xmas />, trigger: 'xmas lists!' },
  ];

  return (
    <div className="container">
      <h1 alt="shaunmizen.com">seanmizen.com</h1>
      <p>developer | automator | person</p>
      <Spacer />
      <ul>
        {subsections.map((subsection) => (
          <HomeLi
            key={subsection.trigger}
            trigger={subsection.trigger}
            subLink={subsection.subLink}
            setIsSnowing={setIsSnowing}
          >
            {subsection.component}
          </HomeLi>
        ))}
      </ul>
      <Spacer />
      <LastUpdated apiRepoUrl="https://api.github.com/repos/seanmizen/seanorepo" />
      <div className="shader-container">
        <ShaderSean />
      </div>
      <ThemeToggle mode={mode} toggleMode={toggleMode} />
      <SSHModal
        isOpen={isSSHModalOpen}
        onClose={() => setIsSSHModalOpen(false)}
      />
    </div>
  );
};

export { Home };
