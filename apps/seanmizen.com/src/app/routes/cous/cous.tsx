import type { FC } from 'react';
import { HomeLink, Spacer } from '@/components';
import { Cous as CousGame } from '@/features';

const Cous: FC = () => {
  return (
    <main className="container">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <h1 id="main-content">cous</h1>
      <CousGame />
      <Spacer />
      <nav>
        <HomeLink />
      </nav>
    </main>
  );
};

export { Cous };
