import { useState } from "react";
import styles from "./ExampleFeature.module.css";

function ExampleFeature() {
  return (
    <div className={styles["example"]}>Hello - I'm an example feature.</div>
  );
}

export default ExampleFeature;
