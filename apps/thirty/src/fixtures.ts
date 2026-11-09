// The URLs that must work. Four generated cities (river, bay, archipelago, ridge), a bigger map, London and Lisbon.
// Fixtures 26 and 27 have station prices and snapped stops (S). Fixtures 28 to 30 have line shapes (L) and merges.
const A = 'seed=11&sea=0.1&rivers=3&hills=0.2';
const B = 'seed=22&sea=0.35&rivers=1&hills=0.3';
const C = 'seed=33&sea=0.55&warp=0.8&rivers=0';
const D = 'seed=44&sea=0.05&hills=0.9&rivers=2';
const S =
  'tram.station=2&tube.station=20&rer.station=15&express.station=25&snap=0.5';
const L = 'shapes=line:1,via:1,arc:1';

export const FIXTURES = [
  `${A}&algo=`,
  `${A}&algo=greedy&steps=30`,
  `${A}&algo=anneal&steps=200`,
  `${A}&algo=random&steps=30`,
  `${A}&algo=greedy&steps=30&run=2`,
  `${B}&algo=`,
  `${B}&algo=greedy&steps=30&N=30`,
  `${B}&algo=greedy&steps=30&N=45`,
  `${B}&algo=greedy:20,anneal:100`,
  `${B}&algo=greedy&steps=30&tiers=tram,tube`,
  `${C}&algo=`,
  `${C}&algo=greedy&steps=30`,
  `${C}&algo=greedy&steps=30&budget=200`,
  `${C}&algo=anneal&steps=200`,
  `${C}&algo=greedy&steps=30&tiers=rer,express`,
  `${D}&algo=`,
  `${D}&algo=greedy&steps=30`,
  `${D}&algo=greedy&steps=30&tube.headway=2`,
  `${D}&algo=random&steps=30&run=7`,
  `${D}&algo=greedy:20,anneal:100&N=60`,
  `${B}&size=256&algo=greedy&steps=30`,
  'city=london&algo=',
  'city=london&algo=greedy&steps=30',
  'city=lisbon&algo=',
  'city=lisbon&algo=greedy&steps=30',
  `city=london&algo=greedy&steps=30&${S}`,
  `${B}&algo=greedy&steps=30&${S}`,
  `city=london&algo=greedy&steps=30&${L}`,
  `${B}&algo=greedy&steps=30&${L}`,
  `city=london&algo=greedy:20,anneal:100&${L}&join=0.2`,
];

// Index pairs (0-based) that differ only in run, N, tiers, S or L. Their hashes must differ.
// The test for a pair runs in the file that holds the first index.
export const DIFFERENT = [
  [1, 4],
  [6, 7],
  [6, 9],
  [11, 14],
  [26, 6],
  [27, 22],
];

// Index (0-based) to hash. The defaults of the station prices, snap, shapes and join must not change these.
export const HASHES: Record<number, string> = {
  1: '14e1496d',
  2: '043d078a',
  6: '95c31409',
  13: '21317eb7',
  22: '3e5901ff',
};
