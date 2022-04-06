import { HomeLi } from "../../components";
import { ColorPicker } from "./components";
import Todo from "./components/Todo";

function ThisPage() {
  return (
    <ul>
      {/* <li selected={false}> */}
      <HomeLi trigger="colors">
        <ColorPicker />
      </HomeLi>
      <HomeLi trigger="todo">
        <Todo />
      </HomeLi>
    </ul>
  );
}

export default ThisPage;
