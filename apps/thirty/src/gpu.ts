import type { City } from './gen.ts';
import { INF, type Prep, tenths, total } from './graph.ts';
import type { Params } from './params.ts';

// For each cell of each network: the times and G of evaluate(), as the same integers.
// off: cell k has entries off[k] to off[k + 1]. ent: (D index of sample 0, walk time). u: cells, N.
// SAMPLES is S, so the times of one cell fit in an array.
const WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read> off: array<u32>;
@group(0) @binding(1) var<storage, read> ent: array<vec2<u32>>;
@group(0) @binding(2) var<storage, read> D: array<u32>;
@group(0) @binding(3) var<storage, read_write> G: array<u32>;
@group(0) @binding(4) var<uniform> u: vec4<u32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let k = id.x + id.y * nw.x * 64u;
  if (k >= u.x) { return; }
  let n = u.y;
  var t: array<u32, SAMPLES>;
  for (var j = 0u; j < SAMPLES; j++) { t[j] = ${INF}u; }
  for (var e = off[k]; e < off[k + 1u]; e++) {
    let x = ent[e];
    for (var j = 0u; j < SAMPLES; j++) { t[j] = min(t[j], x.y + D[x.x + j]); }
  }
  var g = 0u;
  for (var j = 0u; j < SAMPLES; j++) {
    if (t[j] < 2u * n) { g += min(n, 2u * n - t[j]); }
  }
  G[k] = g;
}`;

// A scorer that gives J for a batch of prepared networks in one dispatch.
// Null if the browser has no WebGPU adapter.
export async function gpu(city: City, p: Params, S: number) {
  const N = tenths(p.N);
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) return null;
  const { maxStorageBufferBindingSize, maxBufferSize } = adapter.limits;
  const dev = await adapter.requestDevice({
    requiredLimits: { maxStorageBufferBindingSize, maxBufferSize },
  });
  const pipe = dev.createComputePipeline({
    layout: 'auto',
    compute: {
      module: dev.createShaderModule({
        code: WGSL.replaceAll('SAMPLES', `${S}u`),
      }),
    },
  });
  return async (ps: Prep[]) => {
    if (!ps.length) return [];
    // One array of each kind for the batch. An entry points into the D of its own network.
    let [nc, ne, nd] = [0, 0, 0];
    for (const x of ps) {
      nc += x.cells.length;
      ne += x.ent.length;
      nd += x.D.length;
    }
    const off = new Uint32Array(nc + 1);
    const ent = new Uint32Array(ne);
    const D = new Uint32Array(nd);
    [nc, ne, nd] = [0, 0, 0];
    for (const x of ps) {
      for (let k = 1; k <= x.cells.length; k++) off[nc + k] = ne / 2 + x.off[k];
      for (let k = 0; k < x.ent.length; k += 2) {
        ent[ne + k] = nd + x.ent[k];
        ent[ne + k + 1] = x.ent[k + 1];
      }
      D.set(x.D, nd);
      nc += x.cells.length;
      ne += x.ent.length;
      nd += x.D.length;
    }
    const buf = (usage: number, data: Uint32Array<ArrayBuffer> | number) => {
      const size = typeof data === 'number' ? data : data.byteLength;
      const b = dev.createBuffer({ size: Math.max(16, size), usage });
      if (typeof data !== 'number') dev.queue.writeBuffer(b, 0, data);
      return b;
    };
    const { STORAGE, UNIFORM, COPY_DST, COPY_SRC, MAP_READ } = GPUBufferUsage;
    const bufs = [
      buf(STORAGE | COPY_DST, off),
      buf(STORAGE | COPY_DST, ent),
      buf(STORAGE | COPY_DST, D),
      buf(STORAGE | COPY_SRC, 4 * nc),
      buf(UNIFORM | COPY_DST, new Uint32Array([nc, N, 0, 0])),
    ];
    const read = buf(MAP_READ | COPY_DST, 4 * nc);
    const enc = dev.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipe);
    pass.setBindGroup(
      0,
      dev.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: bufs.map((buffer, binding) => ({
          binding,
          resource: { buffer },
        })),
      }),
    );
    // At most 65535 workgroups on each axis.
    const groups = Math.ceil(nc / 64);
    const x = Math.min(groups, 65535);
    pass.dispatchWorkgroups(x, Math.ceil(groups / x));
    pass.end();
    enc.copyBufferToBuffer(bufs[3], 0, read, 0, 4 * nc);
    dev.queue.submit([enc.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const G = new Uint32Array(read.getMappedRange().slice(0, 4 * nc));
    for (const b of [...bufs, read]) b.destroy();
    let c = 0;
    return ps.map((x) => {
      c += x.cells.length;
      return total(city, x.cells, G.subarray(c - x.cells.length, c), S, N);
    });
  };
}
