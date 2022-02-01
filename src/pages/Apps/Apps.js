import styles from "./Apps.module.css";
import Projects from "../../features/Projects";

//Adapted from Tiff In Tech's React tutorial (Todo List)

function Apps() {
  return (
    <div>
      <h1 className={styles[""]}>seanmizen.com</h1>
      <h2 className={styles[""]}>current projects:</h2>
      <Projects />
    </div>
  );
}

export default Apps;
