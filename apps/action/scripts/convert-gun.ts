// Where: apps/action/scripts/convert-gun.ts
// When: run it by hand after a change to the gun model in assets/rifle/.
//   bun apps/action/scripts/convert-gun.ts
// Why: the game embeds one small binary mesh (game/src/assets/rifle.bin). It
// does not parse OBJ at run time.
//
// The input is the Quaternius "Ultimate Gun Pack" AK (CC0, see
// assets/rifle/LICENSE.md). The output is a list of triangles in view-model
// space: the muzzle points to -Z, Y is up, and the units are metres.
//
// rifle.bin layout (little endian):
//   u32 vertex count
//   per vertex: f32 x3 position, f32 x3 normal, f32 x3 colour, f32 part
// part 0 is the body, part 1 is the magazine. The reload animation moves
// part 1 alone.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const here = dirname(new URL(import.meta.url).pathname);
const objPath = join(here, '../assets/rifle/AssaultRifle_1.obj');
const mtlPath = join(here, '../assets/rifle/AssaultRifle_1.mtl');
const outPath = join(here, '../game/src/assets/rifle.bin');

type V3 = [number, number, number];

const colours = new Map<string, V3>();
let current = '';
for (const line of readFileSync(mtlPath, 'utf8').split('\n')) {
  const p = line.trim().split(/\s+/);
  if (p[0] === 'newmtl') current = p[1];
  if (p[0] === 'Kd') colours.set(current, [+p[1], +p[2], +p[3]]);
}

const verts: V3[] = [];
const faces: { idx: number[]; mtl: string }[] = [];
let mtl = '';
for (const line of readFileSync(objPath, 'utf8').split('\n')) {
  const p = line.trim().split(/\s+/);
  if (p[0] === 'v') verts.push([+p[1], +p[2], +p[3]]);
  if (p[0] === 'usemtl') mtl = p[1];
  if (p[0] === 'f') {
    faces.push({
      idx: p.slice(1).map((s) => Number.parseInt(s.split('/')[0], 10) - 1),
      mtl,
    });
  }
}

// Connected parts: faces that share a vertex index are one part.
const parent = verts.map((_, i) => i);
const find = (i: number): number => {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
  }
  return i;
};
for (const f of faces) for (const i of f.idx) parent[find(i)] = find(f.idx[0]);

interface Part {
  min: V3;
  max: V3;
  faces: number;
  mtl: Set<string>;
}
const parts = new Map<number, Part>();
for (const f of faces) {
  const root = find(f.idx[0]);
  let part = parts.get(root);
  if (!part) {
    part = {
      min: [1e9, 1e9, 1e9],
      max: [-1e9, -1e9, -1e9],
      faces: 0,
      mtl: new Set(),
    };
    parts.set(root, part);
  }
  part.faces++;
  part.mtl.add(f.mtl);
  for (const i of f.idx) {
    for (let k = 0; k < 3; k++) {
      part.min[k] = Math.min(part.min[k], verts[i][k]);
      part.max[k] = Math.max(part.max[k], verts[i][k]);
    }
  }
}

const all = { min: [1e9, 1e9, 1e9] as V3, max: [-1e9, -1e9, -1e9] as V3 };
for (const p of parts.values()) {
  for (let k = 0; k < 3; k++) {
    all.min[k] = Math.min(all.min[k], p.min[k]);
    all.max[k] = Math.max(all.max[k], p.max[k]);
  }
}

// The magazine: the parts that hang below the receiver, in front of the
// pistol grip. MAG_X is the x range of the magazine in model units.
// `--list` prints the parts, to find these values for a new model.
const MAG_X: [number, number] = [0.8, 1.2];
const MAG_Y_MAX = 0;
const isMag = (p: Part): boolean =>
  p.min[0] >= MAG_X[0] && p.max[0] <= MAG_X[1] && p.min[1] < MAG_Y_MAX;

if (process.argv.includes('--list')) {
  console.log('bounds', all);
  for (const [root, p] of parts) {
    const f = (v: V3) => v.map((n) => n.toFixed(2)).join(',');
    console.log(root, p.faces, [...p.mtl].join('+'), f(p.min), f(p.max));
  }
  process.exit(0);
}

// Model space to view-model space: the model points to +X, so turn it to
// -Z, scale it to TARGET_LEN metres, and put the origin at the grip.
const TARGET_LEN = 0.82;
const scale = TARGET_LEN / (all.max[0] - all.min[0]);
const GRIP_X = 0.5;
const GRIP_Y = 0.35;
const toView = (v: V3): V3 => [
  v[2] * scale,
  (v[1] - GRIP_Y) * scale,
  -(v[0] - GRIP_X) * scale,
];

// Albedo for each MTL material. The MTL colours are flat and very dark, so
// the game uses its own gunmetal and walnut values.
const ALBEDO: Record<string, V3> = {
  Black: [0.025, 0.025, 0.028],
  DarkMetal: [0.06, 0.06, 0.065],
  Metal: [0.13, 0.13, 0.14],
  DarkWood: [0.3, 0.13, 0.05],
  Wood: [0.42, 0.21, 0.09],
};
const lift = (c: V3, name: string): V3 => ALBEDO[name] ?? c;

const out: number[] = [];
for (const f of faces) {
  const part = isMag(parts.get(find(f.idx[0])) as Part) ? 1 : 0;
  const col = lift(colours.get(f.mtl) ?? [0.5, 0.5, 0.5], f.mtl);
  const p = f.idx.map((i) => toView(verts[i]));
  for (let t = 1; t + 1 < p.length; t++) {
    const a = p[0];
    const b = p[t];
    const c = p[t + 1];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    // The x flip of toView mirrors the winding, so cross w x u.
    let n = [
      w[1] * u[2] - w[2] * u[1],
      w[2] * u[0] - w[0] * u[2],
      w[0] * u[1] - w[1] * u[0],
    ];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    n = n.map((x) => x / len);
    for (const v of [a, c, b]) out.push(...v, ...n, ...col, part);
  }
}

const count = out.length / 10;
const buf = Buffer.alloc(4 + out.length * 4);
buf.writeUInt32LE(count, 0);
out.forEach((x, i) => {
  buf.writeFloatLE(x, 4 + i * 4);
});
writeFileSync(outPath, buf);
const magVerts = out.filter((_, i) => i % 10 === 9 && out[i] === 1).length;
console.log(
  `rifle.bin: ${count} vertices, ${magVerts} in the magazine, scale ${scale.toFixed(4)}`,
);
