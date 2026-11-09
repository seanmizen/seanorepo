import type { City } from './gen.ts';
import { INF, type Prep, tenths, total } from './graph.ts';
import type { Params } from './params.ts';

// For each cell of each network: the times and G of evaluate(), as the same integers.
// off: cell k has entries off[k] to off[k + 1]. ent: (D index of sample 0, walk time). u: cells, N.
// S is a constant. The samples go in blocks of 32, so the times of one block fit in registers for any S.
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
  var g = 0u;
  for (var j0 = 0u; j0 < S; j0 += 32u) {
    let m = min(32u, S - j0);
    var t: array<u32, 32>;
    for (var j = 0u; j < m; j++) { t[j] = ${INF}u; }
    for (var e = off[k]; e < off[k + 1u]; e++) {
      let x = ent[e];
      for (var j = 0u; j < m; j++) { t[j] = min(t[j], x.y + D[x.x + j0 + j]); }
    }
    for (var j = 0u; j < m; j++) {
      if (t[j] < 2u * n) { g += min(n, 2u * n - t[j]); }
    }
  }
  G[k] = g;
}`;

// The largest buffer of one prep, in bytes.
const size = (x: Prep) => Math.max(x.D.byteLength, x.ent.byteLength);

// A scorer that gives J for a batch of prepared networks. It splits the batch so that each buffer fits.
// If t is given, it adds the ms of each part to t: upload, dispatch, read.
// Null if the browser has no WebGPU adapter.
export async function gpu(city: City, p: Params, S: number) {
  const N = tenths(p.N);
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) return null;
  const { maxStorageBufferBindingSize, maxBufferSize } = adapter.limits;
  const max = Math.min(maxStorageBufferBindingSize, maxBufferSize);
  const dev = await adapter.requestDevice({
    requiredLimits: { maxStorageBufferBindingSize, maxBufferSize },
  });
  const pipe = dev.createComputePipeline({
    layout: 'auto',
    compute: {
      module: dev.createShaderModule({ code: `const S = ${S}u;${WGSL}` }),
    },
  });
  const one = async (ps: Prep[], t?: Record<string, number>) => {
    let last = performance.now();
    const mark = async (k: string) => {
      if (!t) return;
      await dev.queue.onSubmittedWorkDone();
      const now = performance.now();
      t[k] = (t[k] ?? 0) + now - last;
      last = now;
    };
    // One buffer of each kind for the batch. An entry points into the D of its own network.
    // The batch is written into the buffers while they are mapped, so there is no second copy.
    let [nc, ne, nd] = [0, 0, 0];
    for (const x of ps) {
      nc += x.cells.length;
      ne += x.ent.length;
      nd += x.D.length;
    }
    const { STORAGE, UNIFORM, COPY_DST, COPY_SRC, MAP_READ } = GPUBufferUsage;
    const buf = (usage: number, n: number, mapped = false) =>
      dev.createBuffer({
        size: Math.max(16, 4 * n),
        usage,
        mappedAtCreation: mapped,
      });
    const bufs = [nc + 1, ne, nd].map((n) => buf(STORAGE, n, true));
    const [off, ent, D] = bufs.map((b) => new Uint32Array(b.getMappedRange()));
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
    for (const b of bufs) b.unmap();
    bufs.push(buf(STORAGE | COPY_SRC, nc), buf(UNIFORM | COPY_DST, 4));
    dev.queue.writeBuffer(bufs[4], 0, new Uint32Array([nc, N, 0, 0]));
    const read = buf(MAP_READ | COPY_DST, nc);
    await mark('upload');
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
    dev.queue.submit([enc.finish()]);
    await mark('dispatch');
    const copy = dev.createCommandEncoder();
    copy.copyBufferToBuffer(bufs[3], 0, read, 0, 4 * nc);
    dev.queue.submit([copy.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const G = new Uint32Array(read.getMappedRange().slice(0, 4 * nc));
    for (const b of [...bufs, read]) b.destroy();
    let c = 0;
    const J = ps.map((x) => {
      c += x.cells.length;
      return total(city, x.cells, G.subarray(c - x.cells.length, c), S, N);
    });
    await mark('read');
    return J;
  };
  return async (ps: Prep[], t?: Record<string, number>) => {
    const J: number[] = [];
    for (let a = 0; a < ps.length; ) {
      if (size(ps[a]) > max)
        throw new Error('A network is too large for the GPU buffers.');
      let b = a;
      for (let s = 0; b < ps.length && s + size(ps[b]) <= max; b++)
        s += size(ps[b]);
      J.push(...(await one(ps.slice(a, b), t)));
      a = b;
    }
    return J;
  };
}
