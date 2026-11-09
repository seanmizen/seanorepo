// The URLs that must work. Four generated cities (river, bay, archipelago, ridge), a bigger map, London and Lisbon.
// The last two have station prices and snapped stops (S).
const A = 'seed=11&sea=0.1&rivers=3&hills=0.2';
const B = 'seed=22&sea=0.35&rivers=1&hills=0.3';
const C = 'seed=33&sea=0.55&warp=0.8&rivers=0';
const D = 'seed=44&sea=0.05&hills=0.9&rivers=2';
const S =
  'tram.station=2&tube.station=20&rer.station=15&express.station=25&snap=0.5';

export const FIXTURES = [
  A,
  `${A}&algo=greedy&steps=30`,
  `${A}&algo=anneal&steps=200`,
  `${A}&algo=random&steps=30`,
  `${A}&algo=greedy&steps=30&run=2`,
  B,
  `${B}&algo=greedy&steps=30&N=30`,
  `${B}&algo=greedy&steps=30&N=45`,
  `${B}&algo=greedy:20,anneal:100`,
  `${B}&algo=greedy&steps=30&tiers=tram,tube`,
  C,
  `${C}&algo=greedy&steps=30`,
  `${C}&algo=greedy&steps=30&budget=200`,
  `${C}&algo=anneal&steps=200`,
  `${C}&algo=greedy&steps=30&tiers=rer,express`,
  D,
  `${D}&algo=greedy&steps=30`,
  `${D}&algo=greedy&steps=30&tube.headway=2`,
  `${D}&algo=random&steps=30&run=7`,
  `${D}&algo=greedy:20,anneal:100&N=60`,
  `${B}&size=256&algo=greedy&steps=30`,
  'city=london',
  'city=london&algo=greedy&steps=30',
  'city=lisbon',
  'city=lisbon&algo=greedy&steps=30',
  `city=london&algo=greedy&steps=30&${S}`,
  `${B}&algo=greedy&steps=30&${S}`,
];

// Index pairs (0-based) that differ only in run, N, tiers or S. Their hashes must differ.
// The test for a pair runs in the file that holds the first index.
export const DIFFERENT = [
  [1, 4],
  [6, 7],
  [6, 9],
  [11, 14],
  [26, 6],
];

// Index (0-based) to hash. The defaults of the station prices and snap must not change these.
export const HASHES: Record<number, string> = {
  1: '281b6026',
  6: '9d37b571',
  22: '7d723836',
};
