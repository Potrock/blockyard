import { HEX, HEX_ROW, HEX_W, SEA_Y } from '../geometry';
import { landmark } from '../landmarks';
import { roundCube } from '../rules/hex';
import { NATURAL_WONDERS } from '../rules/nature';
import { shared } from '../shared';
import { TOP } from '../terrain';

/**
 * A natural wonder's picture (the Civilopedia's, the moment it's found): its landmark's own blocks
 * (`landmarks.ts`) on its hex of ground, drawn the way the units' and wonders' pictures are
 * (`tools/pictures.mjs`): an isometric view from the south, a little east and above, each block's
 * visible faces in its colours and lit from above (glowing ones lit by themselves), water and mist
 * see-through, drawn large, shrunk smooth and outlined. Made once for each wonder and kept.
 */

type Texture = NonNullable<NonNullable<typeof shared.blocks>[string]['texture']>;
type Face = 'top' | 'side';

/** What the landmarks use of the platform's own blocks. */
const BUILT_IN: Record<string, string> = { water: '#3f86d0' };
/** Blocks seen through (and how much of what's behind shows). */
const SEE_THROUGH: Record<string, number> = { water: 0.45, civ_mist: 0.5, civ_cloud: 0.3, civ_falls: 0.2 };
/** How bright each face is: the top in the light, the front (south) and the side (east) shaded. */
const SHADE = { top: 1, front: 0.82, side: 0.64 };
/** The view: toward the landmark from the south, a little east and above. */
const VIEW = [0.55, 0.9, 1];
const SS = 3;

const hexRGB = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** The part of its cell a block fills (a shape of boxes: their bounds), as fractions: x0, y0, z0, x1, y1, z1. */
const extentOf = (block: string): number[] => {
  const boxes = shared.blocks?.[block]?.boxes;
  if (!boxes?.length) return [0, 0, 0, 1, 1, 1];
  return [0, 1, 2, 3, 4, 5].map((i) => (i < 3 ? Math.min(...boxes.map((b) => b[i])) : Math.max(...boxes.map((b) => b[i]))) / 16);
};

/** A block's colours on a face (a mottled texture's, a painted one's sampled), its tint and glow. */
const colours = new Map<string, { list: [number, number, number][]; glow: number }>();
function colourOf(block: string, face: Face) {
  const key = `${block}|${face}`;
  const known = colours.get(key);
  if (known) return known;
  const def = shared.blocks?.[block];
  const tex = def?.texture;
  const faces = tex && typeof tex === 'object' && ('top' in tex || 'side' in tex || 'all' in tex) ? (tex as Record<string, Texture | undefined>) : null;
  const t = faces ? (faces[face] ?? faces.all ?? faces.side) : (tex as Texture | undefined);
  let list: string[] = [];
  if (!t || typeof t === 'string') list = [BUILT_IN[block] ?? '#888888'];
  else if ('color' in t) list = Array.isArray(t.color) ? t.color : [t.color];
  else if ('paint' in t) for (let y = 0; y < 16; y += 2) for (let x = 0; x < 16; x += 2) list.push(t.paint(x, y) ?? '');
  list = list.filter(Boolean);
  const tint = def?.tint && def.tint !== 'grass' ? hexRGB(def.tint) : null;
  const out = { list: (list.length ? list : ['#888888']).map((c) => hexRGB(c).map((v, i) => (tint ? (v * tint[i]) / 255 : v)) as [number, number, number]), glow: def?.glow ?? (def?.light ?? 0) / 15 };
  colours.set(key, out);
  return out;
}

