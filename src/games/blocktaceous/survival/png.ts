/**
 * A small PNG writer, so the inventory screen can show the item sprites the game paints in code.
 * A widget's CSS may only use pictures that are `data:` images, and the rules run where there is
 * no canvas, so the atlas is packed here: RGBA rows through a simple LZ77 with the fixed Huffman
 * codes (pixel art is mostly runs and repeats, which is all this needs to find).
 */

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array, from: number, to: number): number {
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Deflate's length and distance codes: the base value of each, and its extra bits. */
const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

/** A zlib stream of `data`: one block of fixed Huffman codes, matches found through a hash of three bytes. */
export function deflate(data: Uint8Array): Uint8Array {
  const out: number[] = [0x78, 0x01];
  let acc = 0;
  let bits = 0;
  const put = (value: number, n: number) => {
    acc |= value << bits;
    bits += n;
    while (bits >= 8) {
      out.push(acc & 255);
      acc >>>= 8;
      bits -= 8;
    }
  };
  // Huffman codes go out most significant bit first.
  const code = (value: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) put((value >> i) & 1, 1);
  };
  const literal = (v: number) => {
    if (v < 144) code(0x30 + v, 8);
    else if (v < 256) code(0x190 + v - 144, 9);
    else if (v < 280) code(v - 256, 7);
    else code(0xc0 + v - 280, 8);
  };
  put(1, 1); // The last block.
  put(1, 2); // Fixed codes.
  const heads = new Int32Array(1 << 15).fill(-1);
  const prev = new Int32Array(data.length).fill(-1);
  const hash = (i: number) => ((data[i] << 10) ^ (data[i + 1] << 5) ^ data[i + 2]) & 0x7fff;
  const insert = (i: number) => {
    if (i + 2 >= data.length) return;
    const h = hash(i);
    prev[i] = heads[h];
    heads[h] = i;
  };
  let i = 0;
  while (i < data.length) {
    let best = 0;
    let dist = 0;
    if (i + 2 < data.length) {
      let at = heads[hash(i)];
      for (let tries = 0; at >= 0 && i - at <= 32768 && tries < 24; tries++, at = prev[at]) {
        let n = 0;
        while (n < 258 && i + n < data.length && data[at + n] === data[i + n]) n++;
        if (n > best) {
          best = n;
          dist = i - at;
          if (n === 258) break;
        }
      }
    }
    if (best >= 3) {
      let l = LEN_BASE.length - 1;
      while (LEN_BASE[l] > best) l--;
      literal(257 + l);
      if (LEN_EXTRA[l]) put(best - LEN_BASE[l], LEN_EXTRA[l]);
      let d = DIST_BASE.length - 1;
      while (DIST_BASE[d] > dist) d--;
      code(d, 5);
      if (DIST_EXTRA[d]) put(dist - DIST_BASE[d], DIST_EXTRA[d]);
      for (let k = 0; k < best; k++) insert(i + k);
      i += best;
    } else {
      literal(data[i]);
      insert(i);
      i++;
    }
  }
  literal(256);
  if (bits > 0) put(0, 8 - bits);
  let a = 1;
  let b = 0;
  for (let k = 0; k < data.length; k++) {
    a = (a + data[k]) % 65521;
    b = (b + a) % 65521;
  }
  out.push(b >>> 8, b & 255, a >>> 8, a & 255);
  return Uint8Array.from(out);
}

/** A PNG file of `width` x `height` RGBA pixels (row 0 at the top). */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    // Each row starts with its filter: none.
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const body = deflate(raw);
  const chunks: Uint8Array[] = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  const chunk = (type: string, data: Uint8Array) => {
    const c = new Uint8Array(12 + data.length);
    const view = new DataView(c.buffer);
    view.setUint32(0, data.length);
    for (let k = 0; k < 4; k++) c[4 + k] = type.charCodeAt(k);
    c.set(data, 8);
    view.setUint32(8 + data.length, crc32(c, 4, 8 + data.length));
    chunks.push(c);
  };
  const head = new Uint8Array(13);
  const hv = new DataView(head.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  head.set([8, 6, 0, 0, 0], 8);
  chunk('IHDR', head);
  chunk('IDAT', body);
  chunk('IEND', new Uint8Array(0));
  const file = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    file.set(c, at);
    at += c.length;
  }
  return file;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    s += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return s;
}

/** A `data:` URL of a PNG, as a widget's CSS can use it. */
export function pngDataUrl(width: number, height: number, rgba: Uint8Array): string {
  return `data:image/png;base64,${base64(encodePng(width, height, rgba))}`;
}
