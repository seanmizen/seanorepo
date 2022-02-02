import styles from "./Home.module.css";
import Projects from "../../features/Projects";
import Collapsible from "react-collapsible"; //https://www.npmjs.com/package/react-collapsible
import ThisPage from "../../features/ThisPage/ThisPage";
import Donate from "../../features/Donate";
import Github from "../../features/Github";
import Spacer from "../../components/Spacer";
import { Link } from "react-router-dom";

function Home() {
  return (
    <div className={styles[""]}>
      <h1 alt="shaunmizen.com">seanmizen.com</h1>
      <p>developer | automator | person | he/him</p>
      <Spacer />
      <ul>
        <li>
          <Collapsible transitionTime="100" trigger="projects" tabIndex={0}>
            <div className={styles["sublink"]}>
              <Link to="/apps">visit</Link>
            </div>
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
      <Spacer />
    </div>
  );
}

export default Home;
