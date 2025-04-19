import { FC } from 'react';
import { Nav } from '../../components/nav';

interface CollectionsProps {}

const Collections: FC<CollectionsProps> = () => {
  return (
    <>
      <Nav />
      <div>
        <h2>Collections</h2>
      </div>
    </>
  );
};

export { Collections };
export type { CollectionsProps };
