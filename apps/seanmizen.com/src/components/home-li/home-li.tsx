import type { FC, ReactNode } from 'react';
import { Accordion } from '../accordion';
import { Entity } from '../entity-list';

interface HomeLiProps {
  children: ReactNode;
  trigger: string;
}

const HomeLi: FC<HomeLiProps> = ({ children, trigger }) => (
  <Entity>
    <Accordion trigger={trigger}>{children}</Accordion>
  </Entity>
);

export { HomeLi };
