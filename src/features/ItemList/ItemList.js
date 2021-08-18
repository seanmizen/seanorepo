import Collapsible from "react-collapsible"; //https://www.npmjs.com/package/react-collapsible
import styles from "./ItemList.module.css";
import ColorPicker from "../ColorPicker";
import Projects from "../Projects";
import Bitcoin from "../Bitcoin";
import Github from "../Github";

function ItemList() {
  return (
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
          <Bitcoin />
        </Collapsible>
      </li>
      <li>
        <Collapsible trigger="this page">
          <ul>
            <li>
              <Collapsible trigger="colors">
                <ColorPicker />
              </Collapsible>
            </li>
          </ul>
        </Collapsible>
      </li>
    </ul>
  );
}

export default ItemList;