/** A landmark's picture's pixels (RGBA, `size` square). */
export function landmarkPixels(id: string, size: number): Uint8ClampedArray<ArrayBuffer> {
  const w = NATURAL_WONDERS[id];
  // Its blocks round a tile's middle, on its own hex (and, for a pair, the next one to the south-east).
  const main = { cx: 0.5, cz: 0.5 };
  const pair = w?.pair ? { cx: main.cx + HEX_W / 2, cz: main.cz + HEX_ROW } : undefined;
  const inHex = (x: number, z: number, m: { cx: number; cz: number }) => {
    const px = x + 0.5 - m.cx;
    const pz = z + 0.5 - m.cz;
    const q = ((Math.sqrt(3) / 3) * px - pz / 3) / HEX;
    const r = ((2 / 3) * pz) / HEX;
    const [rq, rr] = roundCube(q, r, -q - r);
    return rq === 0 && rr === 0;
  };
  const own = (x: number, z: number) => inHex(x, z, main) || (!!pair && inHex(x, z, pair));
  const cells = new Map<string, { i: number; j: number; k: number; block: string }>();
  const place = (i: number, j: number, k: number, block: string) => cells.set(`${i},${j},${k}`, { i, j, k, block });
  landmark(id, { ...main, pair, cap: TOP[w?.site.terrain[0] ?? 'grassland'] ?? 'civ_grass', own, sea: (x, z) => !own(x, z) }, (x, y, z, block) => place(x, y, z, block));
  // At sea, the water over its floor.
  for (const [m, at] of [[main, w?.site.terrain], [pair, w?.pair?.terrain]] as const)
    if (m && at?.includes('coast')) for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) if (inHex(x, z, m) && !cells.has(`${x},${SEA_Y},${z}`)) place(x, SEA_Y, z, 'water');
  return draw([...cells.values()], size, (i, j, k) => cells.get(`${i},${j},${k}`)?.block);
}

/** Blocks drawn back to front as an isometric picture (`tools/pictures.mjs`'s way). */
function draw(cells: { i: number; j: number; k: number; block: string }[], size: number, at: (i: number, j: number, k: number) => string | undefined): Uint8ClampedArray<ArrayBuffer> {
  const W = size * SS;
  const vl = Math.hypot(VIEW[0], VIEW[1], VIEW[2]);
  const v = VIEW.map((c) => c / vl);
  const rl = Math.hypot(v[2], v[0]);
  const r = [v[2] / rl, 0, -v[0] / rl];
  const up = [v[1] * r[2] - v[2] * r[1], v[2] * r[0] - v[0] * r[2], v[0] * r[1] - v[1] * r[0]];
  const project = (x: number, y: number, z: number) => [x * r[0] + z * r[2], -(x * up[0] + y * up[1] + z * up[2])];
  let lo = [Infinity, Infinity];
  let hi = [-Infinity, -Infinity];
  for (const { i, j, k } of cells)
    for (const [dx, dy, dz] of [[0, 0, 0], [1, 1, 0], [0, 1, 1], [1, 0, 1], [1, 1, 1], [0, 0, 1], [1, 0, 0], [0, 1, 0]]) {
      const [px, py] = project(i + dx, j + dy, k + dz);
      lo = [Math.min(lo[0], px), Math.min(lo[1], py)];
      hi = [Math.max(hi[0], px), Math.max(hi[1], py)];
    }
  const span = Math.max(hi[0] - lo[0], hi[1] - lo[1]);
  const u = (W * 0.92) / span;
  const ox = (W - (hi[0] - lo[0]) * u) / 2 - lo[0] * u;
  const oy = (W - (hi[1] - lo[1]) * u) / 2 - lo[1] * u;
  const pt = (x: number, y: number, z: number) => {
    const [px, py] = project(x, y, z);
    return [ox + px * u, oy + py * u];
  };
  const px = new Float32Array(W * W * 4);
  // A face is hidden by a whole solid block in front of it (not by water, mist or a shape of boxes).
  const covers = (i: number, j: number, k: number) => {
    const b = at(i, j, k);
    return !!b && !(b in SEE_THROUGH) && !shared.blocks?.[b]?.boxes;
  };
  const depth = (c: { i: number; j: number; k: number }) => c.i * v[0] + c.j * v[1] + c.k * v[2];
  cells.sort((a, b) => depth(a) - depth(b));
  for (const { i, j, k, block } of cells) {
    const alpha = 1 - (SEE_THROUGH[block] ?? 0);
    const paint = (face: Face, shade: number, corners: number[][]) => {
      const c = colourOf(block, face);
      const rgb = c.list[((Math.imul(i + 31, 73856093) ^ Math.imul(j + 7, 19349663) ^ Math.imul(k + 3, 83492791)) >>> 0) % c.list.length];
      const lit = shade + (1 - shade) * c.glow;
      quad(px, W, corners, [rgb[0] * lit, rgb[1] * lit, rgb[2] * lit], alpha);
    };
    const [x0, y0, z0, x1, y1, z1] = extentOf(block).map((f, n) => f + [i, j, k][n % 3]);
    if (!covers(i, j + 1, k) && at(i, j + 1, k) !== block) paint('top', SHADE.top, [pt(x0, y1, z0), pt(x1, y1, z0), pt(x1, y1, z1), pt(x0, y1, z1)]);
    if (!covers(i, j, k + 1) && at(i, j, k + 1) !== block) paint('side', SHADE.front, [pt(x0, y0, z1), pt(x1, y0, z1), pt(x1, y1, z1), pt(x0, y1, z1)]);
    if (!covers(i + 1, j, k) && at(i + 1, j, k) !== block) paint('side', SHADE.side, [pt(x1, y0, z0), pt(x1, y1, z0), pt(x1, y1, z1), pt(x1, y0, z1)]);
  }
  return outline(shrink(px, W, size), size);
}

