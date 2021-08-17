import React, { Component } from "react";
import { Link } from "react-router-dom";
import styles from "./Nav.module.css";

class Nav extends Component {
  render() {
    return (
      <nav className={styles["nav"]}>
        <div className="container">
          <ul className={styles["nav-list"]}>
            <li className={styles["nav-list-item"]}>
              <Link to="/Home">Home</Link>
            </li>
            <li className={styles["nav-list-spacer"]} />
            <li className={styles["nav-list-item"]}>
              <Link to="/ExampleFeature">Example Feature</Link>
            </li>
          </ul>
        </div>
      </nav>
    );
  }
}

export default Nav;
