#!/usr/bin/env node
import { render } from 'ink';
import meow from 'meow';
import { App } from './app.js';

const cli = meow(
  `
	Usage
	  $ tty-dashboard
`,
  {
    importMeta: import.meta,
    flags: {
      name: {
        type: 'string',
      },
    },
  },
);

render(<App name={cli.flags.name} />);
