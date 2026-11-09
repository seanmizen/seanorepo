// Where: apps/thirty. When: before and after a change to the evaluator or the run.
// Why: prints the time of one evaluate() at S=32 and of a full run, for fixtures 7 and 23.
// Usage: node scripts/bench.mjs
import { readFileSync } from 'node:fs';
import { FIXTURES } from '../src/fixtures.ts';
import { fromBytes, genCity } from '../src/gen.ts';
import { evaluate } from '../src/graph.ts';
import { hashNet, run } from '../src/net.ts';
import { parse } from '../src/params.ts';

const load = (p) =>
  p.city
    ? fromBytes(
        new Uint8Array(
          readFileSync(
            new URL(`../public/cities/${p.city}.bin`, import.meta.url),
          ),
        ).buffer,
        p.city,
      )
    : genCity(p);

console.log('| Fixture | City | evaluate() S=32 (ms) | Full run (ms) | Hash |');
console.log('| --- | --- | --- | --- | --- |');
for (const i of [6, 22]) {
  const p = parse(FIXTURES[i]);
  const city = load(p);
  let t = performance.now();
  let net;
  for (const s of run(city, p)) if (!Array.isArray(s)) net = s.net;
  const runMs = performance.now() - t;
  // The final network of the run, 10 times.
  t = performance.now();
  for (let k = 0; k < 10; k++) evaluate(city, net, p, 32);
  const evalMs = (performance.now() - t) / 10;
  console.log(
    `| ${i + 1} | ${p.city || 'generated'} | ${evalMs.toFixed(1)} | ${runMs.toFixed(0)} | ${hashNet(net)} |`,
  );
}
