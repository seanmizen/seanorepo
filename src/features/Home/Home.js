import { useState } from "react";
import styles from "./Home.module.css";

function Home() {
  return (
    <div className={styles["home"]}>
      <p>Hello! This is home.</p>
    </div>
  );
}

export default Home;
