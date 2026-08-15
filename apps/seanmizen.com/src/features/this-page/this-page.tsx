import type { FC } from 'react';
import { EntityList, HomeLi } from '@/components';
import { ColorPicker, Todo } from './components';

const ThisPage: FC = () => {
  return (
    <EntityList>
      <HomeLi trigger="colors">
        <ColorPicker />
      </HomeLi>
      <HomeLi trigger="todo">
        <Todo />
      </HomeLi>
    </EntityList>
  );
};

export { ThisPage };
