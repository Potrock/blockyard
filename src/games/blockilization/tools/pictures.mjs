/**
 * Blockilization's pictures (node src/games/blockilization/tools/pictures.mjs): every unit model,
 * the leaders' busts and the wonders (`shapes.mjs`, `portraits.mjs`) drawn as little isometric
 * pictures, seen from the front and a little to the right and above, each voxel's three visible
 * faces lit from above, smoothed (drawn at three times the size and shrunk) and outlined; written as
 * PNGs (with their transparency) to `../pictures/`, with `../client/picturefiles.ts` listing them
 * for the screens.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { crc32, cellOf, hexRGB } from './voxel.mjs';
import { COLOURS, MODELS } from './shapes.mjs';
import { LEADER_SHEETS, LEADERS, WONDERS } from './portraits.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'pictures');

// ---------------------------------------------------------------------------------------------
// Drawing

/** How bright each face is: the top in the light, the front (+z) and the right side (+x) shaded. */
const SHADE = { top: 1, front: 0.84, side: 0.66 };
const SS = 3;

/**
 * A shape as an RGBA picture `size` pixels square, seen along `view` (toward the shape: from +x, +y,
 * +z for the units and wonders at three-quarters, the busts nearly face on; from any side for a
 * wonder turning). Its faces toward the eye are drawn, the top in the light and each side as much
 * as it faces the eye's right (`SHADE`'s front and side at three-quarters).
 */
function draw(model, size, view = [1, 0.85, 1], frame = null) {
  const W = size * SS;
  const cells = [];
  const filled = new Set();
  for (const part of model.vox.parts.values())
    for (const [key, colour] of part) {
      const [i, j, k] = cellOf(key);
      cells.push({ i, j, k, colour });
      filled.add(`${i},${j},${k}`);
    }
  const has = (i, j, k) => filled.has(`${i},${j},${k}`);
  // An orthographic projection along the view: right is across it level, up is square to both.
  const vl = Math.hypot(...view);
  const v = view.map((c) => c / vl);
  const rl = Math.hypot(v[2], v[0]);
  const r = [v[2] / rl, 0, -v[0] / rl];
  const up = [v[1] * r[2] - v[2] * r[1], v[2] * r[0] - v[0] * r[2], v[0] * r[1] - v[1] * r[0]];
  const project = (x, y, z) => [x * r[0] + z * r[2], -(x * up[0] + y * up[1] + z * up[2])];
  let lo = [Infinity, Infinity];
  let hi = [-Infinity, -Infinity];
  for (const { i, j, k } of cells)
    for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1]]) {
      const [px, py] = project(i + dx, j + dy, k + dz);
      lo = [Math.min(lo[0], px), Math.min(lo[1], py)];
      hi = [Math.max(hi[0], px), Math.max(hi[1], py)];
    }
  // (A turning wonder's frames share one frame round all of them: `frame`, its middle on the turning axis.)
  if (frame) [lo, hi] = frame;
  const span = Math.max(hi[0] - lo[0], hi[1] - lo[1]);
  const u = (W * 0.9) / span;
  const ox = (W - (hi[0] - lo[0]) * u) / 2 - lo[0] * u;
  const oy = (W - (hi[1] - lo[1]) * u) / 2 - lo[1] * u;
  const at = (x, y, z) => {
    const [px, py] = project(x, y, z);
    return [ox + px * u, oy + py * u];
  };
  const px = new Float32Array(W * W * 4);
  // Back to front: the farthest along the view first.
  const depth = (c) => c.i * v[0] + c.j * v[1] + c.k * v[2];
  cells.sort((a, b) => depth(a) - depth(b));
  // The sides toward the eye, and how lit each is: by how far it faces the eye's left (the light's
  // side), so a three-quarter view keeps the front and side shades.
  const sides = [
    { n: [0, 0, 1], face: (i, j, k) => [at(i, j, k + 1), at(i + 1, j, k + 1), at(i + 1, j + 1, k + 1), at(i, j + 1, k + 1)] },
    { n: [1, 0, 0], face: (i, j, k) => [at(i + 1, j, k), at(i + 1, j + 1, k), at(i + 1, j + 1, k + 1), at(i + 1, j, k + 1)] },
    { n: [0, 0, -1], face: (i, j, k) => [at(i, j, k), at(i + 1, j, k), at(i + 1, j + 1, k), at(i, j + 1, k)] },
    { n: [-1, 0, 0], face: (i, j, k) => [at(i, j, k), at(i, j + 1, k), at(i, j + 1, k + 1), at(i, j, k + 1)] },
  ]
    .filter((s) => s.n[0] * v[0] + s.n[2] * v[2] > 1e-6)
    .map((s) => {
      const left = -(s.n[0] * r[0] + s.n[2] * r[2]);
      return { ...s, shade: SHADE.side + (SHADE.front - SHADE.side) * Math.max(0, Math.min(1, 0.5 + left * 3)) };
    });
  for (const { i, j, k, colour } of cells) {
    const rgb = hexRGB(COLOURS[colour] ?? 0xff00ff);
    if (!has(i, j + 1, k)) quad(px, W, [at(i, j + 1, k), at(i + 1, j + 1, k), at(i + 1, j + 1, k + 1), at(i, j + 1, k + 1)], rgb, SHADE.top);
    for (const s of sides) if (!has(i + s.n[0], j, k + s.n[2])) quad(px, W, s.face(i, j, k), rgb, s.shade);
  }
  return outline(shrink(px, W, size), size);
}

