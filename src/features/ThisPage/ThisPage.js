import styles from "./ThisPage.module.css";
import Collapsible from "react-collapsible";
import ColorPicker from "./components/ColorPicker.js";
import Glow from "./components/Glow";
//import { ChromePicker } from "react-color"; -- redacted: this. Semi-useful library but let's stick with the default <input> instead.

function ThisPage() {
  return (
    <ul>
      <li className="unselected" selected={false}>
        <Collapsible trigger="colors">
          <ColorPicker />
        </Collapsible>
      </li>
      <li className="unselected" selected={false}>
        <Collapsible trigger="glow">
          <Glow text={"Oh look, I'm glowing"} />
        </Collapsible>
      </li>
    </ul>
  );
}

export default ThisPage;