/** Fill a convex quad (picture corners) with a colour, over what's there by `alpha`. */
function quad(px: Float32Array, W: number, pts: number[][], rgb: number[], alpha: number) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(W - 1, Math.ceil(Math.max(...ys)));
  let area = 0;
  for (let n = 0; n < 4; n++) area += pts[n][0] * pts[(n + 1) % 4][1] - pts[(n + 1) % 4][0] * pts[n][1];
  const sign = area >= 0 ? 1 : -1;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      let inside = true;
      for (let n = 0; n < 4 && inside; n++) {
        const [ax, ay] = pts[n];
        const [bx, by] = pts[(n + 1) % 4];
        if (((bx - ax) * (y + 0.5 - ay) - (by - ay) * (x + 0.5 - ax)) * sign < -1e-6) inside = false;
      }
      if (!inside) continue;
      const o = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) px[o + c] = px[o + 3] ? rgb[c] * alpha + px[o + c] * (1 - alpha) : rgb[c];
      px[o + 3] = Math.max(px[o + 3], px[o + 3] ? 255 : 255 * alpha);
    }
}

/** Shrink by `SS` (averaging, by coverage): smooth edges. */
function shrink(src: Float32Array, W: number, size: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < SS; dy++)
        for (let dx = 0; dx < SS; dx++) {
          const o = ((y * SS + dy) * W + x * SS + dx) * 4;
          const w = src[o + 3] / 255;
          r += src[o] * w;
          g += src[o + 1] * w;
          b += src[o + 2] * w;
          a += w;
        }
      const o = (y * size + x) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
      }
      out[o + 3] = (a / (SS * SS)) * 255;
    }
  return out;
}

/** A dark edge round the picture's shapes: it reads on any background. */
function outline(px: Uint8ClampedArray, size: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(px);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      if (px[o + 3] > 200) continue;
      let near = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < size && ny < size) near = Math.max(near, px[(ny * size + nx) * 4 + 3]);
      }
      if (near < 128) continue;
      const a = px[o + 3] / 255;
      out[o] = px[o] * a + 12 * (1 - a);
      out[o + 1] = px[o + 1] * a + 16 * (1 - a);
      out[o + 2] = px[o + 2] * a + 24 * (1 - a);
      out[o + 3] = Math.max(px[o + 3], 0.75 * 255);
    }
  return out;
}

/** Each wonder's picture as an image's address, made the first time it's asked for. */
const made = new Map<string, string>();
export function landmarkPicture(id: string): string {
  let url = made.get(id);
  if (url) return url;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d')!.putImageData(new ImageData(landmarkPixels(id, size), size, size), 0, 0);
  url = canvas.toDataURL();
  made.set(id, url);
  return url;
}
