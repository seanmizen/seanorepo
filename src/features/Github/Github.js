import moduleStyles from "./Github.module.css";
import globalStyles from "../../App.module.css";
import Code from "../../components/Code";
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
        <Code>
          i am testing out
          <br />
          how to display code nicely
          <br />
        </Code>
        <br />
        <div className={styles[""] + " " + styles["command-line"]}>
          echo yes &gt; myfile.txt
        </div>
      </div>
    </div>
  );
}

export default Github;
