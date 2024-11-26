import { Projects, ThisPage, Donate, Github, Xmas } from '../../features';
import { Spacer, LastUpdated, ThemeToggle, HomeLi } from '../../components';
import { ThemeContext } from '../../Theme';
import React from 'react';

function Home({ setIsSnowing }) {
  const { mode, toggleMode } = React.useContext(ThemeContext);

  const subsections = [
    { component: <Projects />, trigger: 'projects', subLink: '/apps' },
    { component: <Github />, trigger: 'github' },
    { component: <Donate />, trigger: 'donate' },
    { component: <ThisPage />, trigger: 'this page' },
    { component: <Xmas />, trigger: 'Xmas 🎄' },
  ];

  return (
    <div className={'container'}>
      <h1 alt="shaunmizen.com">seanmizen.com</h1>
      <p>developer | automator | person</p>
      <Spacer />
      <ul>
        {subsections.map((subsection, index) => {
          return (
            <HomeLi
              key={index}
              trigger={subsection.trigger}
              subLink={subsection.subLink}
              setIsSnowing={setIsSnowing}
            >
              {subsection.component}
            </HomeLi>
          );
        })}
      </ul>
      <Spacer />
      <LastUpdated apiRepoUrl={'https://api.github.com/repos/seanmizen/seanmizen.com-react'} />
      <ThemeToggle mode={mode} toggleMode={toggleMode} />
    </div>
  );
}

export default Home;