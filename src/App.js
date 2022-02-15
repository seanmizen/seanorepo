import "./index.css";
import Home from "./pages/Home";
import Apps from "./pages/Apps";
import React from "react";
import { ThemeProvider } from "./Theme";
import { BrowserRouter as Router, Switch, Route } from "react-router-dom";

function App() {
  return (
    <ThemeProvider>
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
      </Router>
    </ThemeProvider>
  );
}

export default App;
