import React from "react";
import Nav from "./core/Nav";
import Home from "./features/Home";
import ExampleFeature from "./features/ExampleFeature";
import { BrowserRouter as Router, Switch, Route } from "react-router-dom";
//import './App.css';

function App() {
  return (
    <Router>
      <Nav />
      <div className="container">
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
