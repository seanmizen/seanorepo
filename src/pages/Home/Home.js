import styles from "./Home.module.css";
import { Projects, ThisPage, Donate, Github } from "../../features";
import { Spacer, LastUpdated, ThemeToggle } from "../../components";
import { Link } from "react-router-dom";
import { ThemeContext } from "../../Theme";
import Collapsible from "react-collapsible";
import React from "react";

function Home() {
  const { mode, toggleMode } = React.useContext(ThemeContext);

  const clickableMarker = (e) => {
    // Allows clicking the <li> marker to activate the collapsible
    e.target.nextSibling.children[0].click();
  };

  return (
    <div className={"container"}>
      <h1 className="test" alt="shaunmizen.com">
        seanmizen.com
      </h1>
      <p>developer | automator | person | he/him</p>
      <Spacer />
      <ul className={styles["home-list"]}>
        <li>
          <div onClick={clickableMarker} className={styles["clickable-marker"]}>
            {"\xa0"}
          </div>
          <Collapsible transitionTime="100" trigger="projects" tabIndex={0}>
            <div className={styles["sublink"]}>
              <Link to="/apps">visit</Link>
            </div>
            <Projects />
          </Collapsible>
        </li>
        <li>
          <div onClick={clickableMarker} className={styles["clickable-marker"]}>
            {"\xa0"}
          </div>
          <Collapsible transitionTime="100" trigger="github" tabIndex={0}>
            <Github />
          </Collapsible>
        </li>
        <li>
          <div onClick={clickableMarker} className={styles["clickable-marker"]}>
            {"\xa0"}
          </div>
          <Collapsible transitionTime="100" trigger="donate" tabIndex={0}>
            <Donate />
          </Collapsible>
        </li>
        <li>
          <div onClick={clickableMarker} className={styles["clickable-marker"]}>
            {"\xa0"}
          </div>
          <Collapsible transitionTime="100" trigger="this page" tabIndex={0}>
            <ThisPage />
          </Collapsible>
        </li>
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
