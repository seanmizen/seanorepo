import Collapsible from "react-collapsible"; //https://www.npmjs.com/package/react-collapsible
import ThisPage from "./features/ThisPage/ThisPage";
import Projects from "./features/Projects";
import Donate from "./features/Donate";
import Github from "./features/Github";
import Spacer from "./features/Spacer";
import "./App.module.css";

// todo https://adrianroselli.com/2018/02/github-contributions-chart.html
// Comment for the sake of github workflows

function App() {
  return (
    <div>
      <h1>seanmizen.com</h1>
      <Spacer text={"\xa0"} />

      <p>developer | automator | person | he/him</p>
      <Spacer text={"\xa0"} />
      <ul>
        <li>
          <Collapsible trigger="projects" tabIndex="1">
            <Projects />
          </Collapsible>
        </li>
        <li>
          <Collapsible trigger="github" tabIndex="2">
            <Github />
          </Collapsible>
        </li>
        <li>
          <Collapsible trigger="donate" tabIndex="3">
            <Donate />
          </Collapsible>
        </li>
        <li>
          <Collapsible trigger="this page" tabIndex="4">
            <ThisPage />
          </Collapsible>
        </li>
      </ul>
      <Spacer text={"\xa0"} />
    </div>
  );
}

export default App;
