// Where: apps/thirty. When: before and after a change to the evaluator or the run.
// Why: prints the time of one evaluate() at S=32 and of a full run, for fixtures 7 and 23.
// Then the time of one greedy step on London on the CPU, with 12 and 400 candidates.
// Usage: node scripts/bench.mjs
import { readFileSync } from 'node:fs';
import { FIXTURES } from '../src/fixtures.ts';
import { fromBytes, genCity, mulberry32 } from '../src/gen.ts';
import { evaluate, samples } from '../src/graph.ts';
import { ALGOS, hashNet, run } from '../src/net.ts';
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
let city;
let net;
for (const i of [6, 22]) {
  const p = parse(FIXTURES[i]);
  city = load(p);
  let t = performance.now();
  for (const s of run(city, p)) if (!Array.isArray(s)) net = s.net;
  const runMs = performance.now() - t;
  // The final network of the run, 10 times.
  t = performance.now();
  for (let k = 0; k < 10; k++) evaluate(city, net, p, samples(city, p));
  const evalMs = (performance.now() - t) / 10;
  console.log(
    `| ${i + 1} | ${p.city || 'generated'} | ${evalMs.toFixed(1)} | ${runMs.toFixed(0)} | ${hashNet(net)} |`,
  );
}

// From the final network of fixture 23, with budget 3000 so that new lines fit.
// The step makes the candidate networks, then scores each one on one thread.
console.log('\n| candidates | Networks | Make (ms) | Score (ms) |');
console.log('| --- | --- | --- | --- |');
for (const C of [12, 400]) {
  const p = parse(`${FIXTURES[22]}&candidates=${C}&budget=3000`);
  const ctx = { city, p, rng: mulberry32(1), frac: 0, J: () => 0 };
  let t = performance.now();
  const nets = ALGOS.greedy(net, ctx).score;
  const makeMs = performance.now() - t;
  t = performance.now();
  for (const n of nets) evaluate(city, n, p, samples(city, p));
  const scoreMs = performance.now() - t;
  console.log(
    `| ${C} | ${nets.length} | ${makeMs.toFixed(0)} | ${scoreMs.toFixed(0)} |`,
  );
}
