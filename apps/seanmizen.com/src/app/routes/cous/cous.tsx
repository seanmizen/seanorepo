import type { FC } from 'react';
import { HomeLink, Spacer } from '@/components';
import { Cous as CousGame } from '@/features';

const Cous: FC = () => (
  <main className="container">
    <h1>cous</h1>
    <CousGame />
    <Spacer />
    <nav aria-label="Site">
      <HomeLink />
    </nav>
  </main>
);

export { Cous };
