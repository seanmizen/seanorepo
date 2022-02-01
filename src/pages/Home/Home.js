import styles from "./Home.module.css";
import Projects from "../../features/Projects";
import Collapsible from "react-collapsible"; //https://www.npmjs.com/package/react-collapsible
import ThisPage from "../../features/ThisPage/ThisPage";
import Donate from "../../features/Donate";
import Github from "../../features/Github";
import Spacer from "../../features/Spacer";

function Home() {
  return (
    <div className={styles[""]}>
      <h1>seanmizen.com</h1>
      <p>developer | automator | person | he/him</p>
      <Spacer text={"\xa0"} />
      <ul>
        <li>
          <Collapsible transitionTime="100" trigger="projects" tabIndex={0}>
            <Projects />
          </Collapsible>
        </li>
        <li>
          <Collapsible transitionTime="100" trigger="github" tabIndex={0}>
            <Github />
          </Collapsible>
        </li>
        <li>
          <Collapsible transitionTime="100" trigger="donate" tabIndex={0}>
            <Donate />
          </Collapsible>
        </li>
        <li>
          <Collapsible transitionTime="100" trigger="this page" tabIndex={0}>
            <ThisPage />
          </Collapsible>
        </li>
      </ul>
      <Spacer text={"\xa0"} />
    </div>
  );
}

export default Home;
