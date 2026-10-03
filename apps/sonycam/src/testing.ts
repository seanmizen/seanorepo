// One live view packet as the camera sends it.
export const packet = (type: number, payload: Uint8Array, padding = 0) => {
  const out = new Uint8Array(8 + 128 + payload.length + padding);
  out.set([0xff, type, 0, 1, 0, 0, 0, 0], 0);
  out.set([0x24, 0x35, 0x68, 0x79], 8);
  out[12] = (payload.length >> 16) & 0xff;
  out[13] = (payload.length >> 8) & 0xff;
  out[14] = payload.length & 0xff;
  out[15] = padding;
  out.set(payload, 136);
  return out;
};
