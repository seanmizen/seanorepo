import styles from "./ThemeToggle.module.css";

const ThemeToggle = ({ mode, toggleMode }) => {
  return (
    <div className={styles["theme-toggle-outer"]}>
      <div className={styles["theme-toggle-inner"]}>
        <button onClick={() => toggleMode()}>
          {("\xa0theme: " + mode + "\xa0").replace("system", "auto")}
        </button>
      </div>
    </div>
  );
};

export default ThemeToggle;
