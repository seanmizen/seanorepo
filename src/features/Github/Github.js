import Code from "../../components/Code";
import styles from "./Github.module.css";

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
        <Code content={"// i am testing out\n// how to display code nicely"} />
        <Code commandLine content={'screen -dm bash -c "yes > brick.txt"'} />
      </div>
      <div>
        below, you'll see me try out some vibrant colours using{" "}
        <em>display-p3</em> (safari only - feb 2022). <br />
        on your device these might all look the same!
      </div>
      <div className={styles["p3-test"]}>
        <span className={styles["salmon-pink"]} />
        <span className={styles["p3-salmon-pink"]} />
        <span className={styles["pinkest-pink"]} />
        <span className={styles["p3-pinkest-pink"]} />
        <span className={styles["greenest-green"]} />
        <span className={styles["p3-greenest-green"]} />
        <span className={styles["reddest-red"]} />
        <span className={styles["p3-reddest-red"]} />
      </div>
    </div>
  );
}

export default Github;
