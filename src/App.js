import Collapsible from "react-collapsible"; //https://www.npmjs.com/package/react-collapsible
import ThisPage from "./features/ThisPage/ThisPage";
import Projects from "./features/Projects";
import Donate from "./features/Donate";
import Github from "./features/Github";
import Spacer from "./features/Spacer";
import "./App.module.css";

//todo https://adrianroselli.com/2018/02/github-contributions-chart.html

function App() {
  return (
    <div>
      <h1>seanmizen.com</h1>
      <Spacer text="-" />
      <p>developer | automator | person | he/him</p>
      <Spacer text="-" />
      <ul>
        <li>
          <Collapsible trigger="projects">
            <Projects />
          </Collapsible>
        </li>
        <li>
          <Collapsible trigger="github">
            <Github />
          </Collapsible>
        </li>
        <li>
          <Collapsible trigger="donate">
            <Donate />
          </Collapsible>
        </li>
        <li>
          <Collapsible trigger="this page">
            <ThisPage />
          </Collapsible>
        </li>
      </ul>
      <Spacer text="" />
    </div>
  );
}

export default App;