/** The views of a wonder turning a full circle in `n` steps, from the three-quarter view. */
const turning = (n) => Array.from({ length: n }, (_, f) => {
  const a = (f / n) * Math.PI * 2 + Math.PI / 4;
  return [Math.SQRT2 * Math.sin(a), 0.85, Math.SQRT2 * Math.cos(a)];
});

/** The frame round a model seen along all the views (its middle across on the turning axis). */
function frameRound(model, views) {
  const [lo, hi] = bounds([model], views);
  const half = Math.max(-lo[0], hi[0]);
  return [[-half, lo[1]], [half, hi[1]]];
}

/** Where some models reach on the picture, seen along some views: [lo, hi], across and down. */
function bounds(models, views) {
  let lo = [Infinity, Infinity];
  let hi = [-Infinity, -Infinity];
  for (const model of models)
  for (const view of views) {
    const vl = Math.hypot(...view);
    const v = view.map((c) => c / vl);
    const rl = Math.hypot(v[2], v[0]);
    const r = [v[2] / rl, 0, -v[0] / rl];
    const up = [v[1] * r[2] - v[2] * r[1], v[2] * r[0] - v[0] * r[2], v[0] * r[1] - v[1] * r[0]];
    for (const part of model.vox.parts.values())
      for (const key of part.keys()) {
        const [i, j, k] = cellOf(key);
        for (const [dx, dy, dz] of [[0, 0, 0], [1, 1, 1], [1, 0, 0], [0, 1, 1], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 0]]) {
          const x = i + dx;
          const y = j + dy;
          const z = k + dz;
          const px = x * r[0] + z * r[2];
          const py = -(x * up[0] + y * up[1] + z * up[2]);
          lo = [Math.min(lo[0], px), Math.min(lo[1], py)];
          hi = [Math.max(hi[0], px), Math.max(hi[1], py)];
        }
      }
  }
  return [lo, hi];
}

/** Fill a convex quad (screen corners) with a colour at a shade. */
function quad(px, W, pts, rgb, shade) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(W - 1, Math.ceil(Math.max(...ys)));
  // Which way round the corners go, so "inside" is the same sign for every edge.
  let area = 0;
  for (let n = 0; n < 4; n++) {
    const [ax, ay] = pts[n];
    const [bx, by] = pts[(n + 1) % 4];
    area += ax * by - bx * ay;
  }
  const sign = area >= 0 ? 1 : -1;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      let inside = true;
      for (let n = 0; n < 4 && inside; n++) {
        const [ax, ay] = pts[n];
        const [bx, by] = pts[(n + 1) % 4];
        if (((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) * sign < -1e-6) inside = false;
      }
      if (!inside) continue;
      const o = (y * W + x) * 4;
      px[o] = rgb[0] * shade;
      px[o + 1] = rgb[1] * shade;
      px[o + 2] = rgb[2] * shade;
      px[o + 3] = 255;
    }
}

