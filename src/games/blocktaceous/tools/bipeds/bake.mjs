/**
 * A copy of the platform's `src/platform/character/voxels.ts` as plain JavaScript (its types
 * stripped), with one thing added: `bake` takes how many texels a voxel face gets each way (the
 * platform's 2, or 1 for a big animal whose faces are small on screen: a quarter of the atlas).
 *
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

/** A model's colours by name. */
export class Palette {
           colours = new Map ();
  add(name, rgb, o = {}) {
    this.colours.set(name, { name, rgb, rough: o.rough ?? 0.8, metal: o.metal ?? 0, glow: o.glow ?? 0, vary: o.vary ?? 0.045 });
    return name;
  }
  get(name) {
    const c = this.colours.get(name);
    if (!c) throw new Error(`no colour ${name}`);
    return c;
  }
}

const B = 512;
/** A cell as one number (each coordinate -512..511). */
export const cellKey = (i, j, k) => i + B + (j + B) * 1024 + (k + B) * 1048576;
export const cellOf = (key) => [(key % 1024) - B, (Math.floor(key / 1024) % 1024) - B, Math.floor(key / 1048576) - B];

/** What a painter gives a cell: a colour to set, `false` to clear it, nothing to leave it. */

/** A voxel model: parts, each a map of cells to colour names. */
export class Voxels {
           parts = new Map ();
  part(name) {
    let p = this.parts.get(name);
    if (!p) this.parts.set(name, (p = new Map()));
    return p;
  }
  set(part, i, j, k, colour) {
    if (!Number.isInteger(i) || !Number.isInteger(j) || !Number.isInteger(k)) throw new Error(`voxel ${part} at ${i}, ${j}, ${k}: not a cell`);
    this.part(part).set(cellKey(i, j, k), colour);
  }
  get(part, i, j, k) {
    return this.parts.get(part)?.get(cellKey(i, j, k));
  }
  del(part, i, j, k) {
    this.parts.get(part)?.delete(cellKey(i, j, k));
  }
  /** Paint the cells of a box (lo inclusive, hi exclusive): `fn(i, j, k)` colours each. */
  paint(part, lo, hi, fn) {
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
  recolour(part, fn) {
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
  filled(i, j, k, part) {
    const key = cellKey(i, j, k);
    if (part) return this.parts.get(part)?.has(key) ?? false;
    for (const p of this.parts.values()) if (p.has(key)) return true;
    return false;
  }
  get count() {
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
];

// Occlusion states: bits 0-3 the edges at s=0, s=1, t=0, t=1 (s along u, t along v); bits 4-7 the
// corners (0,0), (1,0), (1,1), (0,1).

/** A quad: its part, direction, lowest cell and size in cells along the direction's u and v, and its texels in the atlas. */

/** A baked model: its quads and its atlas (RGBA images, rows from the top). */

/** Texels a voxel face, each way; the gutter round each quad's texels. */
export const TEXELS = 2;
const GUTTER = 1;

/** A voxel's shade (0 darker, 1, 2 lighter) from its cell. */
function shadeOf(i, j, k) {
  let h = Math.imul(i + 7919, 0x27d4eb2d) ^ Math.imul(j + 104729, 0x165667b1) ^ Math.imul(k + 15485863, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  const r = (h >>> 0) / 4294967296;
  return r < 0.3 ? 0 : r < 0.72 ? 1 : 2;
}

const toLinear = (c8) => {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const toSrgb8 = (l) => {
  const v = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(Math.max(0, l), 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
};

/** How bright a point (x, y in 0..1) of a face is: 1, darkened in from its occluded edges and corners. */
function occlusion(ao, x, y) {
  if (!ao) return 1;
  const ramp = (d) => (d < 0.75 ? 1 - 0.5 * (1 - d / 0.75) ** 2 : 1);
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

const uvKey = (u, v) => u + B + (v + B) * 1024;

/**
 * Bake a model: the visible faces of every part (a face toward another part's voxel is kept,
 * unshaded; a face two parts both show, their voxels in one cell, is kept once), merged plane by
 * plane into quads, each quad's faces drawn into the atlas.
 */
export function bake(vox, palette, { texels = TEXELS } = {}) {
  const paints = [...palette.colours.values()];
  const paintOf = new Map(paints.map((c, n) => [c.name, n]));
  // Every part's cells, and the cells two parts share (a face both show there is kept once).
  const all = new Set ();
  const shared = new Set ();
  for (const cells of vox.parts.values())
    for (const key of cells.keys()) {
      if (all.has(key)) shared.add(key);
      else all.add(key);
    }
  const seen = new Set ();
  const planes = new Map ();
  // A step along each axis, as a cell's key; each direction's normal, u and v as steps and axes.
  const STEP = [1, 1024, 1048576];
  const dirs = DIRS.map(({ n, u, v }) => {
    const axis = n[0] ? 0 : n[1] ? 1 : 2;
    return { axis, ua: u.indexOf(1), va: v.indexOf(1), n: STEP[axis] * (n[axis]), u: STEP[u.indexOf(1)], v: STEP[v.indexOf(1)] };
  });
  let partIndex = 0;
  for (const [part, cells] of vox.parts) {
    for (const [key, colour] of cells) {
      let c = null;
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
        if (!plane) planes.set(pk, (plane = { part, dir: d, plane: c[D.axis], at: new Map(), pk }));
        plane.at.set(uvKey(c[D.ua], c[D.va]), paint | (shade << 8) | (ao << 10));
      }
    }
    partIndex++;
  }
  // Each plane's faces into rectangles (greedy: along u, then v).
  const rects = [];
  for (const plane of planes.values()) {
    const used = new Set ();
    const free = (u, v) => plane.at.has(uvKey(u, v)) && !used.has(uvKey(u, v));
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
      rects.push({ plane, u: u0, v: v0, w, h, paint: plane.at.get(key) & 255, x: 0, y: 0 });
    }
  }
  // Packed in shelves, colour by colour, the tall ones first.
  const T = texels;
  const G = GUTTER;
  // (Here, unlike the platform's: by height class, then in the mesh's own order, part by part and
  // plane by plane, and the quads are given in that order too. A quad's neighbours in the atlas
  // are then its neighbours on the body, so both its corners and its texels' places run on from
  // the last quad's, which packs far smaller; and what a coarse mip level blends is nearby skin.)
  const tall = (h) => (h > 8 ? 4 : h > 4 ? 3 : h > 2 ? 2 : h - 1);
  const order = [...rects].sort((p, q) => tall(q.h) - tall(p.h) || p.plane.pk - q.plane.pk || p.v - q.v || p.u - q.u);
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
  const quads = [];
  // A face's occlusion at a texel; a face of one texel takes the mean over the face.
  const shadeAt = (ao, sx, sy) => (T > 1 ? occlusion(ao, (sx + 0.5) / T, (sy + 0.5) / T) : (occlusion(ao, 0.25, 0.25) + occlusion(ao, 0.75, 0.25) + occlusion(ao, 0.25, 0.75) + occlusion(ao, 0.75, 0.75)) / 4);
  // (Most texels are a colour's three plain shades: worked out once each.)
  const plain = new Map ();
  const texel = (o, c, lin, k, key = -1) => {
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
  const copy = (to, from) => {
    for (let ch = 0; ch < 4; ch++) {
      albedo[to + ch] = albedo[from + ch];
      mr[to + ch] = mr[from + ch];
      glow[to + ch] = glow[from + ch];
    }
  };
  for (const r of order) {
    const tw = r.w * T;
    const th = r.h * T;
    const x0 = r.x + G;
    const y0 = r.y + G;
    for (let fy = 0; fy < r.h; fy++)
      for (let fx = 0; fx < r.w; fx++) {
        const face = r.plane.at.get(uvKey(r.u + fx, r.v + fy));
        const c = paints[face & 255];
        const lin = linear[face & 255];
        const shade = 1 + (((face >> 8) & 3) - 1) * c.vary * 2.2;
        const ao = face >> 10;
        for (let sy = 0; sy < T; sy++)
          for (let sx = 0; sx < T; sx++) texel(((y0 + fy * T + sy) * width + x0 + fx * T + sx) * 4, c, lin, ao ? shade * shadeAt(ao, sx, sy) : shade, ao ? -1 : face & 1023);
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
    const cell = [0, 0, 0];
    cell[n[0] ? 0 : n[1] ? 1 : 2] = r.plane.plane;
    cell[u.indexOf(1)] = r.u;
    cell[v.indexOf(1)] = r.v;
    quads.push({ part: r.plane.part, dir: r.plane.dir, cell, du: r.w, dv: r.h, uv: [(r.x + G) / width, (r.y + G) / height, (r.x + G + tw) / width, (r.y + G + th) / height] });
  }
  return { quads, width, height, albedo, mr, glow };
}

/** A quad's corners (voxel units), counter-clockwise from outside: its (0, 0), (1, 0), (1, 1) and (0, 1). */
export function quadCorners(f) {
  const { n, u, v } = DIRS[f.dir];
  const o = f.cell.map((c, a) => c + (n[a] > 0 ? 1 : 0));
  return [o, o.map((x, a) => x + u[a] * f.du), o.map((x, a) => x + u[a] * f.du + v[a] * f.dv), o.map((x, a) => x + v[a] * f.dv)];
}

/** A baked model's mesh: four corners a quad (positions in voxels times `scale`, normals, UVs), two triangles each. */
export function quadMesh(quads, scale) {
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
