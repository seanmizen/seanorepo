import React from "react";
import ExampleFeature from "./features/ExampleFeature";
import ItemList from "./features/ItemList";
import styles from "./App.module.css";

//todo https://adrianroselli.com/2018/02/github-contributions-chart.html

function App() {
  return (
    <div>
      <h1>seanmizen.com</h1>
      <p>developer | automator | person | he/him</p>
      <ItemList />
    </div>
  );
}

export default App;
