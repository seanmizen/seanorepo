#!/usr/bin/env node
// Start the qc CLI on Node. tsx compiles the TypeScript source on load.
import { register } from 'tsx/esm/api';

register();
await import('../src/cli.ts');
