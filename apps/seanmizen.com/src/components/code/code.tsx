import type { FC } from 'react';
import './code.module.css';

interface CodeProps {
  content: string;
  commandLine?: boolean;
}

const Code: FC<CodeProps> = ({ content, commandLine }) => {
  return (
    <pre>
      <code>
        {!commandLine
          ? content
          : content
              .split('\n')
              .map((item) => <span key={item}>{`${item}\n`}</span>)}
      </code>
    </pre>
  );
};

export { Code };
