import { useState } from "react";
import ExampleFeature from "../ExampleFeature";
import styles from "./ItemList.module.css";

function ItemList() {
  return (
    <ul>
      <li>
        <ExampleFeature />
      </li>
      <li>
        <ExampleFeature />
      </li>
    </ul>
  );
}

export default ItemList;
