import Collapsible from "react-collapsible"; //https://www.npmjs.com/package/react-collapsible
import "./ItemList.module.css";
import ThisPage from "../ThisPage/ThisPage";
import Projects from "../Projects";
import Bitcoin from "../Bitcoin";
import Github from "../Github";

function ItemList() {
  return (
    <ul>
      <li className="unselected" selected={false}>
        <Collapsible trigger="projects">
          <Projects />
        </Collapsible>
      </li>
      <li className="unselected" selected={false}>
        <Collapsible trigger="github">
          <Github />
        </Collapsible>
      </li>
      <li className="unselected" selected={false}>
        <Collapsible trigger="donate">
          <Bitcoin />
        </Collapsible>
      </li>
      <li className="unselected" selected={false}>
        <Collapsible trigger="this page">
          <ThisPage />
        </Collapsible>
      </li>
    </ul>
  );
}

export default ItemList;
