import { Glasto } from "./features/Glasto";
import "./index.css";

import { Apps, Home } from "./pages";
import { ThemeProvider } from "./providers/Theme";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
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

const App = () => {
  return (
    <ThemeProvider>
      {/* <Router basename={process.env.REACT_APP_BASENAME}> */}
      <Router basename={"/"}>
        <Routes>
          <Route path="/apps" element={<Apps />} />
          <Route path="/glasto" element={<Glasto />} />
          <Route path="/*" element={<Home setIsSnowing={() => {}} />} />
        </Routes>
      </Router>
    </ThemeProvider>
  );
};

export { App };
