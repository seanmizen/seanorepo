import Collapsible from "react-collapsible";
import ColorPicker from "./components/ColorPicker";
import Todo from "./components/Todo";

function ThisPage() {
  return (
    <ul>
      <li selected={false}>
        <Collapsible tabIndex={0} transitionTime="100" trigger="colors">
          <ColorPicker />
        </Collapsible>
      </li>
      <li selected={false}>
        <Collapsible tabIndex={0} transitionTime="100" trigger="todo">
          <Todo />
        </Collapsible>
      </li>
    </ul>
  );
}

export default ThisPage;
