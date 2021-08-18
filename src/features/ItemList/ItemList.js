import Collapsible from "react-collapsible"; //https://www.npmjs.com/package/react-collapsible
import ColorPicker from "../ColorPicker";
import ExampleFeature from "../ExampleFeature";
import Bitcoin from "../Bitcoin";
import styles from "./ItemList.module.css";

function ItemList() {
  return (
    <ul>
      <li>
        <Collapsible trigger="projects">
          <ExampleFeature />
        </Collapsible>
      </li>
      <li>
        <Collapsible trigger="github">
          <ExampleFeature />
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
