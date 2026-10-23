// Where: apps/action/scripts/convert-gun.ts
// When: run it by hand after a change to the gun list or to the conversion.
//   bun apps/action/scripts/convert-gun.ts <pack>/OBJ              write guns.bin
//   bun apps/action/scripts/convert-gun.ts <pack>/OBJ --list Bullpup_1
//                                           print the parts of one model
//   <pack> is the "Ultimate Gun Pack - July 2019" folder of the download
//   (assets/guns/LICENSE.md has the link). The repository keeps only the
//   output, not the source models.
// Why: the game embeds one small binary file of all the weapon models
// (game/src/assets/guns.bin). It does not parse OBJ at run time.
//
// The models: every gun of the Quaternius "Ultimate Gun Pack" (CC0) except
// the sniper rifles (they have scopes, and the game is hipfire only), and
// the Bayonet_2 accessory as the knife. No gun outside the sniper rifles has
// a scope, so nothing is cut off.
//
// View-model space: the muzzle points to -Z, Y is up, the units are metres,
// and the origin is the grip point. Each pack model has the same frame (the
// grip near the origin, the muzzle to +X), so one scale and one grip point
// suit every gun. The knife has its own.
//
// guns.bin layout (little endian):
//   "GUN1"
//   u16 palette count P, u16 model count M
//   P x f32[3]      albedo of each material
//   M x model header:
//     u8[20]        the source name, zero padded ("AssaultRifle_1")
//     u16 V, u16 F, u16 R, u16 T   vertices, faces, runs, triangles
//     u8 has_mag, u8 0
//     f32[3] muzzle, f32 sight (the top of the sights, the y of the aim
//       line), f32[3] magazine pivot (its top front corner)
//   then for each model in order:
//     V x i16[3]    position * 8192
//     F x (u8 n, n x u16)  each face: its corners. The loader makes a fan
//                   (p0, pk, pk+1) of each face, with the normal
//                   normalize(cross(pk - p0, pk+1 - p0)).
//     R x (u16 count, u8 material, u8 part): runs of faces in order.
//                   Part 0 is the body, part 1 the magazine (the reload
//                   animation moves it).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const here = dirname(new URL(import.meta.url).pathname);
const outPath = join(here, '../game/src/assets/guns.bin');

const args = process.argv.slice(2);
const objDir = args.find((a) => !a.startsWith('--'));
if (!objDir) {
  console.error(
    'usage: bun convert-gun.ts <Ultimate Gun Pack - July 2019/OBJ> [--list <model>]',
  );
  process.exit(1);
}

// The models in their game order. The index is the model id of the
// network messages, so add new models at the end. game/src/weapon.zig finds
// the class of each model from its name.
const MODELS = [
  'AssaultRifle_1',
  'AssaultRifle_2',
  'AssaultRifle_3',
  'AssaultRifle_4',
  'AssaultRifle_5',
  'AssaultRifle2_1',
  'AssaultRifle2_2',
  'AssaultRifle2_3',
  'AssaultRifle2_4',
  'Bullpup_1',
  'Bullpup_2',
  'Bullpup_3',
  'SubmachineGun_1',
  'SubmachineGun_2',
  'SubmachineGun_3',
  'SubmachineGun_4',
  'SubmachineGun_5',
  'Shotgun_1',
  'Shotgun_2',
  'Shotgun_3',
  'Shotgun_4',
  'Shotgun_ShortStock',
  'Shotgun_SawedOff',
  'Pistol_1',
  'Pistol_2',
  'Pistol_3',
  'Pistol_4',
  'Pistol_5',
  'Pistol_6',
  'Revolver_1',
  'Revolver_2',
  'Revolver_3',
  'Revolver_4',
  'Revolver_5',
  'Accessories/Bayonet_2',
];

// Albedo for each MTL material. The MTL colours are flat and very dark, so
// the game uses its own values. The index is the material id in guns.bin.
type V3 = [number, number, number];
const PALETTE: [string, V3][] = [
  ['Black', [0.025, 0.025, 0.028]],
  ['Black2', [0.018, 0.018, 0.02]],
  ['DarkMetal', [0.06, 0.06, 0.065]],
  ['Metal', [0.13, 0.13, 0.14]],
  ['LightMetal', [0.23, 0.23, 0.25]],
  ['LightMetal2', [0.42, 0.43, 0.46]],
  ['Grey', [0.09, 0.093, 0.1]],
  ['DarkWood', [0.3, 0.13, 0.05]],
  ['Wood', [0.42, 0.21, 0.09]],
  ['Main', [0.04, 0.05, 0.06]],
  ['MainDark', [0.024, 0.034, 0.05]],
  ['MainLight', [0.06, 0.072, 0.085]],
  ['Green', [0.19, 0.22, 0.16]],
];
const materialId = new Map(PALETTE.map(([name], i) => [name, i]));

