import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { genesis } from '../src/engine.ts';
import { Run } from '../src/run.ts';

export const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixture');

export type Script = Record<
  string,
  Record<string, { tool: string; args?: Record<string, unknown> }[]>
>;

/** A new run of the fixture scenario in a fresh temp folder. Scratch folders stay. */
export function makeRun(
  script: Script = {},
  cast = 'scripted',
  name = 'r',
  prepare?: (scenarioDir: string) => void,
): Run {
  const root = mkdtempSync(join(tmpdir(), 'qc-test-'));
  const scenarioDir = join(root, 'scenario');
  cpSync(FIXTURE, scenarioDir, { recursive: true });
  writeFileSync(join(scenarioDir, 'scripts', 'test.yaml'), stringify(script));
  prepare?.(scenarioDir);
  const run = Run.init({
    name,
    scenarioDir,
    cast,
    runsDir: join(root, 'runs'),
  });
  genesis(run);
  return run;
}

/** Every file under a folder, as relative path -> content. */
export function tree(
  dir: string,
  skip: (rel: string) => boolean = () => false,
): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const rel = relative(dir, p);
      if (skip(rel)) continue;
      if (statSync(p).isDirectory()) {
        out[`${rel}/`] = '';
        walk(p);
      } else out[rel] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

export const call = (tool: string, args: Record<string, unknown> = {}) => ({
  tool,
  args,
});
