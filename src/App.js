import Home from "./pages/Home";
import Apps from "./pages/Apps";
import LastUpdated from "./components/LastUpdated/LastUpdated";
import React from "react";
import "./App.module.css"; //default css
import { BrowserRouter as Router, Switch, Route } from "react-router-dom";
// todo https://adrianroselli.com/2018/02/github-contributions-chart.html
// Comment for the sake of github workflows.

function App() {
  return (
    <Router basename={process.env.REACT_APP_BASENAME}>
      <Switch>
        <Route path="/apps">
          <Apps />
        </Route>
        <Route path="/">
          <Home />
        </Route>
        <Route path="/*">
          <Home />
        </Route>
      </Switch>
      <LastUpdated />
    </Router>
  );
}

export default App;
