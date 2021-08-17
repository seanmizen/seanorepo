import React from "react";
import Nav from "./core/Nav";
import Home from "./features/Home";
import ExampleFeature from "./features/ExampleFeature";
import styles from "./App.module.css";
import { BrowserRouter as Router, Switch, Route } from "react-router-dom";

function App() {
  return (
    <Router>
      <Nav className={styles["nav"]} />
      <div>
        <Switch>
          <Route path="/ExampleFeature">
            <ExampleFeature />
          </Route>
          <Route path="/Home">
            <Home />
          </Route>
          <Route path="/">
            <Home />
          </Route>
        </Switch>
      </div>
    </Router>
  );
}

export default App;
