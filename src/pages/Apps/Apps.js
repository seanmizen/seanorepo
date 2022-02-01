import styles from "./Apps.module.css";
import Projects from "../../features/Projects";

function Apps() {
  return (
    <div>
      <h1 className={styles["no-animation"]}>seanmizen.com</h1>
      <h2 className={styles[""]}>current projects:</h2>
      <Projects />
    </div>
  );
}

export default Apps;
