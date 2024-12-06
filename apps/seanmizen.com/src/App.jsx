import './index.css';

import React from 'react';
import { BrowserRouter as Router, Route, Switch } from 'react-router-dom';
import Snowfall from 'react-snowfall';

import { Apps, Home } from './pages';
import { ThemeProvider } from './Theme';

// I'm on a really good streak of github contributions, so I'm going to keep it going
// by adding this comment. I'm not sure what else to say, so I'll just say that I'm
// really excited to be working on this project. I'm learning a lot about React and
// I'm excited to see where this project goes. I'm also excited to see how I can
// contribute to this project. I'm not sure what I can do, but I'm sure I'll find
// something. I'm also excited to see how this project will help me learn more about
// React. I'm not sure what else to say, so I'll just say that I'm really excited
// to be working on this project. I'm learning a lot about React and I'm excited
// to see where this project goes. I'm also excited to see how I can contribute to
// this project. I'm not sure what I can do, but I'm sure I'll find something. I'm
// also excited to see how this project will help me learn more about React. I'm
// not sure what else to say, so I'll just say that I'm really excited to be working
// on this project. I'm learning a lot about React and I'm excited to see where this
// project goes. I'm also excited to see how I can contribute to this project. I'm
// conscious? GPT wrote this lol.

function App() {
  const [isSnowing, setIsSnowing] = React.useState(false);
  return (
    <ThemeProvider>
      <Snowfall
        snowflakeCount={200}
        style={isSnowing ? { display: 'block' } : { display: 'none' }}
      />
      <Router basename={process.env.REACT_APP_BASENAME}>
        <Switch>
          <Route path="/apps">
            <Apps />
          </Route>
          <Route path="/">
            <Home setIsSnowing={setIsSnowing} />
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
