import React from "react";

import { HomeLi, LastUpdated, Spacer, ThemeToggle } from "../../components";
import { Donate, Github, Projects, ThisPage, Xmas } from "../../features";
import { ThemeContext } from "../../providers/Theme";
import { ShaderSean } from "../../components/ShaderSean";
import { useKeySequence } from "../../hooks";

const Home = ({ setIsSnowing }) => {
  const { mode, toggleMode } = React.useContext(ThemeContext);

  useKeySequence({
    ssh: () => alert("SSH sequence detected!"),
    poop: () => alert("oops, poop!"),
  });

  const subsections = [
    { component: <Projects />, trigger: "projects", subLink: "/apps" },
    { component: <Github />, trigger: "github" },
    { component: <Donate />, trigger: "donate" },
    { component: <ThisPage />, trigger: "this page" },
  ];

  return (
    <div className="container">
      <h1 alt="shaunmizen.com">seanmizen.com</h1>
      <p>developer | automator | person</p>
      <Spacer />
      <ul>
        {subsections.map((subsection, index) => (
          <HomeLi
            key={index}
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
    </div>
  );
};

export { Home };
