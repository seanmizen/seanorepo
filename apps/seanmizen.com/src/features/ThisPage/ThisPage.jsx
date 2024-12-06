import { HomeLi } from '../../components';

import Todo from './components/Todo';
import { ColorPicker } from './components';

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
