import { type City, fromBytes, genCity, mulberry32 } from './gen.ts';
import { gpu } from './gpu.ts';
import { type Prep, samples } from './graph.ts';
import { ALGOS, type Batch, type Net } from './net.ts';
import { parse } from './params.ts';
import { pool } from './pool.ts';

// Where: apps/thirty, bench.html. When: before and after a change to a scorer.
// Why: for each row of a grid, times one greedy candidate batch on a mid-run network with three scorers:
// one CPU thread, the CPU pool, and the GPU (pool prep, then upload, dispatch and read). All J must agree.
// The query can replace each list of the grid: city, walk, candidates, samples. A city is a name or a size.
// 1e9 samples: all job cells. A cell is >60 s if the scorer hits the limit, and mem if the D buffers
// of the networks in progress at one time would exceed 2 GB.
const LIMIT = 60000;
const MEM = 2 ** 31;
const CHUNK = 2 ** 28; // bytes of prep for each GPU dispatch
const q = new URLSearchParams(location.search);
const list = (k: string, def: string) => (q.get(k) ?? def).split(',');
const HEAD = [
  'city',
  'walk',
  'candidates',
  'networks',
  'samples',
  '1 thread',
  'pool',
  'GPU prep',
  'upload',
  'dispatch',
  'read',
  'GPU total',
  'pool ÷ GPU',
  'J match',
];
document.title = 'thirty bench';
document.body.innerHTML = `<table><tr>${HEAD.map((h) => `<th>${h}</th>`).join('')}</tr></table>`;
const table = document.querySelector('table') as HTMLTableElement;

const load = async (cq: string) => {
  const p = parse(cq);
  if (!p.city) return genCity(p);
  return fromBytes(
    await (await fetch(`cities/${p.city}.bin`)).arrayBuffer(),
    p.city,
  );
};

// The final network of a run of worker.ts.
const build = (qs: string) =>
  new Promise<Net>((ok, fail) => {
    const w = new Worker(new URL('./worker.ts', import.meta.url));
    w.onmessage = ({ data }) => {
      if (data.type === 'error') fail(new Error(data.message));
      if (data.type !== 'snap' || data.step !== data.total) return;
      w.terminate();
      ok({ lines: data.lines });
    };
    w.postMessage(qs);
  });

type Res = { ms: number; J: number[]; t?: Record<string, number> };
type Job = ReturnType<typeof pool>;
const within = <T>(p: Promise<T>) =>
  Promise.race([
    p,
    new Promise<null>((ok) => setTimeout(() => ok(null), LIMIT)),
  ]);

// Runs score on a pool of n workers, after one evaluate() of the base network on each worker.
// So each worker has the walk lists of the samples and the stations of the base network.
async function timed(
  city: City,
  qs: string,
  base: Net,
  n: number,
  S: number,
  score: (job: Job, late: () => boolean) => Promise<Omit<Res, 'ms'> | null>,
): Promise<Res | string> {
  if (n * S * S * 4 > MEM) return 'mem';
  const job = pool(city, qs, n);
  try {
    const warm = Array.from({ length: n }, () =>
      job({ net: base, S, out: 'J' }),
    );
    if (!(await within(Promise.all(warm)))) return '>60 s';
    const t0 = performance.now();
    const r = await within(score(job, () => performance.now() > t0 + LIMIT));
    return r ? { ...r, ms: performance.now() - t0 } : '>60 s';
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  } finally {
    job.stop();
  }
}

async function row(city: City, qs: string, base: Net, nets: Net[]) {
  const S = samples(city, parse(qs));
  const P = Math.max(1, navigator.hardwareConcurrency - 1);
  const cpu = (job: Job) =>
    Promise.all(nets.map((net) => job<number>({ net, S, out: 'J' }))).then(
      (J) => ({ J }),
    );
  const one = await timed(city, qs, base, 1, S, cpu);
  const all = await timed(city, qs, base, P, S, cpu);
  const g = await gpu(city, parse(qs), S);
  const gp = g
    ? await timed(city, qs, base, P, S, async (job, late) => {
        // Prep and score in chunks of about CHUNK bytes, so the preps of a big batch never all exist.
        const t: Record<string, number> = { prep: 0 };
        const J: number[] = [];
        for (let a = 0, m = P; a < nets.length; ) {
          if (late()) return null;
          const t0 = performance.now();
          const ps = await Promise.all(
            nets
              .slice(a, a + m)
              .map((net) => job<Prep>({ net, S, out: 'prep' })),
          );
          t.prep += performance.now() - t0;
          J.push(...(await g(ps, t)));
          a += ps.length;
          const bytes = ps.reduce(
            (s, x) => s + x.D.byteLength + x.ent.byteLength,
            0,
          );
          m = Math.max(P, Math.floor((CHUNK * ps.length) / bytes));
        }
        return { J, t };
      })
    : 'no GPU';
  const ms = (r: Res | string, k?: string) =>
    typeof r === 'string' ? r : String(Math.round(k ? (r.t?.[k] ?? 0) : r.ms));
  const done = [one, all, gp].filter((r): r is Res => typeof r !== 'string');
  const same = done.every(
    (r) =>
      r.J.length === nets.length && r.J.every((j, k) => j === done[0].J[k]),
  );
  const p = parse(qs);
  const cells = [
    p.city || `size ${p.size}`,
    p.walk,
    p.candidates,
    nets.length,
    S === p.samples ? S : `all (${S})`,
    ms(one),
    ms(all),
    ...['prep', 'upload', 'dispatch', 'read'].map((k) => ms(gp, k)),
    ms(gp),
    typeof all === 'string' || typeof gp === 'string'
      ? '-'
      : `${(all.ms / gp.ms).toFixed(1)}×`,
    done.length < 2 ? '-' : same ? 'yes' : 'no',
  ];
  const tr = table.insertRow();
  for (const c of cells) tr.insertCell().textContent = String(c);
  console.log(`| ${cells.join(' | ')} |`);
}

try {
  const adapter = await navigator.gpu?.requestAdapter();
  document.body.dataset.gpu = adapter ? '1' : '0';
  for (const c of list('city', 'london,512')) {
    const cq = /^\d+$/.test(c) ? `size=${c}` : `city=${c}`;
    const city = await load(cq);
    for (const walk of list('walk', '20,60')) {
      // The base: 20 greedy steps with the default candidates and samples. Then budget 3000, so new lines fit.
      const base = await build(`${cq}&walk=${walk}&algo=greedy&steps=20`);
      for (const C of list('candidates', '12,400,2000')) {
        const qc = `${cq}&walk=${walk}&candidates=${C}&budget=3000`;
        const ctx = {
          city,
          p: parse(qc),
          rng: mulberry32(1),
          frac: 0,
          J: () => 0,
        };
        const nets = (ALGOS.greedy(base, ctx) as Batch).score;
        for (const S of list('samples', '32,256,1024,1e9'))
          await row(city, `${qc}&samples=${S}`, base, nets);
      }
    }
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
} finally {
  document.body.dataset.done = '1';
}
