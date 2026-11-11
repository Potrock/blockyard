/**
 * Micro-voxel models in code (the platform's characters, `build.ts`, and what they wear): shapes
 * painted into voxel volumes, meshed as the visible voxel faces and baked onto an atlas: an
 * albedo, a metallic-roughness (G roughness, B metalness) and an emissive image of one UV layout.
 * The look is Call of Blocky's and Blockfront's (their build tools' `voxel.mjs`), finer: every
 * voxel its own shade of its colour, so the grid reads on a flat surface as well as from the
 * steps, and a soft occlusion in the concave corners.
 *
 * - Voxels: integer cells (i, j, k); cell (i, j, k) spans [i, i+1] x [j, j+1] x [k, k+1]. A model
 *   is parts (a character's: a part per joint), each a map of cells to colour names. Parts may
 *   share cells (a part reaching into its neighbour); a face shows where its own part has no
 *   voxel, so a part's surface is whole whatever the others do.
 * - Faces: each face of a voxel toward a cell its part leaves empty shows. Its occlusion: the
 *   cells round the one it faces (any part's): an occupied edge neighbour darkens that edge of the
 *   face, an occupied corner neighbour (both its edges open) that corner. Faces one part shows
 *   toward another's voxel are kept, unshaded (they show when the parts move apart: a knee's ball
 *   as it bends).
 * - Quads: the faces of one part in one plane merge into rectangles, whatever their colours: a
 *   quad carries its faces as texels (`TEXELS` a face each way), so a figure of some eighteen
 *   thousand voxel faces draws as under two thousand quads.
 * - The atlas: each quad's rectangle of texels (its faces' colours, each voxel's own shade, the
 *   occlusion), a gutter of its own edge round it, packed in shelves colour by colour (so coarser
 *   mip levels blend a quad with others like it). Drawn with nearest magnification, the voxels
 *   stay crisp up close.
 */

/** A colour of a model: sRGB hex, how rough and metallic it is, how much it glows (0..1). */
export interface Paint {
  name: string;
  rgb: number;
  rough: number;
  metal: number;
  glow: number;
  /** How much its voxels' shades vary (0: all alike). */
  vary: number;
}

/** A model's colours by name. */
export class Palette {
  readonly colours = new Map<string, Paint>();
  add(name: string, rgb: number, o: { rough?: number; metal?: number; glow?: number; vary?: number } = {}): string {
    this.colours.set(name, { name, rgb, rough: o.rough ?? 0.8, metal: o.metal ?? 0, glow: o.glow ?? 0, vary: o.vary ?? 0.045 });
    return name;
  }
  get(name: string): Paint {
    const c = this.colours.get(name);
    if (!c) throw new Error(`no colour ${name}`);
    return c;
  }
}

const B = 512;
/** A cell as one number (each coordinate -512..511). */
export const cellKey = (i: number, j: number, k: number) => i + B + (j + B) * 1024 + (k + B) * 1048576;
export const cellOf = (key: number): [number, number, number] => [(key % 1024) - B, (Math.floor(key / 1024) % 1024) - B, Math.floor(key / 1048576) - B];

/** What a painter gives a cell: a colour to set, `false` to clear it, nothing to leave it. */
export type Colouring = string | false | undefined | null | void;

/** A voxel model: parts, each a map of cells to colour names. */
export class Voxels {
  readonly parts = new Map<string, Map<number, string>>();
  part(name: string): Map<number, string> {
    let p = this.parts.get(name);
    if (!p) this.parts.set(name, (p = new Map()));
    return p;
  }
  set(part: string, i: number, j: number, k: number, colour: string) {
    if (!Number.isInteger(i) || !Number.isInteger(j) || !Number.isInteger(k)) throw new Error(`voxel ${part} at ${i}, ${j}, ${k}: not a cell`);
    this.part(part).set(cellKey(i, j, k), colour);
  }
  get(part: string, i: number, j: number, k: number): string | undefined {
    return this.parts.get(part)?.get(cellKey(i, j, k));
  }
  del(part: string, i: number, j: number, k: number) {
    this.parts.get(part)?.delete(cellKey(i, j, k));
  }
  /** Paint the cells of a box (lo inclusive, hi exclusive): `fn(i, j, k)` colours each. */
  paint(part: string, lo: number[], hi: number[], fn: (i: number, j: number, k: number) => Colouring) {
    const p = this.part(part);
    for (let k = lo[2]; k < hi[2]; k++)
      for (let j = lo[1]; j < hi[1]; j++)
        for (let i = lo[0]; i < hi[0]; i++) {
          const c = fn(i, j, k);
          if (c === false) p.delete(cellKey(i, j, k));
          else if (c) p.set(cellKey(i, j, k), c);
        }
  }
  /** Recolour a part's voxels: `fn(i, j, k, colour)` gives the new colour (nothing keeps it, `false` clears it). */
  recolour(part: string, fn: (i: number, j: number, k: number, colour: string) => Colouring) {
    const p = this.parts.get(part);
    if (!p) return;
    for (const [key, c] of [...p]) {
      const [i, j, k] = cellOf(key);
      const n = fn(i, j, k, c);
      if (n === false) p.delete(key);
      else if (n) p.set(key, n);
    }
  }
  /** Is a cell filled by this part (or, without one, by any)? */
  filled(i: number, j: number, k: number, part?: string): boolean {
    const key = cellKey(i, j, k);
    if (part) return this.parts.get(part)?.has(key) ?? false;
    for (const p of this.parts.values()) if (p.has(key)) return true;
    return false;
  }
  get count(): number {
    let n = 0;
    for (const p of this.parts.values()) n += p.size;
    return n;
  }
}

