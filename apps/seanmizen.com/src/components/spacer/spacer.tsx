import type { FC } from 'react';

interface SpacerProps {
  text?: string;
}

const Spacer: FC<SpacerProps> = ({ text }) => {
  return <div>{text || '\xa0'}</div>;
};

export { Spacer };