// Model space to view-model space.
const GUN_SCALE = 0.18;
const GRIP: [number, number] = [0.5, 0.35];
const KNIFE_SCALE = 0.26;
const KNIFE_GRIP: [number, number] = [0.0, -0.02];

interface Face {
  idx: number[];
  mtl: string;
}
interface Part {
  min: V3;
  max: V3;
  faces: number;
}

function load(name: string) {
  const verts: V3[] = [];
  const faces: Face[] = [];
  let mtl = '';
  const text = readFileSync(join(objDir as string, `${name}.obj`), 'utf8');
  for (const line of text.split('\n')) {
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
    let r = i;
    while (parent[r] !== r) {
      parent[r] = parent[parent[r]];
      r = parent[r];
    }
    return r;
  };
  for (const f of faces)
    for (const i of f.idx) parent[find(i)] = find(f.idx[0]);
  const parts = new Map<number, Part>();
  for (const f of faces) {
    const root = find(f.idx[0]);
    let part = parts.get(root);
    if (!part) {
      part = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9], faces: 0 };
      parts.set(root, part);
    }
    part.faces++;
    for (const i of f.idx) {
      for (let k = 0; k < 3; k++) {
        part.min[k] = Math.min(part.min[k], verts[i][k]);
        part.max[k] = Math.max(part.max[k], verts[i][k]);
      }
    }
  }
  return { verts, faces, parts, find };
}

// The magazine: a tall part that hangs well below the receiver, in front
// of the pistol grip (or behind it, on a bullpup), and not as far out as a
// front grip. Then each part inside its box (a base plate) joins it.
function findMagazine(parts: Map<number, Part>): Set<number> {
  const mag = new Set<number>();
  let best: [number, Part] | null = null;
  for (const [root, p] of parts) {
    const cx = (p.min[0] + p.max[0]) / 2;
    const tall = p.max[1] - p.min[1] > 0.3;
    const narrow = p.max[0] - p.min[0] < 1.0;
    const zone = (cx > 0.35 && cx < 1.35) || (cx > -1.4 && cx < -0.3);
    if (p.min[1] < -0.25 && tall && narrow && zone) {
      if (
        !best ||
        Math.abs(cx) < Math.abs((best[1].min[0] + best[1].max[0]) / 2)
      )
        best = [root, p];
    }
  }
  if (!best) return mag;
  const box = best[1];
  for (const [root, p] of parts) {
    const inside = [0, 1, 2].every(
      (k) => p.min[k] >= box.min[k] - 0.02 && p.max[k] <= box.max[k] + 0.02,
    );
    if (inside) mag.add(root);
  }
  return mag;
}

const hasMagazine = (name: string): boolean =>
  /^(AssaultRifle|Bullpup|SubmachineGun)/.test(name);

if (args.includes('--list')) {
  const name = args[args.indexOf('--list') + 1];
  const { parts } = load(name);
  const mag = hasMagazine(name) ? findMagazine(parts) : new Set<number>();
  const f = (v: V3) => v.map((n) => n.toFixed(2)).join(',');
  for (const [root, p] of parts) {
    console.log(root, p.faces, f(p.min), f(p.max), mag.has(root) ? 'MAG' : '');
  }
  process.exit(0);
}

interface Out {
  name: string;
  verts: number[]; // i16 triples
  polys: number[][];
  runs: [number, number, number][]; // count, material, part
  hasMag: boolean;
  muzzle: V3;
  sight: number;
  pivot: V3;
}

