import "./ThisPage.module.css";
import Collapsible from "react-collapsible";
import ColorPicker from "./components/ColorPicker.js";
import Todo from "./components/Todo";
//import { ChromePicker } from "react-color"; -- redacted: this. Semi-useful library but let's stick with the default <input> instead.

function ThisPage() {
  return (
    <ul>
      <li className="unselected" selected={false}>
        <Collapsible transitionTime="100" trigger="colors">
          <ColorPicker />
        </Collapsible>
      </li>
      <li className="unselected" selected={false}>
        <Collapsible transitionTime="100" trigger="todo">
          <Todo />
        </Collapsible>
      </li>
    </ul>
  );
}

export default ThisPage;
