import styles from "./HomeLink.module.css";
import { Link } from "react-router-dom";

const HomeLink = () => {
  return (
    <Link className={styles["home-link"]} alt="visit projects" to="/">
      go home
    </Link>
  );
};

export default HomeLink;
