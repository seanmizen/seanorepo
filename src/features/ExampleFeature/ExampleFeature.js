import { useState } from "react";
import styles from "./ExampleFeature.module.css";

function ExampleFeature() {
  return (
    <div className={styles["challenge"]}>
      <div>
        <p>Hello!</p>
      </div>
    </div>
  );
}

export default ExampleFeature;
