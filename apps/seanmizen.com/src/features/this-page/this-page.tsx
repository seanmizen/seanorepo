import type { FC } from 'react';
import { HomeLi } from '@/components';
import { ColorPicker, Todo } from './components';

const ThisPage: FC = () => {
  return (
    <ul>
      <HomeLi trigger="colors">
        <ColorPicker />
      </HomeLi>
      <HomeLi trigger="todo">
        <Todo />
      </HomeLi>
    </ul>
  );
};

export { ThisPage };
