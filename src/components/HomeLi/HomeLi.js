import styles from "./HomeLi.module.css";
import Collapsible from "react-collapsible";
import { Link } from "react-router-dom";

// HomeLi: An LI tag with Collapsible inside.
const HomeLi = ({ children, trigger, subLink }) => {
  // trigger inherited from Collapsible trigger (it's the Collapsible label)
  const onFocus = (e) => {
    e.currentTarget.classList.add(styles["li-focused"]);
  };
  const onBlur = (e) => {
    e.currentTarget.classList.remove(styles["li-focused"]);
  };
  const onMouseOver = (e) => {
    e.currentTarget.classList.add(styles["li-hover"]);
  };
  const onMouseOut = (e) => {
    e.currentTarget.classList.remove(styles["li-hover"]);
  };

  const toggleCollapsible = (e) => {
    // Allows activating the collapsible by clicking the marker
    // Guaranteed className === "Collapsible"
    // CURRENTLY DISABLED, GOOD GRIEF
    // const collapsibleRef = Array.from(e.currentTarget.children).filter(
    //   (item) => item.className === "Collapsible"
    // )[0].children[0];
    // collapsibleRef.click();
  };

  return (
    <li
      onFocus={onFocus}
      onBlur={onBlur}
      onMouseOver={onMouseOver}
      onMouseOut={onMouseOut}
      onClick={toggleCollapsible}
    >
      <div className={styles["clickable-marker"]}>{"\xa0"}</div>
      <Collapsible transitionTime="100" trigger={trigger} tabIndex={0}>
        {subLink !== undefined && (
          <div className={styles["sublink"]}>
            <Link to={subLink}>visit</Link>
          </div>
        )}
        {children}
      </Collapsible>
    </li>
  );
};
export default HomeLi;
