import moduleStyles from "./Apps.module.css";
import globalStyles from "../../App.module.css";
import Projects from "../../features/Projects";
import HomeLink from "../../components/HomeLink";
import Spacer from "../../components/Spacer";
const styles = { ...moduleStyles, ...globalStyles };

function Apps() {
  return (
    <div className={styles["container"]}>
      <h1 className={styles["no-animation"]}>seanmizen.com</h1>
      <h2 className={styles[""]}>current projects:</h2>
      <div className={styles["padded-left"]}>
        <Projects />
      </div>
      {/* TODO move Spacer / HomeLink into a nav-style component which is on all pages but Home */}
      <Spacer />
      <HomeLink />
    </div>
  );
}

export default Apps;
