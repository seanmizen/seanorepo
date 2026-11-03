import type { ReactNode } from 'react';
import { Label } from './Label';

/**
 * The layout of every page: the plate with the page title on its glass, then
 * the chassis that holds the panels. renderPage() wraps each page in it.
 */
export const Page = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <div className="page">
    <header className="plate">
      <div className="glass">
        <a href="/">
          <Label>crm</Label>
        </a>
        <h1>{title}</h1>
      </div>
    </header>
    <main className="chassis">{children}</main>
  </div>
);
