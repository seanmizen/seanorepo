import moduleStyles from "./Github.module.css";
import globalStyles from "../../App.module.css";
const styles = { ...moduleStyles, ...globalStyles };

function Github() {
  return (
    <div>
      <a
        tabIndex={0}
        role="listitem"
        aria-label="Github URL"
        href="https://github.com/seanmizen"
      >
        github.com/seanmizen
      </a>
      <div>
        <p className={styles["code"]}>
          i am testing out
          <br />
          how to display code nicely
          <br />
          <p className={styles["command-line"]}>echo yes &gt; myfile.txt</p>
        </p>
      </div>
    </div>
  );
}

export default Github;
