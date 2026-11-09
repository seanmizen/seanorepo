import type { FC } from 'react';
import { EntityList, HomeLi, THIRTY_CREDIT } from '@/components';
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
      <HomeLi trigger="background">
        <p>{THIRTY_CREDIT}</p>
      </HomeLi>
    </EntityList>
  );
};

export { ThisPage };