/** The six directions: normal, and the face's own axes u and v (u x v = the normal). */
export const DIRS = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
] as const;

// Occlusion states: bits 0-3 the edges at s=0, s=1, t=0, t=1 (s along u, t along v); bits 4-7 the
// corners (0,0), (1,0), (1,1), (0,1).

/** A quad: its part, direction, lowest cell and size in cells along the direction's u and v, and its texels in the atlas. */
export interface Quad {
  part: string;
  dir: number;
  cell: [number, number, number];
  du: number;
  dv: number;
  /** From its (0, 0) corner's (u0, v0) to its (1, 1) corner's (u1, v1), v down from the atlas's top. */
  uv: [number, number, number, number];
}

/** A baked model: its quads and its atlas (RGBA images, rows from the top). */
export interface Baked {
  quads: Quad[];
  width: number;
  height: number;
  albedo: Uint8Array;
  /** G roughness, B metalness. */
  mr: Uint8Array;
  /** Each texel's colour times its glow. */
  glow: Uint8Array;
}

/** Texels a voxel face, each way; the gutter round each quad's texels. */
export const TEXELS = 2;
const GUTTER = 1;

/** A voxel's shade (0 darker, 1, 2 lighter) from its cell. */
function shadeOf(i: number, j: number, k: number): number {
  let h = Math.imul(i + 7919, 0x27d4eb2d) ^ Math.imul(j + 104729, 0x165667b1) ^ Math.imul(k + 15485863, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  const r = (h >>> 0) / 4294967296;
  return r < 0.3 ? 0 : r < 0.72 ? 1 : 2;
}

const toLinear = (c8: number) => {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const toSrgb8 = (l: number) => {
  const v = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(Math.max(0, l), 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
};

/** How bright a point (x, y in 0..1) of a face is: 1, darkened in from its occluded edges and corners. */
function occlusion(ao: number, x: number, y: number): number {
  if (!ao) return 1;
  const ramp = (d: number) => (d < 0.75 ? 1 - 0.5 * (1 - d / 0.75) ** 2 : 1);
  let k = 1;
  if (ao & 1) k *= ramp(x);
  if (ao & 2) k *= ramp(1 - x);
  if (ao & 4) k *= ramp(y);
  if (ao & 8) k *= ramp(1 - y);
  if (ao & 16) k *= ramp(Math.hypot(x, y) * 1.1);
  if (ao & 32) k *= ramp(Math.hypot(1 - x, y) * 1.1);
  if (ao & 64) k *= ramp(Math.hypot(1 - x, 1 - y) * 1.1);
  if (ao & 128) k *= ramp(Math.hypot(x, 1 - y) * 1.1);
  return k;
}

/** The faces of one part in one plane: (u, v) to each face's colour, shade and occlusion (packed). */
interface Plane {
  part: string;
  dir: number;
  plane: number;
  at: Map<number, number>;
}
const uvKey = (u: number, v: number) => u + B + (v + B) * 1024;

/**
 * Bake a model: the visible faces of every part (a face toward another part's voxel is kept,
 * unshaded; a face two parts both show, their voxels in one cell, is kept once), merged plane by
 * plane into quads, each quad's faces drawn into the atlas.
 */
export function bake(vox: Voxels, palette: Palette): Baked {
  const paints = [...palette.colours.values()];
  const paintOf = new Map(paints.map((c, n) => [c.name, n]));
  // Every part's cells, and the cells two parts share (a face both show there is kept once).
  const all = new Set<number>();
  const shared = new Set<number>();
  for (const cells of vox.parts.values())
    for (const key of cells.keys()) {
      if (all.has(key)) shared.add(key);
      else all.add(key);
    }
  const seen = new Set<number>();
  const planes = new Map<number, Plane>();
  // A step along each axis, as a cell's key; each direction's normal, u and v as steps and axes.
  const STEP = [1, 1024, 1048576];
  const dirs = DIRS.map(({ n, u, v }) => {
    const axis = n[0] ? 0 : n[1] ? 1 : 2;
    return { axis, ua: u.indexOf(1), va: v.indexOf(1), n: STEP[axis] * (n[axis] as number), u: STEP[u.indexOf(1)], v: STEP[v.indexOf(1)] };
  });
  let partIndex = 0;
  for (const [part, cells] of vox.parts) {
    for (const [key, colour] of cells) {
      let c: [number, number, number] | null = null;
      let paint = 0;
      let shade = 1;
      for (let d = 0; d < 6; d++) {
        const D = dirs[d];
        const a = key + D.n;
        if (cells.has(a)) continue;
        if (shared.has(key)) {
          const fk = key * 8 + d;
          if (seen.has(fk)) continue;
          seen.add(fk);
        }
        if (!c) {
          c = cellOf(key);
          const p = paintOf.get(colour);
          if (p === undefined) throw new Error(`no colour ${colour}`);
          paint = p;
          shade = paints[p].vary ? shadeOf(c[0], c[1], c[2]) : 1;
        }
        let ao = 0;
        // (Toward another part's voxel: hidden until the parts move apart, and plain when they do.)
        if (!all.has(a)) {
          const e0 = all.has(a - D.u);
          const e1 = all.has(a + D.u);
          const e2 = all.has(a - D.v);
          const e3 = all.has(a + D.v);
          ao = (e0 ? 1 : 0) | (e1 ? 2 : 0) | (e2 ? 4 : 0) | (e3 ? 8 : 0);
          if (!e0 && !e2 && all.has(a - D.u - D.v)) ao |= 16;
          if (!e1 && !e2 && all.has(a + D.u - D.v)) ao |= 32;
          if (!e1 && !e3 && all.has(a + D.u + D.v)) ao |= 64;
          if (!e0 && !e3 && all.has(a - D.u + D.v)) ao |= 128;
        }
        const pk = (partIndex * 6 + d) * 1024 + c[D.axis] + B;
        let plane = planes.get(pk);
        if (!plane) planes.set(pk, (plane = { part, dir: d, plane: c[D.axis], at: new Map() }));
        plane.at.set(uvKey(c[D.ua], c[D.va]), paint | (shade << 8) | (ao << 10));
      }
    }
    partIndex++;
  }
  // Each plane's faces into rectangles (greedy: along u, then v).
  const rects: { plane: Plane; u: number; v: number; w: number; h: number; paint: number; x: number; y: number }[] = [];
  for (const plane of planes.values()) {
    const used = new Set<number>();
    const free = (u: number, v: number) => plane.at.has(uvKey(u, v)) && !used.has(uvKey(u, v));
    for (const key of [...plane.at.keys()].sort((p, q) => p - q)) {
      if (used.has(key)) continue;
      const u0 = (key % 1024) - B;
      const v0 = Math.floor(key / 1024) - B;
      let w = 1;
      while (free(u0 + w, v0)) w++;
      let h = 1;
      grow: for (;;) {
        for (let x = 0; x < w; x++) if (!free(u0 + x, v0 + h)) break grow;
        h++;
      }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) used.add(uvKey(u0 + x, v0 + y));
      rects.push({ plane, u: u0, v: v0, w, h, paint: plane.at.get(key)! & 255, x: 0, y: 0 });
    }
  }
  // Packed in shelves, colour by colour, the tall ones first.
  const T = TEXELS;
  const G = GUTTER;
  const order = [...rects].sort((p, q) => p.paint - q.paint || q.h - p.h || q.w - p.w);
  let area = 0;
  let widest = 0;
  for (const r of rects) {
    area += (r.w * T + 2 * G) * (r.h * T + 2 * G);
    widest = Math.max(widest, r.w * T + 2 * G);
  }
  const width = 2 ** Math.ceil(Math.log2(Math.max(16, widest, Math.sqrt(area * 1.15))));
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const r of order) {
    const pw = r.w * T + 2 * G;
    if (x + pw > width) {
      x = 0;
      y += shelf;
      shelf = 0;
    }
    r.x = x;
    r.y = y;
    x += pw;
    shelf = Math.max(shelf, r.h * T + 2 * G);
  }
  const height = 2 ** Math.ceil(Math.log2(Math.max(16, y + shelf)));
  const albedo = new Uint8Array(width * height * 4);
  const mr = new Uint8Array(width * height * 4);
  const glow = new Uint8Array(width * height * 4);
  const linear = paints.map((c) => [(c.rgb >> 16) & 255, (c.rgb >> 8) & 255, c.rgb & 255].map(toLinear));
  const quads: Quad[] = [];
  // (Most texels are a colour's three plain shades: worked out once each.)
  const plain = new Map<number, number[]>();
  const texel = (o: number, c: Paint, lin: number[], k: number, key = -1) => {
    let rgb = key < 0 ? undefined : plain.get(key);
    if (!rgb) {
      rgb = lin.map((l) => toSrgb8(l * k));
      if (key >= 0) plain.set(key, rgb);
    }
    for (let ch = 0; ch < 3; ch++) {
      albedo[o + ch] = rgb[ch];
      glow[o + ch] = Math.round(rgb[ch] * c.glow);
    }
    mr[o + 1] = Math.round(c.rough * 255);
    mr[o + 2] = Math.round(c.metal * 255);
    albedo[o + 3] = mr[o + 3] = glow[o + 3] = 255;
  };
  const copy = (to: number, from: number) => {
    for (let ch = 0; ch < 4; ch++) {
      albedo[to + ch] = albedo[from + ch];
      mr[to + ch] = mr[from + ch];
      glow[to + ch] = glow[from + ch];
    }
  };
  for (const r of rects) {
    const tw = r.w * T;
    const th = r.h * T;
    const x0 = r.x + G;
    const y0 = r.y + G;
    for (let fy = 0; fy < r.h; fy++)
      for (let fx = 0; fx < r.w; fx++) {
        const face = r.plane.at.get(uvKey(r.u + fx, r.v + fy))!;
        const c = paints[face & 255];
        const lin = linear[face & 255];
        const shade = 1 + (((face >> 8) & 3) - 1) * c.vary * 2.2;
        const ao = face >> 10;
        for (let sy = 0; sy < T; sy++)
          for (let sx = 0; sx < T; sx++) texel(((y0 + fy * T + sy) * width + x0 + fx * T + sx) * 4, c, lin, ao ? shade * occlusion(ao, (sx + 0.5) / T, (sy + 0.5) / T) : shade, ao ? -1 : face & 1023);
      }
    // The gutter: the rectangle's own edge, out to the sides, then above and below.
    for (let ty = 0; ty < th; ty++)
      for (let g = 1; g <= G; g++) {
        copy(((y0 + ty) * width + x0 - g) * 4, ((y0 + ty) * width + x0) * 4);
        copy(((y0 + ty) * width + x0 + tw - 1 + g) * 4, ((y0 + ty) * width + x0 + tw - 1) * 4);
      }
    for (let tx = -G; tx < tw + G; tx++)
      for (let g = 1; g <= G; g++) {
        copy(((y0 - g) * width + x0 + tx) * 4, (y0 * width + x0 + tx) * 4);
        copy(((y0 + th - 1 + g) * width + x0 + tx) * 4, ((y0 + th - 1) * width + x0 + tx) * 4);
      }
    const { n, u, v } = DIRS[r.plane.dir];
    const cell: [number, number, number] = [0, 0, 0];
    cell[n[0] ? 0 : n[1] ? 1 : 2] = r.plane.plane;
    cell[u.indexOf(1)] = r.u;
    cell[v.indexOf(1)] = r.v;
    quads.push({ part: r.plane.part, dir: r.plane.dir, cell, du: r.w, dv: r.h, uv: [(r.x + G) / width, (r.y + G) / height, (r.x + G + tw) / width, (r.y + G + th) / height] });
  }
  return { quads, width, height, albedo, mr, glow };
}

/** A quad's corners (voxel units), counter-clockwise from outside: its (0, 0), (1, 0), (1, 1) and (0, 1). */
export function quadCorners(f: Quad): number[][] {
  const { n, u, v } = DIRS[f.dir];
  const o = f.cell.map((c, a) => c + (n[a] > 0 ? 1 : 0));
  return [o, o.map((x, a) => x + u[a] * f.du), o.map((x, a) => x + u[a] * f.du + v[a] * f.dv), o.map((x, a) => x + v[a] * f.dv)];
}

/** A baked model's mesh: four corners a quad (positions in voxels times `scale`, normals, UVs), two triangles each. */
export function quadMesh(quads: Quad[], scale: number): { position: Float32Array; normal: Float32Array; uv: Float32Array; index: Uint32Array } {
  const n = quads.length;
  const position = new Float32Array(n * 12);
  const normal = new Float32Array(n * 12);
  const uv = new Float32Array(n * 8);
  const index = new Uint32Array(n * 6);
  quads.forEach((f, q) => {
    const corners = quadCorners(f);
    const d = DIRS[f.dir].n;
    const [u0, v0, u1, v1] = f.uv;
    const uvs = [u0, v0, u1, v0, u1, v1, u0, v1];
    for (let c = 0; c < 4; c++) {
      const v = q * 4 + c;
      for (let a = 0; a < 3; a++) {
        position[v * 3 + a] = corners[c][a] * scale;
        normal[v * 3 + a] = d[a];
      }
      uv[v * 2] = uvs[c * 2];
      uv[v * 2 + 1] = uvs[c * 2 + 1];
    }
    index.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
  });
  return { position, normal, uv, index };
}
