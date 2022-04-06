import styles from "./Home.module.css";
import { Projects, ThisPage, Donate, Github } from "../../features";
import { Spacer, LastUpdated, ThemeToggle } from "../../components";
import { HomeLi } from "./components";
import { Link } from "react-router-dom";
import { ThemeContext } from "../../Theme";
import Collapsible from "react-collapsible";
import React from "react";

function Home() {
  const { mode, toggleMode } = React.useContext(ThemeContext);

  const toggleCollapsible = (e) => {
    // Allows activating the collapsible by clicking the marker
    // Guaranteed className === "Collapsible"
    const collapsibleRef = Array.from(e.currentTarget.children).filter(
      (item) => item.className === "Collapsible"
    )[0].children[0];
    collapsibleRef.click();
  };

  const subsections = [
    { component: <Projects />, trigger: "projects", subLink: "/apps" },
    { component: <Github />, trigger: "github" },
    { component: <Donate />, trigger: "donate" },
    { component: <ThisPage />, trigger: "this page" },
  ];

  return (
    <div className={"container"}>
      <h1 className="test" alt="shaunmizen.com">
        seanmizen.com
      </h1>
      <p>developer | automator | person | he/him</p>
      <Spacer />
      <ul className={styles["home-list"]}>
        {subsections.map((subsection, index) => {
          return (
            <HomeLi key={index} onClick={toggleCollapsible}>
              <Collapsible
                transitionTime="100"
                trigger={subsection.trigger}
                tabIndex={0}
              >
                {subsection.subLink !== undefined && (
                  <div className={styles["sublink"]}>
                    <Link to={subsection.subLink}>visit</Link>
                  </div>
                )}
                {subsection.component}
              </Collapsible>
            </HomeLi>
          );
        })}
      </ul>
      <Spacer />
      <LastUpdated
        apiRepoUrl={
          "https://api.github.com/repos/seanmizen/seanmizen.com-react"
        }
      />
      <ThemeToggle mode={mode} toggleMode={toggleMode} />
    </div>
  );
}

export default Home;
