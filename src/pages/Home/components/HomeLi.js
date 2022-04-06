import styles from "../Home.module.css";
const HomeLi = ({ children, onClick }) => {
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

  return (
    <li
      onFocus={onFocus}
      onBlur={onBlur}
      onMouseOver={onMouseOver}
      onMouseOut={onMouseOut}
      onClick={onClick}
    >
      <div className={styles["clickable-marker"]}>{"\xa0"}</div>
      {children}
    </li>
  );
};
export default HomeLi;