/** Shrink by `SS` (averaging, by coverage): smooth edges. */
function shrink(src, W, size) {
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

/** A dark edge round the shape (where it's clear but touches it): reads on any background. */
function outline(px, size) {
  const out = new Uint8ClampedArray(px);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      if (px[o + 3] > 200) continue;
      let near = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        near = Math.max(near, px[(ny * size + nx) * 4 + 3]);
      }
      if (near < 128) continue;
      const a = px[o + 3] / 255;
      const edge = 0.75;
      out[o] = px[o] * a + 12 * (1 - a);
      out[o + 1] = px[o + 1] * a + 16 * (1 - a);
      out[o + 2] = px[o + 2] * a + 24 * (1 - a);
      out[o + 3] = Math.max(px[o + 3], edge * 255);
    }
  return out;
}

// ---------------------------------------------------------------------------------------------
// PNG (RGBA)

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** A PNG of pictures `size` pixels square side by side (one, or a strip of a wonder's turning). */
function pngRGBA(frames, size) {
  if (!Array.isArray(frames)) frames = [frames];
  const width = size * frames.length;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const line = Buffer.alloc(width * 4 + 1);
    line[0] = 0;
    frames.forEach((px, f) => {
      for (let i = 0; i < size * 4; i++) line[1 + f * size * 4 + i] = px[y * size * 4 + i];
    });
    rows.push(line);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------------------------
// Writing

mkdirSync(OUT, { recursive: true });
/** The leaders seen nearly face on. */
const BUST_VIEW = [0.32, 0.3, 1];
const all = [
  ...MODELS.filter((m) => m.id.startsWith('u_')).map((m) => ({ m, size: 96 })),
  ...LEADERS.map((m) => ({ m, size: 128, view: BUST_VIEW })),
  ...WONDERS.map((m) => ({ m, size: 112 })),
];
let total = 0;
for (const { m, size, view } of all) {
  const bytes = pngRGBA(draw(m, size, view), size);
  writeFileSync(join(OUT, `${m.id}.png`), bytes);
  total += bytes.length;
}
// Each wonder turning a full circle, for the card when it's built: a strip of `TURN_FRAMES` pictures.
const TURN_FRAMES = 12;
const TURN_SIZE = 80;
for (const m of WONDERS) {
  const views = turning(TURN_FRAMES);
  const frame = frameRound(m, views);
  const bytes = pngRGBA(views.map((view) => draw(m, TURN_SIZE, view, frame)), TURN_SIZE);
  writeFileSync(join(OUT, `${m.id}_turn.png`), bytes);
  total += bytes.length;
}
// Each leader's strip for diplomacy's scene: its frames side by side, one frame round all of them
// (a raised fist reaches past the bust's own: the bust stays put as the frames change).
for (const { id, frames } of LEADER_SHEETS) {
  const frame = bounds(frames, [BUST_VIEW]);
  const bytes = pngRGBA(frames.map((m) => draw(m, 128, BUST_VIEW, frame)), 128);
  writeFileSync(join(OUT, `${id}.png`), bytes);
  total += bytes.length;
}
const ids = [...all.map((x) => x.m.id), ...WONDERS.map((m) => `${m.id}_turn`), ...LEADER_SHEETS.map((x) => x.id)];
writeFileSync(
  join(HERE, '..', 'client', 'picturefiles.ts'),
  [
    "// The pictures' files (written by tools/pictures.mjs; don't edit): units (u_), leaders (l_), wonders (w_; turning: w_..._turn).",
    ...ids.map((id) => `import ${id} from '../pictures/${id}.png?url';`),
    '',
    `export const PICTURES = { ${ids.join(', ')} } as const;`,
    'export type PictureId = keyof typeof PICTURES;',
    '',
  ].join('\n'),
);
console.log(`${ids.length} pictures, ${Math.round(total / 1024)} KB, in ${OUT}`);