const Q = 8192;
const outs: Out[] = [];
for (const name of MODELS) {
  const knife = name.includes('Bayonet');
  const scale = knife ? KNIFE_SCALE : GUN_SCALE;
  const grip = knife ? KNIFE_GRIP : GRIP;
  const toView = (v: V3): V3 => [
    v[2] * scale,
    (v[1] - grip[1]) * scale,
    -(v[0] - grip[0]) * scale,
  ];
  const { verts, faces, parts, find } = load(name);
  const mag = hasMagazine(name) ? findMagazine(parts) : new Set<number>();
  if (hasMagazine(name) && mag.size === 0)
    console.warn(`${name}: no magazine found`);

  // The used vertices, in view space, quantised.
  const remap = new Map<number, number>();
  const qverts: number[] = [];
  const vid = (i: number): number => {
    let r = remap.get(i);
    if (r === undefined) {
      r = remap.size;
      remap.set(i, r);
      for (const c of toView(verts[i])) qverts.push(Math.round(c * Q));
    }
    return r;
  };
  // Each face as a polygon, in reverse order: the x flip of toView mirrors
  // the winding. The loader makes a fan of each polygon.
  const polys: { idx: number[]; mat: number; part: number }[] = [];
  for (const f of faces) {
    const mat = materialId.get(f.mtl);
    if (mat === undefined) throw new Error(`${name}: material ${f.mtl}`);
    const part = mag.has(find(f.idx[0])) ? 1 : 0;
    const idx = [f.idx[0], ...f.idx.slice(1).reverse()].map(vid);
    polys.push({ idx, mat, part });
  }
  polys.sort((x, y) => x.part - y.part || x.mat - y.mat);
  const runs: [number, number, number][] = [];
  for (const t of polys) {
    const last = runs[runs.length - 1];
    if (last && last[1] === t.mat && last[2] === t.part) last[0]++;
    else runs.push([1, t.mat, t.part]);
  }

  // The muzzle: the front end of the barrel. The sight: the top of the gun
  // in front of the grip.
  let maxX = -1e9;
  for (const v of verts) maxX = Math.max(maxX, v[0]);
  let ySum = 0;
  let yN = 0;
  let top = -1e9;
  for (const v of verts) {
    if (v[0] > maxX - 0.03) {
      ySum += v[1];
      yN++;
    }
    if (v[0] > grip[0]) top = Math.max(top, v[1]);
  }
  const muzzle = toView([maxX, ySum / yN, 0]);
  let pivot: V3 = [0, 0, 0];
  if (mag.size > 0) {
    const mn: V3 = [1e9, 1e9, 1e9];
    const mx: V3 = [-1e9, -1e9, -1e9];
    for (const r of mag) {
      const p = parts.get(r) as Part;
      for (let k = 0; k < 3; k++) {
        mn[k] = Math.min(mn[k], p.min[k]);
        mx[k] = Math.max(mx[k], p.max[k]);
      }
    }
    pivot = toView([mx[0], mx[1], 0]);
  }
  outs.push({
    name: name.split('/').pop() as string,
    verts: qverts,
    polys: polys.map((t) => t.idx),
    runs,
    hasMag: mag.size > 0,
    muzzle,
    sight: (top - grip[1]) * scale,
    pivot,
  });
  if (remap.size > 65535) throw new Error(`${name}: too many vertices`);
}

const HEADER = 20 + 8 + 2 + 4 * 7;
const triangles = (o: Out): number =>
  o.polys.reduce((n, p) => n + p.length - 2, 0);
let size = 8 + PALETTE.length * 12 + outs.length * HEADER;
for (const o of outs) {
  size += o.verts.length * 2 + o.runs.length * 4;
  for (const p of o.polys) size += 1 + p.length * 2;
}
const buf = Buffer.alloc(size);
let at = 0;
buf.write('GUN1', at, 'latin1');
at += 4;
at = buf.writeUInt16LE(PALETTE.length, at);
at = buf.writeUInt16LE(outs.length, at);
for (const [, c] of PALETTE) for (const x of c) at = buf.writeFloatLE(x, at);
for (const o of outs) {
  buf.write(o.name.padEnd(20, '\0').slice(0, 20), at, 'latin1');
  at += 20;
  at = buf.writeUInt16LE(o.verts.length / 3, at);
  at = buf.writeUInt16LE(o.polys.length, at);
  at = buf.writeUInt16LE(o.runs.length, at);
  at = buf.writeUInt16LE(triangles(o), at);
  at = buf.writeUInt8(o.hasMag ? 1 : 0, at);
  at = buf.writeUInt8(0, at);
  for (const x of [...o.muzzle, o.sight, ...o.pivot])
    at = buf.writeFloatLE(x, at);
}
for (const o of outs) {
  for (const x of o.verts) at = buf.writeInt16LE(x, at);
  for (const p of o.polys) {
    at = buf.writeUInt8(p.length, at);
    for (const x of p) at = buf.writeUInt16LE(x, at);
  }
  for (const [n, mat, part] of o.runs) {
    at = buf.writeUInt16LE(n, at);
    at = buf.writeUInt8(mat, at);
    at = buf.writeUInt8(part, at);
  }
}
if (at !== size) throw new Error(`size ${at} != ${size}`);
writeFileSync(outPath, buf);
for (const o of outs) {
  console.log(
    o.name.padEnd(20),
    `${o.verts.length / 3} verts, ${o.polys.length} faces, ${triangles(o)} tris`,
    o.hasMag ? 'magazine' : '',
  );
}
console.log(`guns.bin: ${outs.length} models, ${size} bytes`);
