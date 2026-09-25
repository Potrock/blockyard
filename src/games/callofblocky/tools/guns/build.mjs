#!/usr/bin/env node
/**
 * Call of Blocky: the weapon models, modelled as low-poly hard-surface meshes and written as binary
 * glTF 2.0 (`.glb`) to `src/games/callofblocky/models/`. Dependency-free (Node 22+):
 * `node src/games/callofblocky/tools/guns/build.mjs [ids...] [--fast] [--parts]` (`--fast` skips the ambient-occlusion
 * bake; `--parts` lists triangles by part). About 30 s for all seven, each file under 400 KB.
 * Each file is parsed back and checked after it's written (chunks, JSON, accessors, winding,
 * images, markers), and each optic's window is checked clear.
 *
 * Conventions (the game's code relies on these exactly):
 *
 * - Units: 1 glTF unit = 1 block = 16 pixels. Everything is authored in pixels (px) and divided by
 *   16 when written. Proportions follow the real guns, a little chunkier across (receivers 2-3 px
 *   wide) so they read at a distance.
 * - Orientation: the barrel runs along +z (the muzzle is the +z end), +y is up. The gun's right
 *   side (ejection port, bolt handle) is -x; its left side (the thumb's side, the one the player
 *   sees in first person) is +x.
 * - Origin (0,0,0): the centre of the firing hand's fist around the pistol grip (= `grip`).
 * - Sizes (overall length along z, px): pistol 12, SMG 17, rifle 28, shotgun 29.5, sniper 33,
 *   katana 30 (blade 21 with its collar, handle 8 with the pommel). Pistol grips are about 2.2 px
 *   wide and 5 tall, raked 15 degrees (the shotgun's wrist 25, the sniper's 18), sized for the
 *   platform's 3.4 x 4.4 px first-person fist. A gun whose muzzle is less than 11 px ahead of the
 *   grip is held as a compact gun (the pistol and the SMG).
 * - Marker nodes: empty nodes (no mesh), children of the root, their translation in blocks:
 *   - `grip`: the centre of the firing fist on the pistol grip (the origin).
 *   - `grip2`: where the support hand holds, on the underside of the handguard / pump / forend
 *     (the SMG: its hand strap; the pistol: below and in front of the grip, the cupping hand).
 *   - `muzzle`: the centre of the barrel tip (flashes and tracers start here).
 *   - `sight`: the eye point when aiming down sights. On the pistol, SMG, rifle and shotgun it is
 *     the centre of the optic's open window (a red dot or holo) at the optic's rear face: the
 *     window holds no geometry and nothing stands in front of it along +z (the platform draws the
 *     reticle), and the iron sights are gone or low enough to stay out of the view through it.
 *     The optics are open reflex sights: a slim frame (about 1 px deep) round the window on a long
 *     low base that steps down ahead of the frame. On the sniper, the centre of the scope's rear
 *     lens.
 *   - `mag`: the centre of the magazine (reloads send the support hand here): the pistol's is its
 *     base plate below the grip (the rest is inside it); the shotgun's is its loading port under
 *     the receiver. The katana has none; its `grip` is the rear hand on the handle and `grip2` the
 *     front hand, and its blade runs along +z with the edge facing +y (its flats face ±x; note the
 *     platform's `sword` hold turns a model's +y toward the camera, so in first person it shows
 *     the edge unless its hold rolls it 90 degrees about z).
 * - The briefcase (a pickup, not a weapon) has no markers: its origin is the centre of its bottom
 *   face, +y up, its front (latches, the lid) toward +z; about 10 x 7 x 3 px, the handle on top.
 * - One material per file: the engine merges a held model's meshes and uses only the first
 *   material's textures. So every part maps into one atlas, and the material has three textures
 *   of that one UV layout, sampled LINEAR with mipmaps:
 *   - `baseColorTexture` (JPEG): the albedo, with the ambient occlusion baked in.
 *   - `metallicRoughnessTexture` (JPEG, glTF's layout: G = roughness, B = metalness): metal parts
 *     metallic with varied roughness (polished, blued, parkerized, worn edges), wood, polymer,
 *     pearl, rubber and lacquer dielectric. Its factors are 1 (the texture drives them).
 *   - `emissiveTexture` (PNG, grey): black, except what glows (lenses, the briefcase's gold); the
 *     engine glows the albedo by the emissive's red channel.
 * - Geometry: modelled from bevelled prisms (side profiles and cross-sections extruded with
 *   chamfered or rounded edges), lathes (barrels, tubes, bells, screws, knobs) and sweeps (a
 *   section along a path: trigger guards, magazines, the blade, straps). Normals are smoothed
 *   across edges under 32 degrees and split at harder ones (flat caps stay flat). Each part is
 *   unwrapped into charts (caps flat, walls and tubes unrolled), packed into the atlas, and every
 *   texel is painted from the 3D point it covers (so patterns run on across seams): material,
 *   edge wear (distance to the part's convex edges), grime in its concave corners, baked ambient
 *   occlusion, and per-part details (engraving, checkering, knurling, serrations, ports).
 *   One mesh per gun; POSITION (with min/max) and NORMAL as floats, TEXCOORD_0 as normalized
 *   unsigned shorts (core glTF, to keep files small), indices. Node tree: root (named after the
 *   gun's id) > [mesh node, marker nodes].
 */
import { deflateSync, inflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../../models');

// ---------------------------------------------------------------------------------------------
// Math

const DEG = Math.PI / 180;
const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const norm3 = (a) => {
  const l = len3(a);
  return l > 1e-12 ? mul3(a, 1 / l) : [0, 0, 0];
};
const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];
const len2 = (a) => Math.hypot(a[0], a[1]);
const norm2 = (a) => {
  const l = len2(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l] : [0, 0];
};

/** Turn p about an axis ('x' | 'y' | 'z') through a pivot, right-handed, in degrees. */
function turn(p, axis, deg, o = [0, 0, 0]) {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  const x = p[0] - o[0], y = p[1] - o[1], z = p[2] - o[2];
  if (axis === 'x') return [o[0] + x, o[1] + y * c - z * s, o[2] + y * s + z * c];
  if (axis === 'y') return [o[0] + z * s + x * c, o[1] + y, o[2] + z * c - x * s];
  return [o[0] + x * c - y * s, o[1] + x * s + y * c, o[2] + z];
}

/** A side-profile point (z, y) of a part raked `deg` about the origin (a turn about x); keeps a fillet radius. */
const raked = (deg) => (z, y, r) => {
  const p = turn([0, y, z], 'x', deg);
  return r === undefined ? [p[2], p[1]] : [p[2], p[1], r];
};

// ---------------------------------------------------------------------------------------------
// Noise and colour

/** A hash of integers to [0, 1). */
function hash(a, b = 0, c = 0, d = 0) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x3c6ef372, 0x165667b1) ^ Math.imul((c | 0) + 0x5bd1e995, 0x9e3779b1) ^ Math.imul((d | 0) + 0x1b873593, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in 3D, [0, 1). */
function vnoise(x, y, z, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let fx = x - xi, fy = y - yi, fz = z - zi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const h = (dx, dy, dz) => hash(xi + dx, yi + dy, zi + dz, seed);
  const x00 = lerp(h(0, 0, 0), h(1, 0, 0), fx), x10 = lerp(h(0, 1, 0), h(1, 1, 0), fx);
  const x01 = lerp(h(0, 0, 1), h(1, 0, 1), fx), x11 = lerp(h(0, 1, 1), h(1, 1, 1), fx);
  return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz);
}

/** Fractal value noise, [0, 1). */
function fbm(x, y, z, oct = 3, seed = 0) {
  let s = 0, a = 0.5, n = 0, f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, y * f, z * f, seed + i * 17);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}

const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const addc = (c, k) => [c[0] + k, c[1] + k, c[2] + k];
const mulc = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

// ---------------------------------------------------------------------------------------------
// Polygons (2D): rounded corners, insets, triangulation

const area2 = (poly) => {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
};

/** Drop repeated points (and a closing point equal to the first). */
function clean(poly, closed = true) {
  const out = [];
  for (const p of poly) if (!out.length || len2(sub2(p, out[out.length - 1])) > 1e-5) out.push([p[0], p[1]]);
  if (closed && out.length > 1 && len2(sub2(out[0], out[out.length - 1])) < 1e-5) out.pop();
  return out;
}

/**
 * A polygon (or an open path) with rounded corners: points [a, b, r?], where r rounds that corner
 * in about `seg` segments per quarter turn. `adj`: the polygon has been moved in by this much, so
 * its convex corners' radii shrink by it (to a point) and its reflex ones' grow; every rounded
 * corner makes the same number of points whatever `adj` is, so insets line up point for point.
 */
function fillet(pts, closed = true, seg = 3, adj = 0) {
  const out = [];
  const n = pts.length;
  const ccw = closed ? area2(pts) > 0 : true;
  for (let i = 0; i < n; i++) {
    const [x, y, r = 0] = pts[i];
    if (!r || (!closed && (i === 0 || i === n - 1))) {
      out.push([x, y]);
      continue;
    }
    const A = pts[(i - 1 + n) % n], B = pts[(i + 1) % n];
    const la = len2([A[0] - x, A[1] - y]), lb = len2([B[0] - x, B[1] - y]);
    const d1 = norm2([A[0] - x, A[1] - y]), d2 = norm2([B[0] - x, B[1] - y]);
    const theta = Math.acos(clamp(dot2(d1, d2), -1, 1));
    if (theta < 1e-3 || Math.PI - theta < 1e-3) {
      out.push([x, y]);
      continue;
    }
    const steps = Math.max(1, Math.ceil(((Math.PI - theta) / (Math.PI / 2)) * seg));
    const convex = (x - A[0]) * (B[1] - y) - (y - A[1]) * (B[0] - x) > 0 === ccw;
    let rr = convex ? Math.max(0, r - adj) : r + adj;
    if (rr < 1e-6) {
      for (let k = 0; k <= steps; k++) out.push([x, y]);
      continue;
    }
    const half = theta / 2;
    let t = rr / Math.tan(half);
    const lim = Math.min(la, lb) * 0.5;
    if (t > lim) {
      t = lim;
      rr = t * Math.tan(half);
    }
    const bis = norm2([d1[0] + d2[0], d1[1] + d2[1]]);
    const cd = rr / Math.sin(half);
    const c = [x + bis[0] * cd, y + bis[1] * cd];
    const p1 = [x + d1[0] * t, y + d1[1] * t], p2 = [x + d2[0] * t, y + d2[1] * t];
    const a1 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
    let da = Math.atan2(p2[1] - c[1], p2[0] - c[0]) - a1;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    for (let k = 0; k <= steps; k++) {
      const a = a1 + (da * k) / steps;
      out.push([c[0] + rr * Math.cos(a), c[1] + rr * Math.sin(a)]);
    }
  }
  return out;
}

/** A counter-clockwise polygon moved in by `c` (mitred corners, limited on sharp ones); keeps each point's radius. */
function inset(poly, c) {
  const n = poly.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = poly[(i - 1 + n) % n], p1 = poly[i], p2 = poly[(i + 1) % n];
    const e1 = norm2(sub2(p1, p0)), e2 = norm2(sub2(p2, p1));
    const n1 = [-e1[1], e1[0]], n2 = [-e2[1], e2[0]];
    const d = 1 + dot2(n1, n2);
    let m = d < 1e-6 ? n1 : [(n1[0] + n2[0]) / d, (n1[1] + n2[1]) / d];
    const ml = len2(m);
    if (ml > 2.5) m = [(m[0] * 2.5) / ml, (m[1] * 2.5) / ml];
    const q = [p1[0] + m[0] * c, p1[1] + m[1] * c];
    if (p1[2] !== undefined) q.push(p1[2]);
    out.push(q);
  }
  return out;
}

/** Ear-clipping triangulation of a simple counter-clockwise polygon (the best-shaped ear first). */
function triangulate(poly) {
  const idx = poly.map((_, i) => i);
  const out = [];
  const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inTri = (p, a, b, c) => cr(a, b, p) > 1e-10 && cr(b, c, p) > 1e-10 && cr(c, a, p) > 1e-10;
  const l2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  let guard = 0;
  while (idx.length > 3 && guard++ < 100000) {
    let best = -1, bestQ = -Infinity;
    const m = idx.length;
    for (let k = 0; k < m; k++) {
      const i0 = idx[(k - 1 + m) % m], i1 = idx[k], i2 = idx[(k + 1) % m];
      const a = poly[i0], b = poly[i1], c = poly[i2];
      const ar = cr(a, b, c);
      if (ar <= 1e-10) continue;
      let ok = true;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (inTri(poly[j], a, b, c)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const q = ar / Math.max(l2(a, b), l2(b, c), l2(c, a));
      if (q > bestQ) {
        bestQ = q;
        best = k;
      }
    }
    if (best < 0) {
      const k = idx.findIndex((_, k) => Math.abs(cr(poly[idx[(k - 1 + m) % m]], poly[idx[k]], poly[idx[(k + 1) % m]])) <= 1e-10);
      if (k < 0) throw new Error('triangulate: no ear (is the polygon simple?)');
      idx.splice(k, 1);
      continue;
    }
    out.push([idx[(best - 1 + m) % m], idx[best], idx[(best + 1) % m]]);
    idx.splice(best, 1);
  }
  if (idx.length === 3 && cr(poly[idx[0]], poly[idx[1]], poly[idx[2]]) > 1e-10) out.push([...idx]);
  return out;
}

/** Common sections. */
const rect = (w, h, r = 0) => [[-w / 2, -h / 2, r], [w / 2, -h / 2, r], [w / 2, h / 2, r], [-w / 2, h / 2, r]];
const circle = (r, n = 16, phase = 0) => Array.from({ length: n }, (_, i) => [r * Math.cos(phase + (i / n) * 2 * Math.PI), r * Math.sin(phase + (i / n) * 2 * Math.PI)]);
const ellipse = (rx, ry, n = 16) => Array.from({ length: n }, (_, i) => [rx * Math.cos((i / n) * 2 * Math.PI), ry * Math.sin((i / n) * 2 * Math.PI)]);

// ---------------------------------------------------------------------------------------------
// Parts: triangles with chart coordinates, built by prisms, lathes and sweeps

/** Charts longer than this (px) are split, so they pack well. */
const MAXCHART = 16;
/** Faces meeting at more than this are split (hard); under it, smoothed. */
const SMOOTH = 32;
let SG = 0; // smoothing groups

class Part {
  /** `mat(ctx) → { c, m, r, e }`; o.tex: texel density multiplier; o.decals: extra paint; o.ao: occlusion strength. */
  constructor(mat, o = {}) {
    this.mat = mat;
    this.tris = [];
    this.charts = [];
    this.tex = o.tex ?? 1;
    this.decals = o.decals ? [...o.decals] : [];
    this.ao = o.ao ?? 1;
    this.name = o.name ?? '';
  }
  chart() {
    const c = { tris: [] };
    this.charts.push(c);
    return c;
  }
  /** A triangle of corners { p, uv (chart px) }, wound to face `want`; in smoothing group `sg`. */
  tri(chart, a, b, c, want, sg) {
    const n = cross3(sub3(b.p, a.p), sub3(c.p, a.p));
    if (len3(n) < 1e-9) return;
    if (want && dot3(n, want) < 0) [b, c] = [c, b];
    const t = { v: [a, b, c].map((v) => ({ p: [...v.p], lp: [...v.p], uv: [...v.uv] })), chart, sg };
    this.tris.push(t);
    chart.tris.push(t);
  }
  quad(chart, a, b, c, d, want, sg) {
    this.tri(chart, a, b, c, want, sg);
    this.tri(chart, a, c, d, want, sg);
  }
  /** Move every point (the local points `lp` the paint may use stay as built). */
  map(fn) {
    for (const t of this.tris) for (const v of t.v) v.p = fn(v.p);
    return this;
  }
  move(x, y, z) {
    return this.map((p) => [p[0] + x, p[1] + y, p[2] + z]);
  }
  turn(axis, deg, o) {
    return this.map((p) => turn(p, axis, deg, o));
  }
  scale(kx, ky = kx, kz = kx) {
    return this.map((p) => [p[0] * kx, p[1] * ky, p[2] * kz]);
  }
  /** Mirror in x (the triangles rewound so they still face out). */
  mirrorX() {
    this.map((p) => [-p[0], p[1], p[2]]);
    for (const t of this.tris) [t.v[1], t.v[2]] = [t.v[2], t.v[1]];
    return this;
  }
  clone() {
    const c = new Part(this.mat, this);
    for (const ch of this.charts) {
      const nc = c.chart();
      for (const t of ch.tris) {
        const nt = { v: t.v.map((v) => ({ p: [...v.p], lp: [...v.lp], uv: [...v.uv] })), chart: nc, sg: t.sg };
        c.tris.push(nt);
        nc.tris.push(nt);
      }
    }
    return c;
  }
  decal(fn) {
    this.decals.push(fn);
    return this;
  }
}

/**
 * A prism: the polygon `poly` ([a, b, r?] points; r rounds a corner) extruded from d0 to d1 and
 * placed by `to3(a, b, d)`; its end edges bevelled by `bevel` px in `round` segments (1: a
 * chamfer, 3: rounded). The two end caps are flat; the walls are one smooth band per run between
 * hard corners.
 */
function prism(poly0, d0, d1, o) {
  const { to3, bevel = 0, round = 1, seg = 3 } = o;
  const raw = poly0.map((p) => [...p]);
  if (raw.length > 1 && len2(sub2(raw[0], raw[raw.length - 1])) < 1e-6) raw.pop();
  if (area2(raw) < 0) raw.reverse();
  const polyAt = (ins) => fillet(ins > 1e-9 ? inset(raw, ins) : raw, true, seg, ins);
  const poly = polyAt(0);
  const part = new Part(o.mat, o);
  const o3 = to3(0, 0, 0);
  const dir = (a, b, d) => sub3(to3(a, b, d), o3);
  const c = Math.min(bevel, (d1 - d0) * 0.45);
  const rings = [];
  if (c > 1e-6) {
    for (let j = 0; j <= round; j++) {
      const f = (j / round) * (Math.PI / 2);
      rings.push({ ins: c - c * Math.sin(f), d: d0 + c - c * Math.cos(f) });
    }
    for (let j = round; j >= 0; j--) {
      const f = (j / round) * (Math.PI / 2);
      rings.push({ ins: c - c * Math.sin(f), d: d1 - c + c * Math.cos(f) });
    }
  } else rings.push({ ins: 0, d: d0 }, { ins: 0, d: d1 });
  const polys = rings.map((r) => polyAt(r.ins));
  const ts = [0];
  for (let k = 1; k < rings.length; k++) ts.push(ts[k - 1] + Math.hypot(rings[k].ins - rings[k - 1].ins, rings[k].d - rings[k - 1].d));
  const n = poly.length;
  // The caps.
  const capPoly = clean(polys[0]);
  const capTris = triangulate(capPoly);
  for (const [d, sgn] of [
    [rings[0].d, -1],
    [rings[rings.length - 1].d, 1],
  ]) {
    const ch = part.chart();
    const sg = ++SG;
    const want = mul3(dir(0, 0, 1), sgn);
    const V = (q) => ({ p: to3(q[0], q[1], d), uv: [q[0], q[1]] });
    for (const [i, j, k] of capTris) part.tri(ch, V(capPoly[i]), V(capPoly[j]), V(capPoly[k]), want, sg);
  }
  // The walls (and bevels), in runs between hard corners.
  const eN = [], eL = [];
  for (let i = 0; i < n; i++) {
    const e = sub2(poly[(i + 1) % n], poly[i]);
    eL.push(len2(e));
    eN.push(norm2([e[1], -e[0]]));
  }
  // Zero-length edges (corners rounded to a point in an inset) carry the direction on.
  for (let i = 0; i < n; i++) if (eL[i] < 1e-7) eN[i] = eN[(i - 1 + n) % n];
  const hardAt = (i) => eL[i] > 1e-7 && dot2(eN[(i - 1 + n) % n], eN[i]) < Math.cos(SMOOTH * DEG);
  let start = 0;
  for (let i = 0; i < n; i++)
    if (hardAt(i)) {
      start = i;
      break;
    }
  const sg = ++SG;
  let ch = null, s = 0;
  for (let q = 0; q < n; q++) {
    const i = (start + q) % n, i2 = (i + 1) % n;
    if (!ch || hardAt(i) || s > MAXCHART) {
      ch = part.chart();
      s = 0;
    }
    const want = dir(eN[i][0], eN[i][1], 0);
    for (let k = 0; k + 1 < rings.length; k++) {
      const A = { p: to3(polys[k][i][0], polys[k][i][1], rings[k].d), uv: [s, ts[k]] };
      const B = { p: to3(polys[k][i2][0], polys[k][i2][1], rings[k].d), uv: [s + eL[i], ts[k]] };
      const C = { p: to3(polys[k + 1][i2][0], polys[k + 1][i2][1], rings[k + 1].d), uv: [s + eL[i], ts[k + 1]] };
      const D = { p: to3(polys[k + 1][i][0], polys[k + 1][i][1], rings[k + 1].d), uv: [s, ts[k + 1]] };
      part.quad(ch, A, B, C, D, want, sg);
    }
    s += eL[i];
  }
  return part;
}

/** A side profile: points (z, y) extruded across x, `w` wide, centred on `o.x` (default 0). */
const side = (pts, w, o = {}) => prism(pts, (o.x ?? 0) - w / 2, (o.x ?? 0) + w / 2, { ...o, to3: (a, b, d) => [d, b, a] });
/** A cross-section: points (x, y) extruded along z from z0 to z1. */
const along = (pts, z0, z1, o = {}) => prism(pts, z0, z1, { ...o, to3: (a, b, d) => [a, b, d] });
/** A plan: points (x, z) extruded up y from y0 to y1. */
const plan = (pts, y0, y1, o = {}) => prism(pts, y0, y1, { ...o, to3: (a, b, d) => [a, d, b] });
/** A box from `a` to `b`, its edges bevelled (all twelve) by `o.bevel`, rounded if `o.round` > 1. */
function box(a, b, o = {}) {
  const [x0, y0, z0] = a.map((v, k) => Math.min(v, b[k]));
  const [x1, y1, z1] = a.map((v, k) => Math.max(v, b[k]));
  const c = o.bevel ?? 0;
  const round = o.round ?? 1;
  const sec = c > 0 && round > 1 ? [[x0, y0, c], [x1, y0, c], [x1, y1, c], [x0, y1, c]] : c > 0 ? [[x0 + c, y0], [x1 - c, y0], [x1, y0 + c], [x1, y1 - c], [x1 - c, y1], [x0 + c, y1], [x0, y1 - c], [x0, y0 + c]] : [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  return along(sec, z0, z1, { ...o, seg: round });
}

/**
 * A lathe: the profile [[r, z], ...] turned about the z axis in `sides` segments. Walk the
 * profile from the back (low z) round the outside to the front, so its outside faces out; a
 * profile that steps inward and back makes a bore.
 */
function lathe(prof, o = {}) {
  const { sides = 16, phase = 0 } = o;
  const part = new Part(o.mat, o);
  const ang = (i) => phase * DEG + (i / sides) * Math.PI * 2;
  const P = (j, i) => {
    const [r, z] = prof[j];
    const a = ang(i);
    return [r * Math.cos(a), r * Math.sin(a), z];
  };
  const segs = [];
  for (let j = 0; j + 1 < prof.length; j++) {
    const dr = prof[j + 1][0] - prof[j][0], dz = prof[j + 1][1] - prof[j][1];
    const L = Math.hypot(dr, dz);
    if (L < 1e-7) continue;
    segs.push({ j, dr, dz, L, kind: Math.abs(dr) > Math.abs(dz) ? 'disk' : 'tube', dir: [dr / L, dz / L] });
  }
  const groups = [];
  let g = null;
  for (const s of segs) {
    const joined = g && g.kind === s.kind && dot2(g.last.dir, s.dir) > Math.cos(SMOOTH * DEG) && (s.kind === 'disk' || g.len < MAXCHART);
    if (!joined) {
      g = { kind: s.kind, segs: [], len: 0 };
      groups.push(g);
    }
    g.segs.push(s);
    g.last = s;
    g.len += s.L;
  }
  const base = ++SG;
  for (const g of groups) {
    const ch = part.chart();
    const Rm = Math.max(...g.segs.flatMap((s) => [prof[s.j][0], prof[s.j + 1][0]]));
    let v = 0;
    for (const s of g.segs) {
      const sg = Math.abs(s.dz) < 1e-7 ? ++SG : base;
      const q = (jj, ii, vv) => {
        const p = P(jj, ii);
        return { p, uv: g.kind === 'disk' ? [p[0], p[1]] : [(ii / sides) * Math.PI * 2 * Rm, vv] };
      };
      for (let i = 0; i < sides; i++) {
        const am = ang(i + 0.5);
        const want = [s.dz * Math.cos(am), s.dz * Math.sin(am), -s.dr];
        part.quad(ch, q(s.j, i, v), q(s.j, i + 1, v), q(s.j + 1, i + 1, v + s.L), q(s.j + 1, i, v + s.L), want, sg);
      }
      v += s.L;
    }
  }
  return part;
}

/** A plain cylinder along z (radius r, z0..z1), its ends chamfered by `bevel`; `open`: no back end (it sits on something). */
function cyl(r, z0, z1, o = {}) {
  const b = Math.min(o.bevel ?? 0, r * 0.5, (z1 - z0) * 0.45);
  let prof = b > 0 ? [[0, z0], [r - b, z0], [r, z0 + b], [r, z1 - b], [r - b, z1], [0, z1]] : [[0, z0], [r, z0], [r, z1], [0, z1]];
  if (o.open) prof = [[r, z0], ...prof.filter((p) => p[1] > z0 + 1e-9)];
  return lathe(prof, o);
}

/** Lathe axis helpers: a lathe built along z, turned to run along x or y, then moved to `at`. */
const alongX = (part, at) => part.turn('y', 90).move(...at);
const alongY = (part, at) => part.turn('x', -90).move(...at);

/**
 * A sweep: the section [[sx, sy], ...] carried along `path` ([x, y, z] points), sx along the
 * `side` vector (made square to the path) and sy across; `o.scale(t, i)` → k or [kx, ky] tapers
 * it, or `o.xform(t, i)` → [kx, ky, ox, oy] scales and shifts it. Open paths are capped unless
 * `o.caps` is false.
 */
function sweep(path, section, o = {}) {
  const { closed = false, caps = true, side: sv = [1, 0, 0], scale = null, xform = null, seg = 3 } = o;
  const part = new Part(o.mat, o);
  let sec = clean(fillet(section, true, seg));
  if (area2(sec) < 0) sec = sec.reverse();
  const n = path.length, m = sec.length;
  const T = path.map((p, i) => {
    const a = closed ? path[(i - 1 + n) % n] : path[Math.max(0, i - 1)];
    const b = closed ? path[(i + 1) % n] : path[Math.min(n - 1, i + 1)];
    return norm3(sub3(b, a));
  });
  const frames = T.map((t) => {
    const X = norm3(sub3(sv, mul3(t, dot3(sv, t))));
    return { X, Y: cross3(t, X) };
  });
  const kof = (i) => {
    const t = n > 1 ? i / (n - 1) : 0;
    if (xform) return xform(t, i);
    const k = scale ? scale(t, i) : 1;
    return Array.isArray(k) ? [k[0], k[1], 0, 0] : [k, k, 0, 0];
  };
  const rings = path.map((P, i) => {
    const { X, Y } = frames[i];
    const [kx, ky, ox, oy] = kof(i);
    return sec.map(([sx, sy]) => add3(P, add3(mul3(X, sx * kx + ox), mul3(Y, sy * ky + oy))));
  });
  const u = [0];
  for (let i = 1; i < n; i++) u.push(u[i - 1] + len3(sub3(path[i], path[i - 1])));
  const total = closed ? u[n - 1] + len3(sub3(path[0], path[n - 1])) : u[n - 1];
  const eN = [], eL = [];
  for (let k = 0; k < m; k++) {
    const e = sub2(sec[(k + 1) % m], sec[k]);
    eL.push(len2(e));
    eN.push(norm2([e[1], -e[0]]));
  }
  const hard = (k) => dot2(eN[(k - 1 + m) % m], eN[k]) < Math.cos(SMOOTH * DEG);
  let start = 0;
  for (let k = 0; k < m; k++)
    if (hard(k)) {
      start = k;
      break;
    }
  const runs = [];
  let run = null;
  for (let q = 0; q < m; q++) {
    const k = (start + q) % m;
    if (!run || hard(k)) {
      run = [];
      runs.push(run);
    }
    run.push(k);
  }
  const sg = ++SG;
  const segs = closed ? n : n - 1;
  for (const run of runs) {
    let ch = null, from = 0;
    for (let i = 0; i < segs; i++) {
      const i2 = (i + 1) % n;
      const ui = u[i], ui2 = i2 === 0 ? total : u[i2];
      if (!ch || ui - from > MAXCHART) {
        ch = part.chart();
        from = ui;
      }
      let v = 0;
      for (const k of run) {
        const k2 = (k + 1) % m;
        const fr = frames[i];
        const want = add3(mul3(fr.X, eN[k][0]), mul3(fr.Y, eN[k][1]));
        part.quad(ch, { p: rings[i][k], uv: [ui, v] }, { p: rings[i][k2], uv: [ui, v + eL[k]] }, { p: rings[i2][k2], uv: [ui2, v + eL[k]] }, { p: rings[i2][k], uv: [ui2, v] }, want, sg);
        v += eL[k];
      }
    }
  }
  if (!closed && caps) {
    const tris = triangulate(sec);
    for (const [end, sgn] of [
      [0, -1],
      [n - 1, 1],
    ]) {
      const ch = part.chart();
      const s2 = ++SG;
      const want = mul3(T[end], sgn);
      for (const [a, b, c] of tris) part.tri(ch, { p: rings[end][a], uv: sec[a] }, { p: rings[end][b], uv: sec[b] }, { p: rings[end][c], uv: sec[c] }, want, s2);
    }
  }
  return part;
}

/** The point a fraction `t` of the way along a path of 3D points (by length). */
function atLength(path, t) {
  const L = [0];
  for (let i = 1; i < path.length; i++) L.push(L[i - 1] + len3(sub3(path[i], path[i - 1])));
  const want = t * L[L.length - 1];
  for (let i = 1; i < path.length; i++)
    if (L[i] >= want) {
      const k = (want - L[i - 1]) / Math.max(1e-9, L[i] - L[i - 1]);
      return add3(path[i - 1], mul3(sub3(path[i], path[i - 1]), k));
    }
  return path[path.length - 1];
}

/** Points along a 2D path with rounded corners, as 3D points: `to3(a, b)`. */
const path3 = (pts, to3, seg = 3) => fillet(pts, false, seg).map(([a, b]) => to3(a, b));
/** A path in the side plane (z, y) at x. */
const sidePath = (pts, x = 0, seg = 3) => path3(pts, (z, y) => [x, y, z], seg);

// ---------------------------------------------------------------------------------------------
// Materials: each paints one texel from its context and returns { c: [r, g, b] (sRGB 0..255),
// m: metalness, r: roughness, e: glow (0..1) }. ctx: { p (model px), lp (the part's own px, as
// built), n (smooth normal), fn (face normal), ed (distance to the part's nearest convex edge),
// cd (to its nearest concave edge), ao, fw (a texel's size, px), rnd (per-texel noise) }.

/** How worn an edge is here: 1 on a convex edge, fading over `w` px, broken up. */
function wearAt(ctx, w = 0.12, seed = 77) {
  if (!(ctx.ed < w * 1.6)) return 0;
  const e = 1 - smoothstep(0, w, ctx.ed);
  const [x, y, z] = ctx.p;
  const n = fbm(x * 2.7, y * 2.7, z * 2.7, 3, seed);
  return clamp((e * 1.35 - (1 - n) * 0.75) * 2.4);
}
/** Grime settled into concave corners (0..1). */
const grimeAt = (ctx, w = 0.3) => (ctx.cd < w ? 1 - smoothstep(0, w, ctx.cd) : 0);

/**
 * Metal: a base colour (its specular colour) mottled toward `alt`, optionally brushed along a
 * local axis, rougher in its corners, with worn edges showing `wear` (bare steel).
 */
function metal(o) {
  const B = hex(o.base), A = hex(o.alt ?? o.base), WC = o.wear ? hex(o.wear) : null;
  const rough = o.rough ?? 0.3, rv = o.rv ?? 0.08, met = o.metal ?? 1;
  const mottle = o.mottle ?? 0.35;
  return (ctx) => {
    const [x, y, z] = ctx.p;
    const mt = fbm(x * 0.45, y * 0.45, z * 0.45, 3, o.seed ?? 11);
    let c = mixc(B, A, clamp((mt - 0.5) * 2.2 * mottle + 0.5));
    let r = rough + (mt - 0.5) * rv * 2;
    if (o.brush !== undefined) {
      const k = o.brush;
      const lp = ctx.lp;
      const s = vnoise(lp[k] * 0.35, lp[(k + 1) % 3] * 18, lp[(k + 2) % 3] * 18, 5) - 0.5;
      c = addc(c, s * (o.streak ?? 12));
      r += s * 0.05;
    }
    const g = grimeAt(ctx) * (o.grime ?? 0.4);
    c = mulc(c, 1 - g * 0.45);
    r += g * 0.18;
    let m = met;
    const w = WC ? wearAt(ctx, o.wearW ?? 0.11) * (o.wearAmt ?? 1) : 0;
    if (w > 0) {
      c = mixc(c, WC, w);
      r = lerp(r, o.wearRough ?? 0.22, w);
      m = lerp(m, 1, w);
    }
    return { c, m, r: clamp(r, 0.04, 1), e: 0 };
  };
}

/** A dielectric: paint, plastic, rubber, bakelite, lacquer. */
function paint(o) {
  const B = hex(o.base), A = hex(o.alt ?? o.base), WC = o.wear ? hex(o.wear) : null;
  return (ctx) => {
    const [x, y, z] = ctx.p;
    const mt = fbm(x * (o.scale ?? 0.6), y * (o.scale ?? 0.6), z * (o.scale ?? 0.6), 3, o.seed ?? 23);
    let c = mixc(B, A, clamp(mt * 1.8 - 0.4));
    let r = (o.rough ?? 0.5) + (mt - 0.5) * (o.rv ?? 0.1);
    if (o.stipple) {
      const s = vnoise(x * 11, y * 11, z * 11, 41);
      c = addc(c, (s - 0.5) * o.stipple);
      r += (s - 0.5) * 0.08;
    }
    const g = grimeAt(ctx) * (o.grime ?? 0.3);
    c = mulc(c, 1 - g * 0.35);
    let m = 0;
    const w = WC ? wearAt(ctx, o.wearW ?? 0.1) * (o.wearAmt ?? 1) : 0;
    if (w > 0) {
      c = mixc(c, WC, w);
      r = lerp(r, o.wearRough ?? 0.35, w);
      m = lerp(0, o.wearMetal ?? 0, w);
    }
    return { c, m, r: clamp(r, 0.04, 1), e: 0 };
  };
}

/**
 * Wood: growth rings of a log lying along `axis` (0 x, 1 y, 2 z) off to one side, so the sides
 * show long flowing stripes; pores along the grain; optional curl figure across it; a lacquered
 * or oiled finish, edges burnished lighter.
 */
function wood(o) {
  const L = hex(o.light), Mi = hex(o.mid), D = hex(o.dark);
  const ax = o.axis ?? 2, seed = o.seed ?? 3, ring = o.ring ?? 0.8;
  const ctr = o.center ?? [7, -16];
  return (ctx) => {
    const p = ctx.p;
    const along = p[ax], a = p[(ax + 1) % 3], b = p[(ax + 2) % 3];
    const w1 = fbm(along * 0.045, a * 0.16, b * 0.16, 3, seed) - 0.5;
    const w2 = fbm(along * 0.22, a * 0.6, b * 0.6, 2, seed + 5) - 0.5;
    const rr = Math.hypot(a - ctr[0], b - ctr[1]) + w1 * 7 + w2 * 0.9;
    const f = rr * ring - Math.floor(rr * ring);
    // Late wood: a soft dark band in each ring; early wood lighter.
    const late = smoothstep(0.5, 0.85, f) * (1 - smoothstep(0.93, 1, f));
    let c = mixc(Mi, D, late * (o.contrast ?? 0.55));
    c = mixc(c, L, smoothstep(0.08, 0.3, f) * (1 - smoothstep(0.3, 0.5, f)) * 0.3);
    // Broad colour changes through the board.
    const v = fbm(along * 0.06, a * 0.25, b * 0.25, 3, seed + 11);
    c = mixc(c, L, smoothstep(0.55, 0.8, v) * 0.35);
    c = mixc(c, D, smoothstep(0.42, 0.18, v) * 0.3);
    // Pores: short dark flecks along the grain.
    const pn = vnoise(along * 1.3, a * 12, b * 12, seed + 9);
    const pore = smoothstep(0.66, 0.86, pn) * (o.pore ?? 0.35);
    c = mulc(c, 1 - pore);
    // Figure: soft shimmering bands across the grain (curly koa, fiddleback maple).
    if (o.figure) {
      const fg = Math.sin(along * 5.2 + w1 * 16 + a * 1.4 + b * 0.6) * (0.35 + fbm(along * 0.25, a * 0.4, b * 0.4, 2, seed + 21));
      c = mulc(c, 1 + fg * o.figure * 0.06);
    }
    let r = (o.rough ?? 0.38) + late * 0.05 + pore * 0.3;
    const w = wearAt(ctx, 0.14, seed + 30) * (o.wearAmt ?? 0.6);
    c = mixc(c, L, w * 0.45);
    r = lerp(r, 0.55, w * 0.5);
    const g = grimeAt(ctx, 0.25) * 0.45;
    c = mulc(c, 1 - g * 0.4);
    return { c, m: 0, r: clamp(r), e: 0 };
  };
}

/** Mother-of-pearl: cream nacre in wavy growth bands, flushed pink, mint and lavender. */
function pearl(ctx) {
  const [x, y, z] = ctx.lp;
  const w = fbm(x * 0.7, y * 0.9, z * 0.9, 4, 21);
  const band = Math.sin((y * 1.9 + z * 0.9 + w * 6.5) * 2.1);
  const h = fbm(x * 1.4 + 5, y * 1.4, z * 1.4, 3, 23);
  let c = hex('#efe7d8');
  // Flowing flame-like sheets of colour through the nacre.
  c = mixc(c, hex('#f0b2c8'), clamp(band * 0.5 + 0.5) * 0.7 * clamp(h * 2.4 - 0.55));
  c = mixc(c, hex('#b3e3d6'), clamp(-band * 0.5 + 0.5) * 0.65 * clamp(1.55 - h * 2.4));
  c = mixc(c, hex('#c6bdf0'), smoothstep(0.55, 0.75, w) * 0.6);
  c = mixc(c, hex('#efd79c'), smoothstep(0.6, 0.8, fbm(y * 1.1 + 9, z * 1.1, x, 2, 25)) * 0.45);
  c = mixc(c, hex('#fffaf0'), smoothstep(0.72, 0.9, h) * 0.55);
  // Silvery depth in the troughs of the growth layers, and fine growth lines.
  c = mixc(c, hex('#b9b4b8'), smoothstep(0.35, 0.18, w) * 0.4);
  const gl = Math.abs(Math.sin((y * 3.1 + w * 5) * 7));
  c = mulc(c, 1 - (1 - gl) * 0.07);
  c = mulc(c, 1 - grimeAt(ctx, 0.2) * 0.25);
  return { c, m: 0, r: 0.1 + h * 0.08, e: 0 };
}

/** A lens: deep blue glass with a coated purple-green sheen toward its rim. */
const lens = (o = {}) => (ctx) => {
  const [x, y] = ctx.lp;
  const r = Math.hypot(x, y) / (o.r ?? 1);
  const a = Math.atan2(y, x);
  let c = mixc(hex('#0c1622'), hex('#1d3142'), clamp(1 - r));
  c = mixc(c, mixc(hex('#3b1f55'), hex('#1f5540'), 0.5 + 0.5 * Math.sin(a * 2 + 1)), smoothstep(0.45, 1, r) * 0.6);
  return { c, m: 0, r: 0.04, e: 0 };
};

/** Something that glows (a red dot's LED, a lens's glint): its albedo is the glow's colour. */
const glow = (col, e = 1) => (ctx) => ({ c: addc(hex(col), (ctx.rnd - 0.5) * 4), m: 0, r: 0.3, e });

/** The bore: nearly black, a little oily. */
const BORE = { c: [14, 14, 16], m: 0.5, r: 0.5, e: 0 };

/**
 * Tsuka-ito: silk braid wrapped over the handle, crossing on its edge and spine, the black
 * lacquered ray-skin showing through in a row of diamonds on each flat side. Pattern in the
 * handle's own frame (lp: z along it, y edge-to-spine).
 */
const silk = (col, dark, skin) => (ctx) => {
  const [x, y, z] = ctx.lp;
  const P = 0.92;
  const s = z / P - Math.floor(z / P);
  const a = clamp(Math.abs(y) / 1.0);
  const sideFace = Math.abs(ctx.n[0]) > 0.35;
  const diamond = Math.abs(s - 0.5) * 2 < (1 - a) * 0.92 - 0.12;
  if (sideFace && diamond) {
    const g = vnoise(x * 30, y * 30, z * 30, 5);
    return { c: addc(hex(skin), (g - 0.5) * 14), m: 0, r: 0.35 + g * 0.2, e: 0 };
  }
  // The braid: fine threads along each band's diagonal, a crease between bands.
  const dirn = (Math.floor(z / P + 0.5) + (y > 0 ? 1 : 0)) % 2 ? 1 : -1;
  const th = Math.abs(Math.sin((z * 0.7 + dirn * y * 1.2) * 38));
  let c = mixc(hex(col), hex(dark), (1 - th) * 0.35);
  const edgeDist = Math.min(Math.abs(s - 0.5) * 2 - ((1 - a) * 0.92 - 0.12), s < 0.5 ? s : 1 - s);
  c = mulc(c, 0.72 + 0.28 * smoothstep(0, 0.12, Math.abs(edgeDist)));
  c = addc(c, (ctx.rnd - 0.5) * 6);
  return { c, m: 0, r: 0.62, e: 0 };
};

/**
 * Nylon webbing (a sling or strap): a tight twill weave, the colour a touch mottled.
 */
const webbing = (col) => (ctx) => {
  const [x, y, z] = ctx.p;
  const w = Math.abs(Math.sin((x * 1.0 + y * 1.0 + z * 1.0) * 30)) * 0.5 + Math.abs(Math.sin((x - y + z * 0.5) * 22)) * 0.5;
  let c = mulc(hex(col), 0.82 + 0.18 * w);
  c = mulc(c, 1 - grimeAt(ctx) * 0.3);
  return { c: addc(c, (ctx.rnd - 0.5) * 6), m: 0, r: 0.75, e: 0 };
};

/** Black pebbled leather, its edges and handle worn a little brown. */
function leather(ctx) {
  const [x, y, z] = ctx.p;
  const cell = vnoise(x * 9, y * 9, z * 9, 61);
  const crease = smoothstep(0.62, 0.8, cell);
  let c = mixc(hex('#221f20'), hex('#141213'), crease);
  c = addc(c, (fbm(x * 0.8, y * 0.8, z * 0.8, 2, 62) - 0.5) * 10);
  const w = wearAt(ctx, 0.25, 63);
  c = mixc(c, hex('#4b3a30'), w * 0.6);
  c = mulc(c, 1 - grimeAt(ctx) * 0.3);
  return { c, m: 0, r: 0.52 + crease * 0.2 - w * 0.1, e: 0 };
}

/** What's in the briefcase: molten gold light, hottest high in the middle. It glows. */
function golden(ctx) {
  const [x, y] = ctx.p;
  const t = clamp(1 - Math.abs(x) / 5.5) * 0.55 + clamp((y - 1) / 6.5) * 0.45;
  let c = mixc(hex('#e86f00'), hex('#ffc43a'), t);
  const sp = vnoise(ctx.p[0] * 6, ctx.p[1] * 6, ctx.p[2] * 6, 71);
  if (sp > 0.8) c = mixc(c, [255, 236, 170], (sp - 0.8) * 3);
  // A moderate glow keeps it gold (the engine adds albedo x glow x 3; too much and it clips to pale yellow).
  return { c, m: 0, r: 0.3, e: 0.42 + 0.2 * t };
}

// The palette.
const M = {
  nickel: metal({ base: '#dedbd3', alt: '#c9c4b8', rough: 0.12, rv: 0.1, grime: 0.5, wear: '#f4f2ec', wearRough: 0.06, brush: 2, streak: 6 }),
  chrome: metal({ base: '#e8eaee', alt: '#d6d9df', rough: 0.07, rv: 0.04, grime: 0.4 }),
  blued: metal({ base: '#232833', alt: '#33405a', rough: 0.3, rv: 0.12, mottle: 0.6, wear: '#a3a9b1', wearRough: 0.22, brush: 2, streak: 6 }),
  bluedDark: metal({ base: '#1b1f27', alt: '#272e3b', rough: 0.36, rv: 0.1, wear: '#8d939b', wearRough: 0.26 }),
  parker: metal({ base: '#2d2f2d', alt: '#3a3c38', rough: 0.7, rv: 0.12, metal: 0.35, wear: '#8c9096', wearRough: 0.3, wearW: 0.09 }),
  steel: metal({ base: '#9ea3aa', alt: '#878c93', rough: 0.28, rv: 0.08, brush: 2, streak: 14, wear: '#cdd1d6', wearRough: 0.18 }),
  darksteel: metal({ base: '#4a4f57', alt: '#3c4048', rough: 0.34, rv: 0.08, wear: '#a4a9b0', wearRough: 0.22 }),
  gold: metal({ base: '#f5c55c', alt: '#e0a238', rough: 0.2, rv: 0.1, grime: 0.55, wear: '#ffe7a3', wearRough: 0.12 }),
  brass: metal({ base: '#d8aa55', alt: '#b98838', rough: 0.3, rv: 0.12, grime: 0.6, wear: '#f2d38c', wearRough: 0.18 }),
  alu: metal({ base: '#c9ccd1', alt: '#b4b8be', rough: 0.3, rv: 0.08, brush: 2, streak: 10 }),
  anod: metal({ base: '#1e1f23', alt: '#27292e', rough: 0.42, rv: 0.08, metal: 0.55, wear: '#b9bdc3', wearRough: 0.28, wearW: 0.08, wearAmt: 0.8 }),
  polymer: paint({ base: '#1c1d20', alt: '#232428', rough: 0.62, stipple: 10, wear: '#35373c', wearRough: 0.45 }),
  rubber: paint({ base: '#161616', alt: '#1d1c1c', rough: 0.9, stipple: 8 }),
  bakelite: paint({ base: '#6e2a1c', alt: '#8a3a22', scale: 0.9, rough: 0.28, rv: 0.12, grime: 0.5, wear: '#9c5a3a', wearRough: 0.2 }),
  // Lacquers, glossy; worn edges show what's under them.
  pink: paint({ base: '#ff3d97', alt: '#e8217e', rough: 0.2, rv: 0.06, wear: '#2a2a2e', wearAmt: 0.5, wearMetal: 0.5, wearRough: 0.4 }),
  cherry: paint({ base: '#c8142b', alt: '#a50c22', rough: 0.16, rv: 0.06, wear: '#2a1416', wearAmt: 0.55, wearRough: 0.35 }),
  yellow: paint({ base: '#ffcc1a', alt: '#f0b400', rough: 0.2, rv: 0.06, wear: '#26262a', wearAmt: 0.5, wearMetal: 0.5, wearRough: 0.4 }),
  negoro: paint({ base: '#b3161e', alt: '#8f1016', rough: 0.14, rv: 0.06, wear: '#121112', wearAmt: 1.2, wearW: 0.16, wearRough: 0.2 }),
  lacquer: paint({ base: '#141315', alt: '#1d1b1e', rough: 0.12, rv: 0.05, wear: '#3a2a22', wearAmt: 0.5 }),
  koa: wood({ light: '#e5a45c', mid: '#b56a2e', dark: '#6a3416', figure: 0.9, ring: 0.9, seed: 3, pore: 0.2 }),
  walnut: wood({ light: '#8f6240', mid: '#633b24', dark: '#351c0e', ring: 1.0, seed: 9, rough: 0.34, contrast: 0.65, pore: 0.25 }),
  honey: wood({ light: '#f3c46c', mid: '#d99a3e', dark: '#93541a', figure: 0.8, ring: 0.7, seed: 15, rough: 0.28, contrast: 0.62, pore: 0.14 }),
  pinkWeb: webbing('#ff3d97'),
  ito: silk('#ffc81f', '#b27a00', '#151414'),
  pearl,
  leather,
  golden,
  bore: () => BORE,
};

// ---------------------------------------------------------------------------------------------
// Details painted on parts (decals): fn(ctx, out) changes `out`.

/** A 5x7 font for engraving (rows top to bottom, 5 bits each). */
const FONT = {
  A: '0e11111f111111', B: '1e11111e11111e', C: '0e11101010110e', D: '1c12111111121c', E: '1f10101e10101f', F: '1f10101e101010', G: '0e111017111f0f',
  H: '1111111f111111', I: '0e04040404040e', J: '0702020202120c', K: '11121418141211', L: '1010101010101f', M: '111b1515111111', N: '11111915131111',
  O: '0e11111111110e', P: '1e11111e101010', Q: '0e11111115120d', R: '1e11111e141211', S: '0f10100e01011e', T: '1f040404040404', U: '1111111111110e',
  V: '11111111110a04', W: '1111111515150a', X: '11110a040a1111', Y: '1111110a040404', Z: '1f01020408101f',
  0: '0e11131519110e', 1: '040c040404040e', 2: '0e11010204081f', 3: '1f02040201110e', 4: '02060a121f0202', 5: '1f101e0101110e', 6: '0608101e11110e',
  7: '1f010204080808', 8: '0e11110e11110e', 9: '0e11110f01020c', '.': '00000000000c0c', '-': '0000000e000000', "'": '04040800000000', ' ': '00000000000000',
  '*': '00150e1f0e1500',
};
/**
 * The glyph as strokes: segments joining each lit pixel of the 5x7 font to its lit neighbours
 * (diagonals only where no square path exists), in font pixels, y up. Drawn with round pens they
 * read as cut or stamped letters rather than pixels.
 */
const GLYPHS = new Map();
function strokes(ch) {
  if (GLYPHS.has(ch)) return GLYPHS.get(ch);
  const g = FONT[ch] ?? FONT[' '];
  const on = (c, r) => c >= 0 && c < 5 && r >= 0 && r < 7 && parseInt(g.slice(r * 2, r * 2 + 2), 16) & (1 << (4 - c));
  const P = (c, r) => [c + 0.5, 6.5 - r];
  const segs = [];
  for (let r = 0; r < 7; r++)
    for (let c = 0; c < 5; c++) {
      if (!on(c, r)) continue;
      let linked = on(c - 1, r) || on(c, r - 1) || on(c - 1, r - 1) || on(c + 1, r - 1);
      if (on(c + 1, r)) segs.push([...P(c, r), ...P(c + 1, r)]), (linked = true);
      if (on(c, r + 1)) segs.push([...P(c, r), ...P(c, r + 1)]), (linked = true);
      if (on(c + 1, r + 1) && !on(c + 1, r) && !on(c, r + 1)) segs.push([...P(c, r), ...P(c + 1, r + 1)]), (linked = true);
      if (on(c - 1, r + 1) && !on(c - 1, r) && !on(c, r + 1)) segs.push([...P(c, r), ...P(c - 1, r + 1)]), (linked = true);
      if (!linked) segs.push([...P(c, r), ...P(c, r)]);
    }
  GLYPHS.set(ch, segs);
  return segs;
}
/** Coverage (0..1) of text `str` at (u, v) px from its bottom-left, letters `h` px tall, a texel `fw` px. */
function textMask(str, u, v, h, fw) {
  const fp = h / 7, adv = 6 * fp;
  if (u < -fp || v < -fp || v > h + fp || u > str.length * adv + fp) return 0;
  const ci = Math.floor(u / adv);
  let d = Infinity;
  for (const k of [ci - 1, ci, ci + 1]) {
    if (k < 0 || k >= str.length) continue;
    const gx = (u - k * adv) / fp, gy = v / fp;
    for (const [x0, y0, x1, y1] of strokes(str[k].toUpperCase())) {
      const ex = x1 - x0, ey = y1 - y0;
      const t = clamp(((gx - x0) * ex + (gy - y0) * ey) / Math.max(1e-9, ex * ex + ey * ey));
      d = Math.min(d, Math.hypot(gx - x0 - ex * t, gy - y0 - ey * t));
    }
  }
  d *= fp;
  const hw = fp * 0.5, aa = fw * 0.7;
  return 1 - smoothstep(hw - aa, hw + aa, d);
}

/**
 * Engraved text on the faces turned toward `face`: from `o` (its bottom-left, px) along `du`,
 * letters `h` px tall up `dv`. `fill`: a colour (inlay) or null (darkened, rougher cuts).
 */
function engrave(str, { o, du, dv, h, face, fill = null, dark = 0.3 }) {
  return (ctx, out) => {
    if (dot3(ctx.fn, face) < 0.7) return;
    const d = sub3(ctx.p, o);
    const k = textMask(str, dot3(d, du), dot3(d, dv), h, ctx.fw);
    if (k <= 0) return;
    if (fill) {
      out.c = mixc(out.c, hex(fill), k);
      out.m = lerp(out.m, 1, k);
      out.r = lerp(out.r, 0.25, k);
    } else {
      out.c = mixc(out.c, mulc(out.c, dark), k);
      out.r = lerp(out.r, Math.min(1, out.r + 0.3), k);
    }
  };
}

/** Diamond checkering in a 2D frame (u, v px): grooves darker, at `pitch` px. 0..1 groove. */
function checkerAt(u, v, pitch, fw, width = 0.16) {
  const a = (u + v) / pitch, b = (u - v) / pitch;
  const da = Math.abs(a - Math.round(a)), db = Math.abs(b - Math.round(b));
  const aa = (fw / pitch) * 0.8;
  return Math.max(1 - smoothstep(width - aa, width + aa, da), 1 - smoothstep(width - aa, width + aa, db));
}

/** Stripes across `u` (serrations, grooves) at `pitch` px, `width` of each groove (0..1 of the pitch). */
function stripesAt(u, pitch, fw, width = 0.45) {
  const a = u / pitch;
  const d = Math.abs(a - Math.floor(a) - 0.5);
  const aa = (fw / pitch) * 0.8;
  return 1 - smoothstep(width / 2 - aa, width / 2 + aa, d);
}

// ---------------------------------------------------------------------------------------------
// Normals, edges

/** Weld each part's corners by position; smooth normals across faces within SMOOTH (same group). */
function normals(part) {
  const cosMax = Math.cos(SMOOTH * DEG);
  const ids = new Map();
  const incident = [];
  const key = (p) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`;
  for (const t of part.tris) t.n = norm3(cross3(sub3(t.v[1].p, t.v[0].p), sub3(t.v[2].p, t.v[0].p)));
  part.tris.forEach((t, ti) =>
    t.v.forEach((v, k) => {
      const kk = key(v.p);
      let id = ids.get(kk);
      if (id === undefined) {
        id = incident.length;
        ids.set(kk, id);
        incident.push([]);
      }
      v.id = id;
      const a = v.p, b = t.v[(k + 1) % 3].p, c = t.v[(k + 2) % 3].p;
      incident[id].push([ti, Math.acos(clamp(dot3(norm3(sub3(b, a)), norm3(sub3(c, a))), -1, 1))]);
    }),
  );
  for (const t of part.tris)
    for (const v of t.v) {
      let s = [0, 0, 0];
      for (const [tj, ang] of incident[v.id]) {
        const o = part.tris[tj];
        if (o.sg !== t.sg || dot3(o.n, t.n) < cosMax) continue;
        s = add3(s, mul3(o.n, ang));
      }
      v.n = len3(s) > 1e-9 ? norm3(s) : t.n;
    }
}

/**
 * Hard edges of every part (faces meeting at over 25 degrees), convex or concave, in a grid for
 * quick distance queries by texel.
 */
function edgeGrid(parts) {
  const CELL = 0.5;
  const grid = new Map();
  const cell = (x, y, z) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
  const cosE = Math.cos(25 * DEG);
  parts.forEach((part, pi) => {
    const edges = new Map();
    part.tris.forEach((t) => {
      for (let k = 0; k < 3; k++) {
        const a = t.v[k], b = t.v[(k + 1) % 3];
        const kk = a.id < b.id ? `${a.id},${b.id}` : `${b.id},${a.id}`;
        let e = edges.get(kk);
        if (!e) edges.set(kk, (e = { a: a.p, b: b.p, tris: [] }));
        e.tris.push(t);
      }
    });
    for (const e of edges.values()) {
      if (e.tris.length !== 2) continue;
      const [t1, t2] = e.tris;
      if (dot3(t1.n, t2.n) > cosE) continue;
      const c2 = mul3(add3(add3(t2.v[0].p, t2.v[1].p), t2.v[2].p), 1 / 3);
      const convex = dot3(t1.n, sub3(c2, e.a)) < 0;
      const seg = { a: e.a, b: e.b, convex, part: pi };
      const R = 0.6;
      const lo = [0, 1, 2].map((k) => Math.floor((Math.min(e.a[k], e.b[k]) - R) / CELL));
      const hi = [0, 1, 2].map((k) => Math.floor((Math.max(e.a[k], e.b[k]) + R) / CELL));
      for (let x = lo[0]; x <= hi[0]; x++)
        for (let y = lo[1]; y <= hi[1]; y++)
          for (let z = lo[2]; z <= hi[2]; z++) {
            const kk = `${x},${y},${z}`;
            let l = grid.get(kk);
            if (!l) grid.set(kk, (l = []));
            l.push(seg);
          }
    }
  });
  return (p, pi) => {
    const l = grid.get(cell(p[0], p[1], p[2]));
    let ed = Infinity, cd = Infinity;
    if (!l) return { ed, cd };
    for (const s of l) {
      if (s.part !== pi) continue;
      const ab = sub3(s.b, s.a);
      const t = clamp(dot3(sub3(p, s.a), ab) / Math.max(1e-12, dot3(ab, ab)));
      const d = len3(sub3(p, add3(s.a, mul3(ab, t))));
      if (s.convex) ed = Math.min(ed, d);
      else cd = Math.min(cd, d);
    }
    return { ed, cd };
  };
}

// ---------------------------------------------------------------------------------------------
// Atlas: packing charts, rasterizing triangles, baking occlusion, painting

const PAD = 3;

/** Shelf-pack the charts at the largest texel density that fits W x H; set each chart's place(). */
function pack(charts, W, H) {
  for (const c of charts) {
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
    for (const t of c.tris)
      for (const v of t.v) {
        u0 = Math.min(u0, v.uv[0]);
        v0 = Math.min(v0, v.uv[1]);
        u1 = Math.max(u1, v.uv[0]);
        v1 = Math.max(v1, v.uv[1]);
      }
    Object.assign(c, { u0, v0, cw: u1 - u0, chh: v1 - v0 });
  }
  const tryPack = (D, commit) => {
    const rects = charts.map((c) => {
      const s = D * c.dens;
      let w = Math.ceil(c.cw * s) + 1, h = Math.ceil(c.chh * s) + 1;
      const rot = h > w;
      if (rot) [w, h] = [h, w];
      return { c, w: w + 2 * PAD, h: h + 2 * PAD, rot, s };
    });
    rects.sort((a, b) => b.h - a.h || b.w - a.w);
    let x = 0, y = 0, shelf = 0;
    for (const r of rects) {
      if (r.w > W) return false;
      if (x + r.w > W) {
        y += shelf;
        x = 0;
        shelf = 0;
      }
      if (y + r.h > H) return false;
      if (commit) {
        const { c, s, rot } = r;
        const ox = x + PAD + 0.5, oy = y + PAD + 0.5;
        c.place = rot ? (uv) => [ox + (uv[1] - c.v0) * s, oy + (uv[0] - c.u0) * s] : (uv) => [ox + (uv[0] - c.u0) * s, oy + (uv[1] - c.v0) * s];
      }
      x += r.w;
      shelf = Math.max(shelf, r.h);
    }
    return true;
  };
  let lo = 0.5, hi = 256;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (tryPack(mid, false)) lo = mid;
    else hi = mid;
  }
  if (!tryPack(lo, true)) throw new Error('atlas: nothing fits');
  return lo;
}

/** Which triangle (and where in it) each texel shows; texels just off a triangle's edge count too. */
function raster(tris, W, H) {
  const tri = new Int32Array(W * H).fill(-1);
  const dist = new Float32Array(W * H).fill(Infinity);
  const B1 = new Float32Array(W * H), B2 = new Float32Array(W * H);
  const near = (p, a, b) => {
    const ab = sub2(b, a);
    const t = clamp(dot2(sub2(p, a), ab) / Math.max(1e-12, dot2(ab, ab)));
    return [len2(sub2(p, [a[0] + ab[0] * t, a[1] + ab[1] * t])), t];
  };
  tris.forEach((t, ti) => {
    const [a, b, c] = t.v.map((v) => v.at);
    const d = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(d) < 1e-12) return;
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]) - 1.5)), x1 = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0]) + 1.5));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]) - 1.5)), y1 = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1]) + 1.5));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        let w1 = ((px - a[0]) * (c[1] - a[1]) - (py - a[1]) * (c[0] - a[0])) / d;
        let w2 = ((b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0])) / d;
        let dd = 0;
        if (w1 < 0 || w2 < 0 || w1 + w2 > 1) {
          const P = [px, py];
          const [dab, tab] = near(P, a, b), [dbc, tbc] = near(P, b, c), [dca, tca] = near(P, c, a);
          dd = Math.min(dab, dbc, dca);
          if (dd > 0.9) continue;
          if (dd === dab) [w1, w2] = [tab, 0];
          else if (dd === dbc) [w1, w2] = [1 - tbc, tbc];
          else [w1, w2] = [0, 1 - tca];
          dd += 1e-3;
        }
        const k = y * W + x;
        if (dd < dist[k]) {
          dist[k] = dd;
          tri[k] = ti;
          B1[k] = w1;
          B2[k] = w2;
        }
      }
  });
  return { tri, dist, B1, B2 };
}

/** A bounding-volume hierarchy of triangles, for occlusion rays. */
function bvh(tris) {
  const N = tris.length;
  const V = new Float64Array(N * 9);
  const C = new Float64Array(N * 3);
  tris.forEach((t, i) => {
    for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) V[i * 9 + k * 3 + a] = t.v[k].p[a];
    for (let a = 0; a < 3; a++) C[i * 3 + a] = (V[i * 9 + a] + V[i * 9 + 3 + a] + V[i * 9 + 6 + a]) / 3;
  });
  const order = Array.from({ length: N }, (_, i) => i);
  const nodes = [];
  const build = (s, e) => {
    const node = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], l: -1, r: -1, s, e };
    const cmin = [Infinity, Infinity, Infinity], cmax = [-Infinity, -Infinity, -Infinity];
    for (let i = s; i < e; i++) {
      const t = order[i];
      for (let k = 0; k < 3; k++)
        for (let a = 0; a < 3; a++) {
          node.min[a] = Math.min(node.min[a], V[t * 9 + k * 3 + a]);
          node.max[a] = Math.max(node.max[a], V[t * 9 + k * 3 + a]);
        }
      for (let a = 0; a < 3; a++) {
        cmin[a] = Math.min(cmin[a], C[t * 3 + a]);
        cmax[a] = Math.max(cmax[a], C[t * 3 + a]);
      }
    }
    const id = nodes.length;
    nodes.push(node);
    if (e - s > 4) {
      const ext = [0, 1, 2].map((a) => cmax[a] - cmin[a]);
      const ax = ext[0] >= ext[1] && ext[0] >= ext[2] ? 0 : ext[1] >= ext[2] ? 1 : 2;
      const sub = order.slice(s, e).sort((p, q) => C[p * 3 + ax] - C[q * 3 + ax]);
      for (let i = s; i < e; i++) order[i] = sub[i - s];
      const mid = (s + e) >> 1;
      node.l = build(s, mid);
      node.r = build(mid, e);
    }
    return id;
  };
  build(0, N);
  const stack = new Int32Array(128);
  /** Distance to the nearest hit along the ray (o, d) within tmax, or Infinity. */
  const cast = (o, d, tmax) => {
    let best = tmax;
    let sp = 0;
    stack[sp++] = 0;
    const ix = 1 / d[0], iy = 1 / d[1], iz = 1 / d[2];
    while (sp) {
      const nd = nodes[stack[--sp]];
      let t0 = (nd.min[0] - o[0]) * ix, t1 = (nd.max[0] - o[0]) * ix;
      if (t0 > t1) [t0, t1] = [t1, t0];
      let u0 = (nd.min[1] - o[1]) * iy, u1 = (nd.max[1] - o[1]) * iy;
      if (u0 > u1) [u0, u1] = [u1, u0];
      t0 = Math.max(t0, u0);
      t1 = Math.min(t1, u1);
      u0 = (nd.min[2] - o[2]) * iz;
      u1 = (nd.max[2] - o[2]) * iz;
      if (u0 > u1) [u0, u1] = [u1, u0];
      t0 = Math.max(t0, u0, 0);
      t1 = Math.min(t1, u1, best);
      if (t0 > t1) continue;
      if (nd.l >= 0) {
        stack[sp++] = nd.l;
        stack[sp++] = nd.r;
        continue;
      }
      for (let i = nd.s; i < nd.e; i++) {
        const b = order[i] * 9;
        const e1x = V[b + 3] - V[b], e1y = V[b + 4] - V[b + 1], e1z = V[b + 5] - V[b + 2];
        const e2x = V[b + 6] - V[b], e2y = V[b + 7] - V[b + 1], e2z = V[b + 8] - V[b + 2];
        const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det;
        const tx = o[0] - V[b], ty = o[1] - V[b + 1], tz = o[2] - V[b + 2];
        const u = (tx * px + ty * py + tz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (t > 1e-4 && t < best) best = t;
      }
    }
    return best < tmax ? best : Infinity;
  };
  return { cast };
}

/** Cosine-weighted directions about +z. */
const AO_DIRS = Array.from({ length: 20 }, (_, i) => {
  const r = Math.sqrt((i + 0.5) / 20), a = i * 2.399963;
  return [r * Math.cos(a), r * Math.sin(a), Math.sqrt(1 - r * r)];
});
const AO_REACH = 2.4;

/** Build one gun: normals, atlas, paint, mesh. */
function build(gun, { bakeAO = true } = {}) {
  for (const part of gun.parts) normals(part);
  const tris = [];
  gun.parts.forEach((part, pi) =>
    part.tris.forEach((t) => {
      t.part = pi;
      tris.push(t);
    }),
  );
  const edgeAt = edgeGrid(gun.parts);
  const charts = [];
  gun.parts.forEach((part) =>
    part.charts.forEach((c) => {
      if (!c.tris.length) return;
      c.dens = part.tex;
      c.id = charts.length;
      charts.push(c);
    }),
  );
  const W = gun.atlas, H = gun.atlas;
  const D = pack(charts, W, H);
  for (const c of charts)
    for (const t of c.tris)
      for (const v of t.v) {
        v.at = c.place(v.uv);
        v.tuv = [v.at[0] / W, v.at[1] / H];
      }
  const cov = raster(tris, W, H);

  // Where each covered texel is on the model.
  const at = (k) => {
    const t = tris[cov.tri[k]];
    const w1 = cov.B1[k], w2 = cov.B2[k], w0 = 1 - w1 - w2;
    const I = (f) => [0, 1, 2].map((a) => t.v[0][f][a] * w0 + t.v[1][f][a] * w1 + t.v[2][f][a] * w2);
    return { t, p: I('p'), lp: I('lp'), n: norm3(I('n')) };
  };

  // Ambient occlusion, baked at half resolution and spread back within each chart.
  const W2 = W >> 1, H2 = H >> 1;
  const ao2 = new Float32Array(W2 * H2).fill(-1);
  const ch2 = new Int32Array(W2 * H2).fill(-1);
  if (bakeAO) {
    const tree = bvh(tris);
    for (let J = 0; J < H2; J++)
      for (let I = 0; I < W2; I++) {
        let k = -1;
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const kk = (J * 2 + dy) * W + I * 2 + dx;
          if (cov.tri[kk] >= 0 && (k < 0 || cov.dist[kk] < cov.dist[k])) k = kk;
        }
        if (k < 0) continue;
        const { t, p } = at(k);
        const n = t.n;
        const o = add3(p, mul3(n, 0.02));
        const tx = norm3(cross3(Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], n));
        const ty = cross3(n, tx);
        const rot = hash(I, J, 7) * Math.PI * 2, cr = Math.cos(rot), sr = Math.sin(rot);
        let occ = 0;
        for (const [a, b, c] of AO_DIRS) {
          const x = a * cr - b * sr, y = a * sr + b * cr;
          const d = norm3(add3(add3(mul3(tx, x), mul3(ty, y)), mul3(n, c)));
          const hit = tree.cast(o, d, AO_REACH);
          if (hit < Infinity) occ += 1 - (hit / AO_REACH) ** 2;
        }
        ao2[J * W2 + I] = 1 - occ / AO_DIRS.length;
        ch2[J * W2 + I] = t.chart.id;
      }
    // One pass of blur within each chart.
    const src = ao2.slice();
    for (let J = 0; J < H2; J++)
      for (let I = 0; I < W2; I++) {
        const k = J * W2 + I;
        if (ch2[k] < 0) continue;
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const x = I + dx, y = J + dy;
            if (x < 0 || y < 0 || x >= W2 || y >= H2) continue;
            const kk = y * W2 + x;
            if (ch2[kk] !== ch2[k]) continue;
            const w = dx || dy ? 1 : 2;
            s += src[kk] * w;
            n += w;
          }
        ao2[k] = s / n;
      }
  }
  const aoAt = (x, y, chart) => {
    if (!bakeAO) return 1;
    const fx = (x + 0.5) / 2 - 0.5, fy = (y + 0.5) / 2 - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    let s = 0, n = 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const X = ix + dx, Y = iy + dy;
      if (X < 0 || Y < 0 || X >= W2 || Y >= H2) continue;
      const k = Y * W2 + X;
      if (ch2[k] !== chart) continue;
      const w = (dx ? fx - ix : 1 - (fx - ix)) * (dy ? fy - iy : 1 - (fy - iy));
      s += ao2[k] * w;
      n += w;
    }
    if (n > 1e-6) return s / n;
    const k = (y >> 1) * W2 + (x >> 1);
    return ch2[k] === chart ? ao2[k] : 1;
  };

  // Paint.
  const albedo = new Uint8Array(W * H * 3), mr = new Uint8Array(W * H * 3), emis = new Uint8Array(W * H);
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = y * W + x;
      if (cov.tri[k] < 0) continue;
      const { t, p, lp, n } = at(k);
      const part = gun.parts[t.part];
      const { ed, cd } = edgeAt(p, t.part);
      const ao = aoAt(x, y, t.chart.id);
      const ctx = { p, lp, n, fn: t.n, ed, cd, ao, fw: 1 / (D * part.tex), rnd: hash(x, y, 91), part };
      const out = part.mat(ctx);
      for (const d of part.decals) d(ctx, out);
      const occl = lerp(1, ao, 0.8 * part.ao * (1 - clamp(out.e)));
      albedo[k * 3] = clamp(out.c[0] * occl, 0, 255);
      albedo[k * 3 + 1] = clamp(out.c[1] * occl, 0, 255);
      albedo[k * 3 + 2] = clamp(out.c[2] * occl, 0, 255);
      mr[k * 3] = 255;
      mr[k * 3 + 1] = Math.round(clamp(out.r) * 255);
      mr[k * 3 + 2] = Math.round(clamp(out.m) * 255);
      emis[k] = Math.round(clamp(out.e) * 255);
      mask[k] = 1;
    }
  dilate([albedo, mr], [3, 3], [emis], mask, W, H);

  // Geometry: corners shared where position, normal and texture coordinate agree.
  const pos = [], nrm = [], uv = [], idx = [];
  const seen = new Map();
  for (const t of tris) {
    for (const v of t.v) {
      const key = `${v.p.map((a) => Math.round(a * 1e4)).join(',')}|${v.n.map((a) => Math.round(a * 1e4)).join(',')}|${v.tuv.map((a) => Math.round(a * 1e6)).join(',')}`;
      let i = seen.get(key);
      if (i === undefined) {
        i = pos.length / 3;
        seen.set(key, i);
        pos.push(v.p[0] / 16, v.p[1] / 16, v.p[2] / 16);
        nrm.push(...v.n);
        uv.push(v.tuv[0], v.tuv[1]);
      }
      idx.push(i);
    }
  }
  return { W, H, D, albedo, mr, emis, pos, nrm, uv, idx, tris, charts };
}

/** Fill the texels no chart covers from their neighbours (a few passes), then with the mean. */
function dilate(rgbs, chans, greys, mask, W, H) {
  const imgs = [...rgbs.map((d, i) => ({ d, c: chans[i] })), ...greys.map((d) => ({ d, c: 1 }))];
  let m = mask.slice();
  for (let pass = 0; pass < 10; pass++) {
    const next = m.slice();
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const k = y * W + x;
        if (m[k]) continue;
        let n = 0;
        const acc = imgs.map((im) => new Array(im.c).fill(0));
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const X = x + dx, Y = y + dy;
            if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
            const kk = Y * W + X;
            if (!m[kk]) continue;
            n++;
            imgs.forEach((im, i) => {
              for (let c = 0; c < im.c; c++) acc[i][c] += im.d[kk * im.c + c];
            });
          }
        if (!n) continue;
        imgs.forEach((im, i) => {
          for (let c = 0; c < im.c; c++) im.d[k * im.c + c] = Math.round(acc[i][c] / n);
        });
        next[k] = 1;
      }
    m = next;
  }
  for (const im of imgs) {
    const mean = new Array(im.c).fill(0);
    let n = 0;
    for (let k = 0; k < W * H; k++)
      if (mask[k]) {
        n++;
        for (let c = 0; c < im.c; c++) mean[c] += im.d[k * im.c + c];
      }
    for (let k = 0; k < W * H; k++) if (!m[k]) for (let c = 0; c < im.c; c++) im.d[k * im.c + c] = Math.round(mean[c] / Math.max(1, n));
  }
}

// ---------------------------------------------------------------------------------------------
// Image encoding: PNG (filtered, grey or RGB) and baseline JPEG

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** A PNG of `ch` channels (1 grey, 3 RGB), each row filtered with whichever filter packs best. */
function png(data, w, h, ch) {
  const stride = w * ch;
  const raw = Buffer.alloc((stride + 1) * h);
  const cand = Array.from({ length: 5 }, () => Buffer.alloc(stride));
  for (let y = 0; y < h; y++) {
    const row = data.subarray(y * stride, (y + 1) * stride);
    const up = y ? data.subarray((y - 1) * stride, y * stride) : null;
    let best = 0, bestS = Infinity;
    for (let f = 0; f < 5; f++) {
      const out = cand[f];
      let s = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= ch ? row[i - ch] : 0, b = up ? up[i] : 0, c = up && i >= ch ? up[i - ch] : 0;
        let pr;
        if (f === 0) pr = 0;
        else if (f === 1) pr = a;
        else if (f === 2) pr = b;
        else if (f === 3) pr = (a + b) >> 1;
        else {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        const v = (row[i] - pr) & 0xff;
        out[i] = v;
        s += v < 128 ? v : 256 - v;
      }
      if (s < bestS) {
        bestS = s;
        best = f;
      }
    }
    raw[y * (stride + 1)] = best;
    cand[best].copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = ch === 1 ? 0 : 2;
  return Buffer.concat([PNG_SIG, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))]);
}

const ZIGZAG = (() => {
  const z = [];
  for (let s = 0; s < 15; s++) {
    if (s % 2 === 0) for (let i = Math.min(s, 7); i >= Math.max(0, s - 7); i--) z.push(i * 8 + (s - i));
    else for (let i = Math.max(0, s - 7); i <= Math.min(s, 7); i++) z.push(i * 8 + (s - i));
  }
  return z;
})();
const Q_LUM = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const Q_CHR = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, ...new Array(32).fill(99)];
const HUFF = {
  dcL: [[0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]],
  dcC: [[0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]],
  acL: [
    [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d],
    [
      0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a,
      0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78,
      0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6,
      0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
    ],
  ],
  acC: [
    [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77],
    [
      0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17,
      0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77,
      0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4,
      0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
    ],
  ],
};
const DCT_C = Array.from({ length: 8 }, (_, u) => Array.from({ length: 8 }, (_, x) => ((u ? 1 : Math.SQRT1_2) * Math.cos(((2 * x + 1) * u * Math.PI) / 16)) / 2));

/** A baseline JPEG of an RGB image (standard tables scaled to `quality`; 4:2:0 chroma if `sub`). */
function jpeg(rgb, w, h, quality = 88, sub = true) {
  const sc = quality < 50 ? 5000 / quality : 200 - quality * 2;
  const qt = (b) => b.map((v) => clamp(Math.floor((v * sc + 50) / 100), 1, 255));
  const QL = qt(Q_LUM), QC = qt(Q_CHR);
  const table = ([bits, vals]) => {
    const code = new Map();
    let c = 0, k = 0;
    for (let l = 1; l <= 16; l++) {
      for (let i = 0; i < bits[l - 1]; i++) code.set(vals[k++], [c++, l]);
      c <<= 1;
    }
    return code;
  };
  const T = { dcL: table(HUFF.dcL), dcC: table(HUFF.dcC), acL: table(HUFF.acL), acC: table(HUFF.acC) };
  const out = [];
  let acc = 0, nb = 0;
  const put = (code, size) => {
    for (let i = size - 1; i >= 0; i--) {
      acc = (acc << 1) | ((code >> i) & 1);
      if (++nb === 8) {
        out.push(acc);
        if (acc === 0xff) out.push(0);
        acc = 0;
        nb = 0;
      }
    }
  };
  const sym = (tab, s) => {
    const e = tab.get(s);
    put(e[0], e[1]);
  };
  const cat = (v) => {
    v = Math.abs(v);
    let n = 0;
    while (v) {
      n++;
      v >>= 1;
    }
    return n;
  };
  const tmp = new Float64Array(64), F = new Float64Array(64), q = new Int32Array(64);
  const encode = (blk, Q, dc, ac, prev) => {
    for (let y = 0; y < 8; y++)
      for (let u = 0; u < 8; u++) {
        let s = 0;
        for (let x = 0; x < 8; x++) s += blk[y * 8 + x] * DCT_C[u][x];
        tmp[y * 8 + u] = s;
      }
    for (let v = 0; v < 8; v++)
      for (let u = 0; u < 8; u++) {
        let s = 0;
        for (let y = 0; y < 8; y++) s += tmp[y * 8 + u] * DCT_C[v][y];
        F[v * 8 + u] = s;
      }
    for (let k = 0; k < 64; k++) q[k] = Math.max(-1023, Math.min(1023, Math.round(F[ZIGZAG[k]] / Q[ZIGZAG[k]])));
    const diff = q[0] - prev;
    const c = cat(diff);
    sym(dc, c);
    if (c) put(diff < 0 ? diff + (1 << c) - 1 : diff, c);
    let run = 0;
    for (let k = 1; k < 64; k++) {
      if (!q[k]) {
        run++;
        continue;
      }
      while (run > 15) {
        sym(ac, 0xf0);
        run -= 16;
      }
      const c2 = cat(q[k]);
      sym(ac, (run << 4) | c2);
      put(q[k] < 0 ? q[k] + (1 << c2) - 1 : q[k], c2);
      run = 0;
    }
    if (run) sym(ac, 0);
    return q[0];
  };
  const px = (x, y) => {
    const k = (Math.min(h - 1, y) * w + Math.min(w - 1, x)) * 3;
    const r = rgb[k], g = rgb[k + 1], b = rgb[k + 2];
    return [0.299 * r + 0.587 * g + 0.114 * b - 128, -0.168736 * r - 0.331264 * g + 0.5 * b, 0.5 * r - 0.418688 * g - 0.081312 * b];
  };
  const Y = new Float64Array(64), Cb = new Float64Array(64), Cr = new Float64Array(64);
  let pY = 0, pB = 0, pR = 0;
  const MCU = sub ? 16 : 8;
  for (let my = 0; my < h; my += MCU)
    for (let mx = 0; mx < w; mx += MCU) {
      if (sub) {
        for (const [bx, by] of [[0, 0], [8, 0], [0, 8], [8, 8]]) {
          for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) Y[y * 8 + x] = px(mx + bx + x, my + by + y)[0];
          pY = encode(Y, QL, T.dcL, T.acL, pY);
        }
        for (let y = 0; y < 8; y++)
          for (let x = 0; x < 8; x++) {
            let b = 0, r = 0;
            for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
              const c = px(mx + x * 2 + dx, my + y * 2 + dy);
              b += c[1];
              r += c[2];
            }
            Cb[y * 8 + x] = b / 4;
            Cr[y * 8 + x] = r / 4;
          }
      } else {
        for (let y = 0; y < 8; y++)
          for (let x = 0; x < 8; x++) {
            const c = px(mx + x, my + y);
            Y[y * 8 + x] = c[0];
            Cb[y * 8 + x] = c[1];
            Cr[y * 8 + x] = c[2];
          }
        pY = encode(Y, QL, T.dcL, T.acL, pY);
      }
      pB = encode(Cb, QC, T.dcC, T.acC, pB);
      pR = encode(Cr, QC, T.dcC, T.acC, pR);
    }
  if (nb) put((1 << (8 - nb)) - 1, 8 - nb);
  const seg = (marker, body) => {
    const b = Buffer.alloc(4 + body.length);
    b.writeUInt16BE(marker, 0);
    b.writeUInt16BE(body.length + 2, 2);
    Buffer.from(body).copy(b, 4);
    return b;
  };
  const dht = [];
  for (const [cls, [bits, vals]] of [[0x00, HUFF.dcL], [0x10, HUFF.acL], [0x01, HUFF.dcC], [0x11, HUFF.acC]]) dht.push(cls, ...bits, ...vals);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xffe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    seg(0xffdb, [0, ...ZIGZAG.map((i) => QL[i]), 1, ...ZIGZAG.map((i) => QC[i])]),
    seg(0xffc0, [8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, sub ? 0x22 : 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]),
    seg(0xffc4, dht),
    seg(0xffda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]),
    Buffer.from(out),
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** Halve an RGB image (box filter). */
function halve(rgb, w, h) {
  const W = w >> 1, H = h >> 1;
  const out = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      for (let c = 0; c < 3; c++) {
        const s = rgb[((y * 2) * w + x * 2) * 3 + c] + rgb[((y * 2) * w + x * 2 + 1) * 3 + c] + rgb[((y * 2 + 1) * w + x * 2) * 3 + c] + rgb[((y * 2 + 1) * w + x * 2 + 1) * 3 + c];
        out[(y * W + x) * 3 + c] = (s + 2) >> 2;
      }
  return out;
}

// ---------------------------------------------------------------------------------------------
// GLB writing

function glb(gun, b) {
  const chunks = [];
  let offset = 0;
  const views = [];
  const addView = (buf, target) => {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      offset += pad;
    }
    views.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, ...(target ? { target } : {}) });
    chunks.push(buf);
    offset += buf.length;
    return views.length - 1;
  };
  const f32 = (a) => Buffer.from(new Float32Array(a).buffer);
  const vcount = b.pos.length / 3;
  const big = vcount > 65535;
  const posView = addView(f32(b.pos), 34962);
  const nrmView = addView(f32(b.nrm), 34962);
  // Texture coordinates as normalized unsigned shorts (core glTF): half the size, 1/65535 steps.
  const uvView = addView(Buffer.from(new Uint16Array(b.uv.map((v) => Math.round(clamp(v) * 65535))).buffer), 34962);
  const idxView = addView(Buffer.from((big ? new Uint32Array(b.idx) : new Uint16Array(b.idx)).buffer), 34963);
  const jA = jpeg(b.albedo, b.W, b.H, gun.quality ?? 82, true);
  const jM = jpeg(halve(b.mr, b.W, b.H), b.W >> 1, b.H >> 1, 80, false);
  const pE = png(b.emis, b.W, b.H, 1);
  const imgA = addView(jA);
  const imgM = addView(jM);
  const imgE = addView(pE);
  b.bytes = { geometry: offset - jA.length - jM.length - pE.length, basecolor: jA.length, mr: jM.length, emissive: pE.length };
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < b.pos.length; k++) {
    min[k % 3] = Math.min(min[k % 3], Math.fround(b.pos[k]));
    max[k % 3] = Math.max(max[k % 3], Math.fround(b.pos[k]));
  }
  const markerNames = Object.keys(gun.markers);
  const json = {
    asset: { version: '2.0', generator: 'Call of Blocky src/games/callofblocky/tools/guns/build.mjs' },
    scene: 0,
    scenes: [{ name: gun.id, nodes: [0] }],
    nodes: [
      { name: gun.id, children: [1, ...markerNames.map((_, k) => k + 2)], extras: { title: gun.name } },
      { name: `${gun.id}_body`, mesh: 0 },
      ...markerNames.map((m) => ({ name: m, translation: gun.markers[m].map((v) => v / 16) })),
    ],
    meshes: [{ name: `${gun.id}_body`, primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0, mode: 4 }] }],
    materials: [
      {
        name: `${gun.id}_atlas`,
        pbrMetallicRoughness: { baseColorTexture: { index: 0 }, baseColorFactor: [1, 1, 1, 1], metallicRoughnessTexture: { index: 1 }, metallicFactor: 1, roughnessFactor: 1 },
        emissiveTexture: { index: 2 },
        emissiveFactor: [1, 1, 1],
      },
    ],
    textures: [
      { sampler: 0, source: 0 },
      { sampler: 0, source: 1 },
      { sampler: 0, source: 2 },
    ],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    images: [
      { name: `${gun.id}_basecolor`, bufferView: imgA, mimeType: 'image/jpeg' },
      { name: `${gun.id}_metallic_roughness`, bufferView: imgM, mimeType: 'image/jpeg' },
      { name: `${gun.id}_emissive`, bufferView: imgE, mimeType: 'image/png' },
    ],
    accessors: [
      { bufferView: posView, componentType: 5126, count: vcount, type: 'VEC3', min, max },
      { bufferView: nrmView, componentType: 5126, count: vcount, type: 'VEC3' },
      { bufferView: uvView, componentType: 5123, normalized: true, count: vcount, type: 'VEC2' },
      { bufferView: idxView, componentType: big ? 5125 : 5123, count: b.idx.length, type: 'SCALAR' },
    ],
    bufferViews: views,
    buffers: [{ byteLength: 0 }],
  };
  const tail = (4 - (offset % 4)) % 4;
  if (tail) chunks.push(Buffer.alloc(tail));
  const bin = Buffer.concat(chunks);
  json.buffers[0].byteLength = bin.length;
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jpad = (4 - (jsonBuf.length % 4)) % 4;
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jpad, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, jsonBuf, bh, bin]);
}

// ---------------------------------------------------------------------------------------------
// Validation: parse a GLB back and check it.

function validate(buf, gun) {
  const fail = (m) => {
    throw new Error(`${gun.id}.glb: ${m}`);
  };
  if (buf.readUInt32LE(0) !== 0x46546c67) fail('bad magic');
  if (buf.readUInt32LE(4) !== 2) fail('not version 2');
  if (buf.readUInt32LE(8) !== buf.length) fail('length mismatch');
  const jlen = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a || jlen % 4) fail('bad JSON chunk');
  const json = JSON.parse(buf.subarray(20, 20 + jlen).toString('utf8'));
  const bo = 20 + jlen;
  const blen = buf.readUInt32LE(bo);
  if (buf.readUInt32LE(bo + 4) !== 0x004e4942 || blen % 4 || bo + 8 + blen !== buf.length) fail('bad BIN chunk');
  const bin = buf.subarray(bo + 8, bo + 8 + blen);
  if (json.asset?.version !== '2.0') fail('asset.version');
  if (json.buffers[0].byteLength !== blen) fail('buffer length');
  for (const v of json.bufferViews) if (v.byteOffset + v.byteLength > blen || v.byteOffset % 4) fail('bufferView out of range or unaligned');
  const size = { SCALAR: 1, VEC2: 2, VEC3: 3 };
  const comp = { 5126: 4, 5123: 2, 5125: 4 };
  const read = (a) => {
    const v = json.bufferViews[a.bufferView];
    const n = a.count * size[a.type];
    if ((a.byteOffset ?? 0) + n * comp[a.componentType] > v.byteLength) fail('accessor out of range');
    const at = bin.byteOffset + v.byteOffset + (a.byteOffset ?? 0);
    const ab = bin.buffer.slice(at, at + n * comp[a.componentType]);
    return a.componentType === 5126 ? new Float32Array(ab) : a.componentType === 5123 ? new Uint16Array(ab) : new Uint32Array(ab);
  };
  if (json.meshes.length !== 1 || json.meshes[0].primitives.length !== 1) fail('one mesh, one primitive');
  if (json.materials.length !== 1) fail('one material');
  const mat = json.materials[0];
  const pbr = mat.pbrMetallicRoughness;
  if (!pbr?.baseColorTexture || !pbr.metallicRoughnessTexture || !mat.emissiveTexture) fail('material textures missing');
  if (pbr.metallicFactor !== 1 || pbr.roughnessFactor !== 1) fail('metallic/roughness factors must be 1');
  const prim = json.meshes[0].primitives[0];
  const P = read(json.accessors[prim.attributes.POSITION]);
  const N = read(json.accessors[prim.attributes.NORMAL]);
  const T = read(json.accessors[prim.attributes.TEXCOORD_0]);
  const I = read(json.accessors[prim.indices]);
  const pa = json.accessors[prim.attributes.POSITION];
  for (let k = 0; k < 3; k++) {
    let lo = Infinity, hi = -Infinity;
    for (let m = k; m < P.length; m += 3) {
      lo = Math.min(lo, P[m]);
      hi = Math.max(hi, P[m]);
    }
    if (lo !== pa.min[k] || hi !== pa.max[k]) fail(`POSITION min/max wrong on axis ${k}`);
  }
  for (let m = 0; m < N.length; m += 3) if (Math.abs(Math.hypot(N[m], N[m + 1], N[m + 2]) - 1) > 1e-4) fail('normal not unit');
  const ta = json.accessors[prim.attributes.TEXCOORD_0];
  if (!(ta.componentType === 5126 || (ta.componentType === 5123 && ta.normalized))) fail('TEXCOORD_0 must be float or normalized unsigned short');
  if (ta.componentType === 5126) for (const t of T) if (!(t >= 0 && t <= 1)) fail('uv out of range');
  if (ta.count !== pa.count || json.accessors[prim.attributes.NORMAL].count !== pa.count) fail('attribute counts differ');
  for (const i of I) if (i >= pa.count) fail('index out of range');
  if (I.length % 3) fail('index count');
  // Every triangle faces the way its corners' normals say.
  let bad = 0;
  for (let m = 0; m < I.length; m += 3) {
    const [a, b2, c] = [I[m], I[m + 1], I[m + 2]].map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
    const cr = cross3(sub3(b2, a), sub3(c, a));
    for (let k = 0; k < 3; k++) {
      const i = I[m + k];
      if (dot3(cr, [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]]) <= 0) bad++;
    }
  }
  if (bad) fail(`${bad} triangle corners face against their normals`);
  const imgs = json.images.map((img) => {
    const v = json.bufferViews[img.bufferView];
    return { img, data: bin.subarray(v.byteOffset, v.byteOffset + v.byteLength) };
  });
  for (const { img, data } of imgs) {
    if (img.mimeType === 'image/png') {
      if (!data.subarray(0, 8).equals(PNG_SIG)) fail('image is not a PNG');
      const w = data.readUInt32BE(16), h = data.readUInt32BE(20), ct = data[25];
      const ch = { 0: 1, 2: 3, 6: 4 }[ct];
      let o = 8;
      const idat = [];
      while (o < data.length) {
        const len = data.readUInt32BE(o);
        const type = data.subarray(o + 4, o + 8).toString('ascii');
        if (crc32(data.subarray(o + 4, o + 8 + len)) !== data.readUInt32BE(o + 8 + len)) fail('PNG CRC');
        if (type === 'IDAT') idat.push(data.subarray(o + 8, o + 8 + len));
        o += 12 + len;
      }
      if (inflateSync(Buffer.concat(idat)).length !== (w * ch + 1) * h) fail('PNG data size');
    } else if (img.mimeType === 'image/jpeg') {
      if (data[0] !== 0xff || data[1] !== 0xd8 || data[data.length - 2] !== 0xff || data[data.length - 1] !== 0xd9) fail('JPEG SOI/EOI');
      let o = 2, sof = null, sos = false;
      while (o < data.length && !sos) {
        if (data[o] !== 0xff) fail('JPEG marker');
        const mk = data[o + 1], len = data.readUInt16BE(o + 2);
        if (mk === 0xc0) sof = { h: data.readUInt16BE(o + 5), w: data.readUInt16BE(o + 7), n: data[o + 9] };
        if (mk === 0xda) sos = true;
        o += 2 + len;
      }
      if (!sof || !sos || sof.n !== 3) fail('JPEG frame');
      for (let k = o; k < data.length - 2; k++) if (data[k] === 0xff && data[k + 1] !== 0 && !(data[k + 1] >= 0xd0 && data[k + 1] <= 0xd7)) fail('JPEG stray marker in scan');
    } else fail(`image type ${img.mimeType}`);
  }
  const s = json.samplers[0];
  if (s.magFilter !== 9729 || s.minFilter !== 9987) fail('sampler not LINEAR / LINEAR_MIPMAP_LINEAR');
  const names = json.nodes.map((n) => n.name);
  for (const m of Object.keys(gun.markers)) if (!names.includes(m)) fail(`marker ${m} missing`);
  return json;
}

// ---------------------------------------------------------------------------------------------
// Optics: an open window is clear

/**
 * How far behind the `sight` point the eye is when aiming, in model pixels: the platform holds the
 * sight 0.3 blocks in front of the eye with the gun at scale 0.42 (0.3 / 0.42 * 16).
 */
const EYE_BACK = 11.4;

/** Clip a polygon (3D points) to the side of the plane p[axis] >= c (or <= c when `below`). */
function clipPlane(poly, axis, c, below = false) {
  const inside = (p) => (below ? p[axis] <= c : p[axis] >= c);
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ia = inside(a), ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (c - a[axis]) / (b[axis] - a[axis]);
      out.push(a.map((v, k) => v + (b[k] - v) * t));
    }
  }
  return out;
}
/** Clip a 2D polygon by a convex counter-clockwise one. */
function clipConvex(poly, clip) {
  let out = poly;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const inp = out;
    out = [];
    for (let k = 0; k < inp.length; k++) {
      const p = inp[k], q = inp[(k + 1) % inp.length];
      const sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  return out;
}

/**
 * An optic's window (`gun.window`: a convex counter-clockwise polygon `poly` in x-y, from its rear
 * `z0` to its front `z1`) must be open: no geometry inside it, and from the aiming eye (on the
 * sight line, EYE_BACK behind `z0`) nothing shows through it, beyond its front opening or between
 * the eye and its rear. Returns what's in the way.
 */
function clearView(gun, tris) {
  const win = gun.window;
  if (!win) return [];
  const bad = [];
  const P = inset(win.poly, 0.03);
  const s = gun.markers.sight;
  const eye = [s[0], s[1], win.z0 - EYE_BACK];
  const area = (poly) => Math.abs(area2(poly));
  const project = (poly, plane) =>
    poly.map((q) => {
      const t = (plane - eye[2]) / (q[2] - eye[2]);
      return [eye[0] + (q[0] - eye[0]) * t, eye[1] + (q[1] - eye[1]) * t];
    });
  for (const t of tris) {
    const tri = t.v.map((v) => v.p);
    const name = `${gun.parts[t.part].name || `part ${t.part}`}`;
    // In the tunnel.
    let q = clipPlane(clipPlane(tri, 2, win.z0 + 0.03), 2, win.z1 - 0.03, true);
    if (q.length >= 3 && area(clipConvex(q.map((p) => [p[0], p[1]]), P)) > 1e-4) {
      bad.push(`${name} is in the window`);
      continue;
    }
    // Beyond its front, seen through it.
    q = clipPlane(tri, 2, win.z1 + 0.03);
    if (q.length >= 3 && area(clipConvex(project(q, win.z1), P)) > 1e-4) {
      bad.push(`${name} shows through the window`);
      continue;
    }
    // Between the eye and its rear.
    q = clipPlane(clipPlane(tri, 2, eye[2] + 0.5), 2, win.z0 - 0.03, true);
    if (q.length >= 3 && area(clipConvex(project(q, win.z0), P)) > 1e-4) bad.push(`${name} blocks the window from behind`);
  }
  return [...new Set(bad)];
}

// ---------------------------------------------------------------------------------------------
// Shared parts and details

/** A lathe built along z, turned to run along -x, then moved to `at`. */
const alongNegX = (part, at) => part.turn('y', -90).move(...at);

/** Knurling on a lathe part (its own axis z), where `when(ctx)`: a fine diamond of cuts. */
const knurl = (when = () => true, pitch = 0.16, dark = 0.45) => (ctx, out) => {
  if (!when(ctx)) return;
  const [x, y, z] = ctx.lp;
  const r = Math.hypot(x, y);
  if (r < 0.05) return;
  const N = Math.max(6, Math.round((2 * Math.PI * r) / pitch));
  const u = (Math.atan2(y, x) / (2 * Math.PI)) * N * pitch;
  const k = checkerAt(u, z, pitch, ctx.fw, 0.2);
  out.c = mixc(out.c, mulc(out.c, dark), k);
  out.r = lerp(out.r, Math.min(1, out.r + 0.25), k);
};

/** A round-headed screw or rivet facing along `axis` ('x', '-x', 'y', '-y', 'z', '-z') at `at`. */
function screw(at, { r = 0.16, hgt = 0.08, axis = 'x', mat = M.steel, slot = true, sides = 8 } = {}) {
  const head = lathe([[r, 0], [r, hgt * 0.4], [r * 0.62, hgt], [0, hgt * 1.12]], { sides, mat });
  if (slot) head.decal((ctx, out) => Math.abs(ctx.lp[1]) < r * 0.16 && ctx.lp[2] > hgt * 0.35 && (out.c = mulc(out.c, 0.3)));
  if (axis === 'x') return alongX(head, at);
  if (axis === '-x') return alongNegX(head, at);
  if (axis === 'y') return alongY(head, at);
  if (axis === '-y') return head.turn('x', 90).move(...at);
  if (axis === '-z') return head.turn('y', 180).move(...at);
  return head.move(...at);
}
/** The same screw on both sides (x = ±at[0]). */
const screwPair = (at, o = {}) => [screw(at, { ...o, axis: 'x' }), screw([-at[0], at[1], at[2]], { ...o, axis: '-x' })];

/** An ejection port on the right (-x) faces: a dark opening z0..z1, y0..y1 showing `inside`, a bright cut lip. */
const port = (z0, z1, y0, y1, inside = [40, 42, 46]) => (ctx, out) => {
  if (ctx.fn[0] > -0.45) return;
  const [, y, z] = ctx.p;
  if (z < z0 || z > z1 || y < y0 || y > y1) return;
  const e = Math.min(z - z0, z1 - z, y - y0, y1 - y);
  if (e < 0.06) {
    out.c = mixc(out.c, [205, 208, 214], 0.65);
    out.r = 0.2;
    out.m = 1;
    return;
  }
  const deep = smoothstep(0.06, 0.35, e);
  out.c = mixc(inside, [10, 10, 12], clamp(deep * 0.35 + (y > y1 - 0.3 ? 0.55 : 0)));
  out.r = 0.45;
  out.m = 0.7;
};

/** A picatinny rail along z (z0..z1) sitting on y: a spine and a row of teeth, `w` wide. */
function rail(z0, z1, y, { w = 1.7, h = 0.55, pitch = 0.62, mat = M.anod, tex = 1 } = {}) {
  const parts = [];
  const sp = h * 0.45;
  parts.push(along([[-w * 0.36, y], [w * 0.36, y], [w * 0.36, y + sp], [-w * 0.36, y + sp]], z0, z1, { mat, bevel: 0.06, tex }));
  const tooth = [[-w * 0.36, y + sp - 0.05], [w * 0.36, y + sp - 0.05], [w * 0.5, y + h * 0.7], [w * 0.42, y + h], [-w * 0.42, y + h], [-w * 0.5, y + h * 0.7]];
  const n = Math.max(1, Math.floor((z1 - z0 - 0.1) / pitch));
  const start = z0 + (z1 - z0 - n * pitch) / 2 + pitch * 0.21;
  for (let i = 0; i < n; i++) parts.push(along(tooth, start + i * pitch, start + i * pitch + pitch * 0.58, { mat, tex }));
  return parts;
}

/**
 * An open reflex sight (a big-window holo, Holosun 510C style): a window `w` x `h` px (x
 * -w/2..w/2, y `y`..`y + h`) inside a slim frame `wall` px thick and `frame` px deep (from its rear
 * at `z`), standing on a long low base `body` px tall that runs `len` px forward (its top is the
 * window's floor; ahead of the frame it steps down out of the view). Buttons on the base's left,
 * a battery tray on its right, a clamp down to the rail top `base`. The frame in `hoodMat`, the
 * base black. Sets the gun's window and returns the `sight` point (the window's centre at its rear).
 */
function holo(g, { y, z, w, h, len, frame = 1.2, wall = 0.42, body = 1.3, base, hoodMat, bodyMat = M.anod, tex = 1.5 }) {
  const hw = w / 2, o = hw + wall, z1 = z + frame;
  g.window = { poly: [[-hw, y], [hw, y], [hw, y + h], [-hw, y + h]], z0: z, z1 };
  // The frame: a U round the window, its top a little heavier, rounded outside.
  g.add('holo frame', along([[o, y - 0.1], [o, y + h + wall + 0.08, 0.55], [-o, y + h + wall + 0.08, 0.55], [-o, y - 0.1], [-hw, y - 0.1], [-hw, y + h], [hw, y + h], [hw, y - 0.1]], z, z1, { mat: hoodMat, bevel: 0.1, tex }));
  // The base: under the window, then stepping down and running on to a rounded nose.
  const zn = z + len, yl = y - body * 0.5;
  // Its sloped back (what the eye sees below the window when aiming) carries two rubber buttons.
  const buttons = (ctx, out) => {
    if (ctx.fn[2] > -0.5 || ctx.p[2] > z + 0.1) return;
    for (const bx of [-0.95, 0.95]) {
      const d = Math.hypot(ctx.p[0] - bx, ctx.p[1] - (y - body * 0.5));
      if (d < 0.3) Object.assign(out, d > 0.24 ? { c: [70, 72, 78], m: 0.6, r: 0.3, e: 0 } : { c: [38, 38, 40], m: 0, r: 0.85, e: 0 });
    }
  };
  g.add('holo base', side([[z - 0.7, y - body], [zn, y - body, 0.25], [zn, yl, 0.3], [z1 + 0.45, yl, 0.2], [z1 + 0.05, y], [z - 0.05, y]], 2 * o - 0.1, { mat: bodyMat, bevel: 0.1, tex, decals: [buttons] }));
  for (const zz of [z1 + 0.9, z1 + 1.6]) g.add('holo button', alongX(cyl(0.2, 0, 0.1, { sides: 10, bevel: 0.04, open: true, mat: M.rubber }), [o - 0.05, y - body * 0.72, zz]));
  g.add('holo battery tray', side([[z1 + 0.5, y - body + 0.15, 0.1], [zn - 0.35, y - body + 0.15, 0.1], [zn - 0.35, yl - 0.15, 0.1], [z1 + 0.5, yl - 0.15, 0.1]], 0.12, { x: -o + 0.05, mat: bodyMat, bevel: 0.04 }));
  if (base !== undefined && base < y - body) {
    g.add('holo mount', box([-o + 0.55, base, z + 0.1], [o - 0.55, y - body + 0.05, zn - 0.4], { mat: M.anod, bevel: 0.1 }));
    g.add('holo clamp nut', alongX(lathe([[0, 0], [0.34, 0], [0.34, 0.2], [0.26, 0.28], [0, 0.28]], { sides: 6, mat: M.steel }), [o - 0.55, (base + y - body) / 2, (z + zn) / 2]));
  }
  return [0, y + h / 2, z];
}

/** Checkering on a raked grip's sides (grip-local z0..z1, y0..y1), with a plain border. */
const gripChecker = (rake, [z0, z1], [y0, y1], pitch = 0.2) => (ctx, out) => {
  if (Math.abs(ctx.fn[0]) < 0.75) return;
  const [, ly, lz] = turn(ctx.p, 'x', -rake);
  if (lz < z0 || lz > z1 || ly < y0 || ly > y1) return;
  const border = Math.min(lz - z0, z1 - lz, ly - y0, y1 - ly);
  if (border < 0.08) {
    if (border < 0.05) out.c = mulc(out.c, 0.55);
    return;
  }
  const k = checkerAt(lz, ly, pitch, ctx.fw, 0.2);
  out.c = mixc(out.c, mulc(out.c, 0.42), k);
  out.r = lerp(out.r, Math.min(1, out.r + 0.3), k);
};

/** A white spacer line where a recoil pad meets the stock (the pad's front `z0`, `w` px of it). */
const spacer = (z0, w = 0.1) => (ctx, out) => {
  if (ctx.p[2] < z0 - w || Math.abs(ctx.fn[2]) > 0.8) return;
  out.c = [226, 222, 212];
  out.r = 0.45;
};

// ---------------------------------------------------------------------------------------------
// The guns

class Gun {
  constructor(id, name, o = {}) {
    this.id = id;
    this.name = name;
    this.parts = [];
    this.markers = {};
    this.atlas = o.atlas ?? 1024;
    this.quality = o.quality;
    this.window = null;
  }
  /** Add parts (named, for reports). */
  add(name, ...parts) {
    for (const p of parts.flat()) {
      p.name = name;
      this.parts.push(p);
    }
    return parts[0];
  }
  mark(name, p) {
    this.markers[name] = p;
    return this;
  }
}

/** Lucky 45: a 1911 with a mirror-nickel slide, a blued frame, pearl grips, gold touches and a mini red dot. */
function pistol() {
  const g = new Gun('pistol', 'Lucky 45');
  const G = raked(15);
  // The frame: dust cover, trigger slot, the raked grip frame and the beavertail, one side profile.
  const straps = (ctx, out) => {
    const [lx, ly] = turn(ctx.p, 'x', -15);
    if (ly > 1.1 || ly < -2.7 || Math.abs(ctx.fn[0]) > 0.5 || Math.abs(lx) > 0.62) return;
    const k = checkerAt(lx, ly, 0.2, ctx.fw, 0.2);
    out.c = mixc(out.c, mulc(out.c, 0.45), k);
    out.r = lerp(out.r, 0.6, k);
  };
  g.add(
    'frame',
    side(
      [
        [-2.3, 3.1], [6.35, 3.1], [6.45, 2.4, 0.12], [4.7, 2.22, 0.1], [2.45, 2.12, 0.25], G(1.45, 1.35, 0.35), G(1.45, -2.45, 0.2), G(1.3, -2.85, 0.12),
        G(-1.3, -2.85, 0.12), G(-1.6, -2.4, 0.25), G(-1.72, -0.6, 0.5), G(-1.58, 1.15, 0.35), [-2.55, 2.0, 0.3], [-3.35, 2.4, 0.2], [-3.3, 2.78, 0.15], [-2.45, 2.8, 0.15],
      ],
      1.5,
      { mat: M.blued, bevel: 0.1, decals: [straps] },
    ),
  );
  // The slide: flat sides, a rounded top; serrations at the back, the port on the right, roll marks on the left.
  const serrations = (ctx, out) => {
    const [, y, z] = ctx.p;
    if (Math.abs(ctx.fn[0]) > 0.8 && z < -0.55 && z > -2.3 && y > 3.12 && y < 4.55) {
      const k = stripesAt(z + 10, 0.2, ctx.fw, 0.42);
      out.c = mixc(out.c, mulc(out.c, 0.42), k);
      out.r = lerp(out.r, 0.45, k);
    }
  };
  g.add(
    'slide',
    along([[-0.9, 3.0, 0.06], [0.9, 3.0, 0.06], [0.9, 4.95, 0.5], [-0.9, 4.95, 0.5]], -2.45, 8.55, {
      mat: M.nickel,
      bevel: 0.12,
      tex: 1.2,
      decals: [serrations, port(1.45, 4.05, 3.95, 5.2, [150, 118, 62]), engrave('LUCKY 45', { o: [0.9, 3.5, 7.4], du: [0, 0, -1], dv: [0, 1, 0], h: 0.5, face: [1, 0, 0] })],
    }),
  );
  // Barrel bushing, the barrel's crown and bore.
  g.add(
    'bushing',
    lathe([[0, 8.45], [0.66, 8.45], [0.66, 8.78], [0.6, 8.84], [0.44, 8.84], [0.44, 8.9], [0.27, 8.9], [0.27, 8.6], [0, 8.6]], {
      sides: 18,
      mat: (ctx) => (Math.hypot(ctx.lp[0], ctx.lp[1]) < 0.28 && ctx.lp[2] < 8.89 ? BORE : M.nickel(ctx)),
    }).move(0, 4.0, 0),
  );
  // The mini red dot: a black body on the slide, a tapered hood round an open window.
  // The mini red dot: a black body on the slide; at its back a slim gold frame round the open
  // window (the RMR's shield shape); in front of the frame the body steps down (below the view).
  const win = { poly: [[-1.5, 6.0], [1.5, 6.0], [1.5, 7.85], [1.05, 8.5], [-1.05, 8.5], [-1.5, 7.85]], z0: -1.5, z1: -0.45 };
  g.window = win;
  const floorScrews = (ctx, out) => {
    const [x, y, z] = ctx.p;
    if (ctx.fn[1] < 0.9 || Math.abs(y - 6.0) > 0.01) return;
    if (Math.hypot(x, z + 0.95) < 0.2) {
      Object.assign(out, M.gold(ctx));
      if (Math.abs(x) < 0.04) out.c = mulc(out.c, 0.4);
    }
  };
  g.add('red dot body', along([[-1.35, 4.8], [1.35, 4.8], [1.84, 5.45], [1.84, 6.0], [-1.84, 6.0], [-1.84, 5.45]], win.z0 - 0.25, win.z1 + 0.05, { mat: M.anod, bevel: 0.1, tex: 1.6, decals: [floorScrews] }));
  g.add('red dot nose', along([[-1.3, 4.8], [1.3, 4.8], [1.75, 5.3], [1.62, 5.64, 0.18], [-1.62, 5.64, 0.18], [-1.75, 5.3]], win.z1, 1.05, { mat: M.anod, bevel: 0.12, tex: 1.6 }));
  g.add(
    'red dot frame',
    along(
      [[1.84, 5.9], [1.84, 7.97, 0.12], [1.2, 8.86, 0.18], [-1.2, 8.86, 0.18], [-1.84, 7.97, 0.12], [-1.84, 5.9], [-1.5, 5.9], [-1.5, 7.85], [-1.05, 8.5], [1.05, 8.5], [1.5, 7.85], [1.5, 5.9]],
      win.z0,
      win.z1,
      { mat: M.gold, bevel: 0.09, tex: 1.6 },
    ),
  );
  for (const z of [0.1, 0.6]) g.add('red dot button', alongX(cyl(0.17, 0, 0.1, { sides: 10, bevel: 0.04, open: true, mat: M.gold }), [1.66, 5.2, z]));
  // Hammer, cocked: a spur, checkered on top.
  g.add(
    'hammer',
    side([[-1.95, 3.0], [-1.95, 3.7, 0.2], [-2.55, 4.45, 0.25], [-3.2, 4.8, 0.12], [-3.4, 4.55, 0.12], [-2.9, 4.1, 0.2], [-2.55, 3.1]], 0.55, {
      mat: M.gold,
      bevel: 0.07,
      decals: [(ctx, out) => ctx.p[1] > 4.3 && ctx.fn[1] > 0.3 && (out.c = mixc(out.c, mulc(out.c, 0.5), checkerAt(ctx.p[0], ctx.p[2], 0.14, ctx.fw)))],
    }),
  );
  // Trigger (gold) and the trigger guard.
  g.add('trigger', side([[2.3, 2.15], [2.95, 2.15], [2.95, 1.9, 0.1], [2.7, 1.05, 0.12], [2.45, 1.05, 0.1], [2.3, 1.5]], 0.5, { mat: M.gold, bevel: 0.06 }));
  g.add('trigger guard', sweep(sidePath([[4.72, 2.35], [4.8, 0.72, 0.45], [2.15, 0.52, 0.45], [1.6, 0.98]]), rect(0.55, 0.34, 0.1), { mat: M.blued, seg: 1 }));
  // Left side: the slide stop over the frame, the thumb safety at the back, the magazine catch.
  const pad = (z0, z1) => (ctx, out) => ctx.fn[0] > 0.8 && ctx.p[2] > z0 && ctx.p[2] < z1 && (out.c = mixc(out.c, mulc(out.c, 0.45), checkerAt(ctx.p[2], ctx.p[1], 0.12, ctx.fw)));
  g.add('slide stop', side([[0.95, 2.52, 0.15], [3.75, 2.48, 0.2], [3.8, 2.96, 0.2], [1.5, 2.97, 0.1], [0.95, 3.0, 0.15]], 0.22, { x: 0.86, mat: M.bluedDark, bevel: 0.06, decals: [pad(1.0, 1.7)] }));
  g.add('slide stop pin', alongNegX(lathe([[0, 0], [0.24, 0], [0.24, 0.08], [0.16, 0.16], [0, 0.16]], { sides: 12, mat: M.steel }), [-0.75, 2.62, 3.5]));
  g.add('thumb safety', side([[-2.2, 2.6, 0.1], [-0.3, 2.62, 0.15], [-0.22, 3.0, 0.1], [-1.2, 3.0], [-2.2, 2.98, 0.1]], 0.22, { x: 0.86, mat: M.bluedDark, bevel: 0.06, decals: [pad(-0.75, -0.25)] }));
  g.add('mag catch', alongX(lathe([[0, 0], [0.28, 0], [0.28, 0.1], [0.22, 0.16], [0, 0.16]], { sides: 14, mat: M.bluedDark, decals: [knurl((c) => c.lp[2] > 0.12, 0.1)] }), [0.72, ...G(1.3, 1.55).reverse()]));
  // Hammer and sear pins on both sides.
  for (const [z, y] of [[-1.85, 2.7], [-0.9, 2.55]]) g.add('pin', screwPair([0.74, y, z], { r: 0.13, hgt: 0.05, slot: false }));
  // Pearl grip panels with gold screws and a gold horseshoe inlay; the gold magazine base pad.
  const horseshoe = (ctx, out) => {
    const [, ly, lz] = turn(ctx.p, 'x', -15);
    const d = Math.hypot(lz, ly + 0.55);
    const a = Math.atan2(lz, -(ly + 0.55));
    if (d > 0.24 && d < 0.4 && Math.abs(a) < 2.5 && Math.abs(ctx.fn[0]) > 0.8) Object.assign(out, M.gold(ctx));
  };
  const panel = side([[-1.22, -2.4, 0.35], [1.2, -2.4, 0.35], [1.2, 1.2, 0.35], [-1.22, 1.2, 0.35]], 0.36, { x: 0.9, mat: M.pearl, bevel: 0.14, round: 3, tex: 1.3, decals: [horseshoe] });
  panel.turn('x', 15);
  g.add('grip panel', panel, panel.clone().mirrorX());
  for (const y of [0.75, -1.95]) {
    const [z, yy] = G(0, y);
    g.add('grip screw', screwPair([1.06, yy, z], { r: 0.2, hgt: 0.12, mat: M.gold, sides: 12 }));
  }
  g.add('magazine base', side([[-1.3, -3.35, 0.15], [1.25, -3.35, 0.15], [1.25, -2.8], [-1.3, -2.8]], 1.3, { mat: M.gold, bevel: 0.1 }).turn('x', 15));
  g.mark('grip', [0, 0, 0]);
  g.mark('grip2', [0, -2, 2]);
  g.mark('muzzle', [0, 4.0, 8.9]);
  g.mark('sight', [0, 7.25, win.z0]);
  g.mark('mag', turn([0, -3.05, 0], 'x', 15));
  return g;
}

/** Mac-10: black parkerized steel with gold furniture, a hot-pink strap and a pink-hooded holo. */
function smg() {
  const g = new Gun('smg', 'Mac-10');
  const AX = 4.5;
  const slot = (ctx, out) => {
    const [x, , z] = ctx.p;
    if (ctx.fn[1] > 0.9 && Math.abs(x) < 0.15 && z > 1.2 && z < 4.6) {
      out.c = [14, 14, 16];
      out.r = 0.6;
      out.m = 0.3;
    }
  };
  g.add(
    'upper receiver',
    along([[-1.35, 3.55], [1.35, 3.55], [1.35, 5.8, 0.35], [-1.35, 5.8, 0.35]], -4.3, 6.0, {
      mat: M.parker,
      bevel: 0.12,
      decals: [
        slot,
        port(0.6, 3.4, 4.3, 5.5, [100, 104, 112]),
        engrave('MAC-10', { o: [1.35, 4.4, 5.3], du: [0, 0, -1], dv: [0, 1, 0], h: 0.6, face: [1, 0, 0], fill: '#e9b54a' }),
        engrave('.45 ACP', { o: [1.35, 3.8, 5.3], du: [0, 0, -1], dv: [0, 1, 0], h: 0.38, face: [1, 0, 0] }),
      ],
    }),
  );
  g.add('lower receiver', along([[-1.28, 2.1, 0.18], [1.28, 2.1, 0.18], [1.28, 3.6], [-1.28, 3.6]], -4.15, 5.7, { mat: M.parker, bevel: 0.12 }));
  g.add('end cap', box([-1.2, 2.35, -4.75], [1.2, 5.45, -4.2], { mat: M.parker, bevel: 0.15 }));
  for (const [y, z] of [[2.55, -3.6], [2.55, 5.15], [3.15, -1.0], [3.15, 3.9]]) g.add('rivet', screwPair([1.28, y, z], { r: 0.13, hgt: 0.07, slot: false, mat: M.parker }));
  // Barrel nut, the threaded barrel, a knurled gold thread protector.
  g.add('barrel nut', lathe([[0, 5.9], [0.78, 5.9], [0.78, 6.25], [0.7, 6.35], [0, 6.35]], { sides: 16, mat: M.parker }).move(0, AX, 0));
  g.add('barrel', cyl(0.42, 6.3, 8.6, { sides: 16, mat: M.bluedDark }).move(0, AX, 0));
  g.add(
    'thread protector',
    lathe([[0, 8.45], [0.55, 8.45], [0.62, 8.55], [0.62, 9.85], [0.55, 9.97], [0.27, 9.97], [0.27, 9.45], [0, 9.45]], {
      sides: 18,
      mat: (ctx) => (Math.hypot(ctx.lp[0], ctx.lp[1]) < 0.28 && ctx.lp[2] < 9.96 ? BORE : M.gold(ctx)),
      decals: [knurl((c) => c.lp[2] > 8.7 && c.lp[2] < 9.7 && Math.hypot(c.lp[0], c.lp[1]) > 0.6, 0.14)],
    }).move(0, AX, 0),
  );
  // A small hooded front sight (low, under the holo's view) and the gold cocking knob.
  g.add('front sight', along([[0.5, 5.7], [0.5, 6.3, 0.2], [-0.5, 6.3, 0.2], [-0.5, 5.7], [-0.25, 5.7], [-0.25, 6.08], [0.25, 6.08], [0.25, 5.7]], 5.0, 5.75, { mat: M.parker, bevel: 0.06 }));
  g.add('front sight post', alongY(cyl(0.09, 0, 0.4, { sides: 8, mat: M.steel }), [0, 5.7, 5.37]));
  g.add(
    'cocking knob',
    alongY(
      lathe([[0, 0], [0.2, 0], [0.2, 0.3], [0.52, 0.32], [0.56, 0.42], [0.56, 0.72], [0.48, 0.82], [0, 0.84]], {
        sides: 16,
        mat: M.gold,
        decals: [knurl((c) => c.lp[2] > 0.44 && c.lp[2] < 0.7 && Math.hypot(c.lp[0], c.lp[1]) > 0.5, 0.15)],
      }),
      [0, 5.72, 2.9],
    ),
  );
  // The holo on a plate on the back of the top, its hood hot pink.
  g.add('mount plate', box([-1.05, 5.72, -3.2], [1.05, 6.28, -0.3], { mat: M.parker, bevel: 0.08 }));
  for (const z of [-2.6, -0.9]) g.add('plate screw', screw([1.05, 6.0, z], { r: 0.12, hgt: 0.06, axis: 'x' }));
  const sight = holo(g, { y: 7.5, z: -3.5, w: 4, h: 3.5, len: 3.7, frame: 1.1, wall: 0.4, body: 1.25, hoodMat: M.pink });
  // Grip (stippled polymer), magazine with witness holes and a gold base, the mag release.
  const stipple = (ctx, out) => {
    const [x, y, z] = ctx.p;
    if (y < -2.95 || y > 1.7) return;
    const s = vnoise(x * 24, y * 24, z * 24, 91);
    out.c = addc(out.c, (s - 0.5) * 26);
    out.r = clamp(out.r + (s - 0.5) * 0.25);
  };
  g.add('grip', side([[-1.55, 2.3], [1.45, 2.3], [1.45, -2.55, 0.35], [1.25, -3.25, 0.2], [-1.35, -3.25, 0.2], [-1.6, -2.45, 0.35]], 2.1, { mat: M.polymer, bevel: 0.24, round: 3, decals: [stipple] }));
  g.add('mag release', box([-0.42, -3.35, -1.95], [0.42, -2.6, -1.4], { mat: M.steel, bevel: 0.1 }));
  const witness = (ctx, out) => {
    if (Math.abs(ctx.fn[0]) < 0.9) return;
    const [, y, z] = ctx.p;
    for (let k = 0; k < 5; k++) {
      const d = Math.hypot(z + 0.55, y + 3.7 + k * 0.85);
      if (d < 0.15) {
        out.c = mixc([18, 18, 20], out.c, smoothstep(0.08, 0.15, d));
        out.r = 0.6;
      }
    }
  };
  g.add('magazine', box([-0.8, -8.3, -1.2], [0.8, -2.9, 1.05], { mat: M.parker, bevel: 0.15, decals: [witness] }));
  g.add('magazine base', side([[-1.4, -8.85, 0.15], [1.35, -8.85, 0.15], [1.25, -8.28, 0.1], [-1.3, -8.28, 0.1]], 1.85, { mat: M.gold, bevel: 0.1 }));
  // Trigger guard and gold trigger; the hand strap hanging under the front.
  g.add('trigger guard', sweep(sidePath([[4.15, 2.25], [4.2, 0.2, 0.45], [1.9, 0.08, 0.4], [1.3, 0.9]]), rect(0.7, 0.3, 0.08), { mat: M.parker, seg: 1 }));
  g.add('trigger', side([[2.05, 2.2], [2.65, 2.2], [2.58, 1.6, 0.25], [2.38, 0.95, 0.12], [2.18, 1.0], [2.25, 1.6, 0.2]], 0.45, { mat: M.gold, bevel: 0.06 }));
  g.add('strap', sweep(sidePath([[4.55, 2.3], [4.45, -0.37, 0.55], [6.15, -0.37, 0.55], [6.05, 2.3]], 0, 5), rect(1.7, 0.16, 0.05), { mat: M.pinkWeb }));
  g.add('strap buckle', box([-0.95, 0.85, 5.96], [0.95, 1.2, 6.3], { mat: M.gold, bevel: 0.06 }));
  // The wire stock, retracted: rods along the lower sides, hinges in front, the butt plate behind.
  for (const s of [1, -1]) {
    g.add('stock rod', sweep(sidePath([[4.6, 2.55], [-6.5, 2.55]], s * 1.55), circle(0.17, 10), { mat: M.steel }));
    g.add('stock hinge', box([s * 1.25, 2.2, 4.3], [s * 1.8, 2.9, 5.0], { mat: M.parker, bevel: 0.1 }));
  }
  const loop = fillet([[-1.55, -0.45, 0.6], [1.55, -0.45, 0.6], [1.55, 2.8, 0.6], [-1.55, 2.8, 0.6]], true, 3).map(([x, y]) => [x, y, -6.68]);
  g.add('stock butt', sweep(loop, rect(0.46, 0.4, 0.1), { closed: true, side: [0, 0, 1], mat: M.parker, seg: 1 }));
  g.add('stock butt pad', along([[-1.2, -0.62, 0.15], [1.2, -0.62, 0.15], [1.2, 0.05, 0.1], [-1.2, 0.05, 0.1]], -6.95, -6.4, { mat: M.rubber, bevel: 0.08 }));
  g.mark('grip', [0, 0, 0]);
  g.mark('grip2', [0, -0.45, 5.3]);
  g.mark('muzzle', [0, AX, 9.97]);
  g.mark('sight', sight);
  g.mark('mag', [0, -5.6, -0.07]);
  return g;
}

/** Big Kahuna: an AKM in blued steel, koa wood furniture, a plum bakelite magazine and a yellow holo. */
function rifle() {
  const g = new Gun('rifle', 'Big Kahuna');
  const G = raked(15);
  const AX = 3.4;
  const dimple = (ctx, out) => {
    if (Math.abs(ctx.fn[0]) < 0.9) return;
    const [, y, z] = ctx.p;
    const d = Math.hypot(Math.max(5.2 - z, z - 6.9, 0), Math.max(2.75 - y, y - 3.55, 0));
    if (d === 0) out.c = mulc(out.c, 0.78);
    else if (d < 0.07) {
      out.c = mixc(out.c, [170, 176, 184], 0.5);
      out.m = 1;
      out.r = 0.22;
    }
  };
  g.add(
    'receiver',
    along([[-1.1, 1.95, 0.18], [1.1, 1.95, 0.18], [1.1, 4.5], [-1.1, 4.5]], -3.0, 7.8, {
      mat: M.blued,
      bevel: 0.1,
      decals: [dimple, port(1.8, 5.1, 3.7, 4.48, [128, 132, 138]), engrave('BIG KAHUNA', { o: [1.1, 2.3, 4.85], du: [0, 0, -1], dv: [0, 1, 0], h: 0.48, face: [1, 0, 0], fill: '#e9b54a' })],
    }),
  );
  for (const [y, z] of [[2.45, 7.35], [3.05, 7.35], [3.65, 7.35], [2.55, -2.45], [3.35, -2.45]]) g.add('rivet', screwPair([1.1, y, z], { r: 0.13, hgt: 0.07, slot: false, mat: M.blued }));
  for (const [y, z] of [[2.95, 1.2], [2.95, 2.35]]) g.add('pin', screwPair([1.1, y, z], { r: 0.15, hgt: 0.05, slot: false }));
  // The dust cover (ribbed at the back) with a rail on top; the rear sight block and leaf.
  const ribs = (ctx, out) => {
    const z = ctx.p[2];
    if (ctx.fn[1] < 0.3 || z < -3.0 || z > -0.7) return;
    out.c = mixc(out.c, mulc(out.c, 1.45), stripesAt(z + 20, 0.5, ctx.fw, 0.28) * 0.7);
  };
  g.add('dust cover', along([[-1.16, 4.35], [1.16, 4.35], [1.16, 5.3, 0.55], [-1.16, 5.3, 0.55]], -3.25, 6.3, { mat: M.blued, bevel: 0.12, decals: [ribs] }));
  g.add('dust cover button', cyl(0.28, -3.45, -3.2, { sides: 12, bevel: 0.06, mat: M.steel }).move(0, 4.85, 0));
  g.add('rail', ...rail(-0.5, 4.5, 5.2, { w: 1.7, h: 0.55 }));
  g.add('rear sight', side([[6.2, 4.3], [7.9, 4.3], [7.9, 4.95, 0.12], [6.5, 5.3, 0.15], [6.2, 5.2]], 1.5, { mat: M.blued, bevel: 0.08 }));
  g.add('rear sight leaf', side([[6.45, 5.25], [7.85, 5.02], [7.9, 5.16], [6.5, 5.42]], 0.9, { mat: M.steel, bevel: 0.04 }));
  // Charging handle and the long selector lever on the right.
  g.add('charging handle', alongNegX(lathe([[0, 0], [0.2, 0], [0.2, 0.55], [0.3, 0.62], [0.33, 0.8], [0.26, 0.95], [0, 1.0]], { sides: 12, mat: M.steel }), [-1.1, 4.05, 5.45]));
  g.add('selector', side([[-1.7, 3.35, 0.2], [-1.3, 3.25], [3.9, 4.2], [3.95, 4.42, 0.08], [-1.3, 3.72], [-1.8, 3.72, 0.2]], 0.14, { x: -1.17, mat: M.steel, bevel: 0.04 }));
  // Pistol grip (koa), trigger, guard, magazine catch.
  g.add('pistol grip', side([G(-1.25, 2.6), G(1.2, 2.6), G(1.3, -2.35, 0.4), G(1.05, -2.95, 0.3), G(-1.35, -2.95, 0.3), G(-1.5, -0.5, 0.9)], 1.8, { mat: M.koa, bevel: 0.3, round: 3 }));
  g.add('grip screw', screw([0, -2.95, -0.15], { r: 0.2, hgt: 0.07, axis: '-y' }).turn('x', 15));
  g.add('trigger', side([[2.1, 2.05], [2.6, 2.05], [2.52, 1.5, 0.22], [2.32, 0.95, 0.1], [2.12, 1.0], [2.2, 1.5, 0.2]], 0.42, { mat: M.steel, bevel: 0.05 }));
  g.add('trigger guard', sweep(sidePath([[3.72, 2.0], [3.78, 0.35, 0.5], [1.25, 0.25, 0.5], [0.7, 1.3]]), rect(0.62, 0.28, 0.07), { mat: M.blued, seg: 1 }));
  g.add('mag catch', side([[3.92, 1.98], [4.28, 1.98], [4.24, 0.95, 0.1], [3.97, 0.9, 0.1]], 0.62, { mat: M.steel, bevel: 0.06 }));
  // The magazine: bakelite, curved, two ribs down its sides, a floor plate.
  const magPath = sidePath([[5.5, 2.3], [5.62, -0.6, 5.5], [8.9, -5.75]], 0, 20);
  g.add('magazine', sweep(magPath, rect(1.5, 2.6, 0.32), { mat: M.bakelite }));
  for (const sy of [-0.62, 0.55]) g.add('magazine rib', sweep(magPath.slice(1), [[-0.82, sy - 0.17, 0.08], [0.82, sy - 0.17, 0.08], [0.82, sy + 0.17, 0.08], [-0.82, sy + 0.17, 0.08]], { mat: M.bakelite, seg: 1 }));
  const mEnd = magPath[magPath.length - 1], mT = norm3(sub3(mEnd, magPath[magPath.length - 2]));
  g.add('magazine base', sweep([add3(mEnd, mul3(mT, -0.25)), add3(mEnd, mul3(mT, 0.2))], rect(1.72, 2.85, 0.2), { mat: M.bakelite }));
  // Handguards (koa) with finger grooves, the retainer, gas tube and block.
  const grooves = (ctx, out) => {
    if (Math.abs(ctx.fn[0]) < 0.8) return;
    const [, y, z] = ctx.p;
    if (z < 8.3 || z > 11.9) return;
    for (const gy of [3.05, 3.5]) {
      const d = Math.abs(y - gy);
      if (d < 0.1) out.c = mixc(out.c, mulc(out.c, 0.55), 1 - smoothstep(0.04, 0.1, d));
    }
  };
  g.add('lower handguard', along([[-1.32, 1.9, 0.62], [1.32, 1.9, 0.62], [1.32, 4.05], [-1.32, 4.05]], 7.8, 12.4, { mat: M.koa, bevel: 0.22, round: 3, decals: [grooves] }));
  g.add('upper handguard', along([[-0.98, 4.0], [0.98, 4.0], [0.98, 5.0, 0.62], [-0.98, 5.0, 0.62]], 7.95, 11.95, { mat: M.koa, bevel: 0.2, round: 3 }));
  g.add('handguard retainer', box([-1.24, 2.15, 12.35], [1.24, 4.1, 12.85], { mat: M.steel, bevel: 0.08 }));
  g.add('gas tube', cyl(0.4, 11.8, 12.9, { sides: 14, mat: M.blued }).move(0, 4.55, 0));
  g.add('gas block', side([[12.75, 2.95], [13.95, 2.95], [13.95, 4.2, 0.25], [13.55, 5.0, 0.2], [12.75, 5.0]], 1.3, { mat: M.blued, bevel: 0.08 }));
  g.add('barrel', cyl(0.42, 12.3, 16.5, { sides: 16, mat: M.bluedDark }).move(0, AX, 0));
  g.add('cleaning rod', lathe([[0, 12.6], [0.11, 12.6], [0.11, 15.9], [0.17, 16.0], [0.17, 16.3], [0, 16.35]], { sides: 8, mat: M.steel }).move(0, 2.55, 0));
  // Front sight: a block round the barrel, the ears and post (below the holo's view), the bayonet lug.
  g.add('front sight base', side([[15.2, 2.75], [16.4, 2.75], [16.4, 3.95], [16.05, 4.3], [15.2, 4.3]], 1.2, { mat: M.blued, bevel: 0.08 }));
  g.add('front sight ears', along([[0.62, 4.1], [0.62, 5.2, 0.12], [0.36, 5.32], [0.3, 4.4], [-0.3, 4.4], [-0.36, 5.32], [-0.62, 5.2, 0.12], [-0.62, 4.1]], 15.45, 16.15, { mat: M.blued, bevel: 0.05 }));
  g.add('front sight post', alongY(cyl(0.09, 0, 0.75, { sides: 8, mat: M.steel }), [0, 4.3, 15.8]));
  g.add('bayonet lug', box([-0.28, 2.3, 15.3], [0.28, 2.8, 16.3], { mat: M.blued, bevel: 0.06 }));
  // The slant brake: its mouth cut back toward the top.
  const brake = lathe([[0, 16.4], [0.52, 16.4], [0.52, 17.85], [0.45, 17.98], [0.28, 17.98], [0.28, 17.55], [0, 17.55]], {
    sides: 16,
    mat: (ctx) => (Math.hypot(ctx.lp[0], ctx.lp[1]) < 0.29 && ctx.lp[2] < 17.97 ? BORE : M.bluedDark(ctx)),
  }).move(0, AX, 0);
  brake.map((p) => (p[2] > 17.8 ? [p[0], p[1], p[2] - 0.28 * clamp((p[1] - (AX - 0.52)) / 1.04)] : p));
  g.add('muzzle brake', brake);
  // Stock (koa), widening to the butt; a steel butt plate.
  const stock = side([[-3.0, 4.45], [-9.75, 4.3, 0.25], [-9.8, -0.25, 0.3], [-8.4, -0.3], [-3.0, 1.95]], 1.9, { mat: M.koa, bevel: 0.3, round: 3 });
  stock.map((p) => [p[0] * lerp(0.94, 1.12, clamp((-3 - p[2]) / 6.8)), p[1], p[2]]);
  g.add('stock', stock);
  g.add('butt plate', side([[-9.7, 4.38, 0.2], [-10.05, 4.33, 0.2], [-10.1, -0.3, 0.2], [-9.75, -0.35, 0.2]], 2.15, { mat: M.darksteel, bevel: 0.08 }));
  // The holo, yellow, on a clamp on the rail.
  const sight = holo(g, { y: 8.5, z: 0, w: 5, h: 4, len: 4.3, frame: 1.25, wall: 0.45, body: 1.5, base: 5.72, hoodMat: M.yellow });
  g.mark('grip', [0, 0, 0]);
  g.mark('grip2', [0, 1.9, 10]);
  g.mark('muzzle', [0, AX, 17.9]);
  g.mark('sight', sight);
  g.mark('mag', atLength(magPath, 0.45).map((v) => +v.toFixed(3)));
  return g;
}

/** Zed's Pump: an 870 in blued steel, a walnut pistol-grip stock, a cherry corn-cob pump and holo, red shells on the side. */
function shotgun() {
  const g = new Gun('shotgun', "Zed's Pump");
  const G = raked(25);
  const AX = 4.05, TUBE = 2.5;
  const loading = (ctx, out) => {
    if (ctx.fn[1] > -0.9) return;
    const [x, , z] = ctx.p;
    if (Math.abs(x) > 0.85 || z < 5.0 || z > 7.3) return;
    const e = Math.min(z - 5.0, 7.3 - z, 0.85 - Math.abs(x));
    out.c = e < 0.06 ? [180, 184, 190] : z > 6.9 ? [16, 16, 18] : [58, 60, 66];
    out.m = 0.8;
    out.r = 0.4;
  };
  g.add(
    'receiver',
    along([[-1.2, 1.3, 0.12], [1.2, 1.3, 0.12], [1.2, 4.8, 0.55], [-1.2, 4.8, 0.55]], 0.6, 7.6, {
      mat: M.blued,
      bevel: 0.12,
      decals: [loading, port(3.0, 6.2, 2.9, 4.35, [160, 26, 36]), engrave("ZED'S", { o: [-1.2, 1.7, 1.3], du: [0, 0, 1], dv: [0, 1, 0], h: 0.55, face: [-1, 0, 0], fill: '#e9b54a' })],
    }),
  );
  g.add('trigger plate', box([-1.0, 0.72, 1.0], [1.0, 1.4, 4.9], { mat: M.anod, bevel: 0.1 }));
  g.add('trigger', side([[2.5, 0.8], [3.0, 0.8], [2.92, 0.2, 0.22], [2.72, -0.35, 0.12], [2.52, -0.3], [2.6, 0.2, 0.2]], 0.45, { mat: M.brass, bevel: 0.05 }));
  g.add('trigger guard', sweep(sidePath([[4.55, 0.85], [4.6, -0.78, 0.5], [1.75, -0.88, 0.45], [1.2, 0.2]]), rect(0.62, 0.3, 0.08), { mat: M.anod, seg: 1 }));
  g.add('safety', cyl(0.19, -1.12, 1.12, { sides: 12, bevel: 0.05, mat: M.steel, decals: [(ctx, out) => ctx.lp[2] > 1.0 && Object.assign(out, { c: [205, 30, 34], m: 0, r: 0.3 })] }).turn('y', 90).move(0, 0.98, 1.4));
  g.add('slide release', side([[4.2, 0.85], [4.85, 0.88, 0.08], [4.8, 1.22], [4.2, 1.25]], 0.12, { x: 1.06, mat: M.steel, bevel: 0.03 }));
  // Barrel with a brass bead; the magazine tube, its knurled cap and the barrel ring; action bars.
  g.add(
    'barrel',
    lathe([[0, 7.3], [0.64, 7.3], [0.64, 8.0], [0.57, 8.15], [0.57, 19.85], [0.5, 20.0], [0.38, 20.0], [0.38, 19.3], [0, 19.3]], {
      sides: 18,
      mat: (ctx) => (Math.hypot(ctx.lp[0], ctx.lp[1]) < 0.39 && ctx.lp[2] < 19.99 ? BORE : M.blued(ctx)),
    }).move(0, AX, 0),
  );
  g.add('bead', lathe([[0, -0.16], [0.1, -0.13], [0.16, 0], [0.1, 0.13], [0, 0.16]], { sides: 10, mat: M.brass }).move(0, AX + 0.6, 19.7));
  g.add('magazine tube', cyl(0.52, 7.3, 17.8, { sides: 16, mat: M.blued }).move(0, TUBE, 0));
  g.add('magazine cap', lathe([[0, 17.7], [0.6, 17.7], [0.66, 17.8], [0.66, 18.5], [0.56, 18.65], [0, 18.65]], { sides: 16, mat: M.blued, decals: [knurl((c) => c.lp[2] > 17.85 && c.lp[2] < 18.45 && Math.hypot(c.lp[0], c.lp[1]) > 0.6)] }).move(0, TUBE, 0));
  g.add('barrel ring', along([[-0.64, 1.86, 0.62], [0.64, 1.86, 0.62], [0.64, 4.7, 0.62], [-0.64, 4.7, 0.62]], 17.2, 17.62, { mat: M.blued, bevel: 0.08 }));
  for (const s of [1, -1]) g.add('action bar', box([s * 0.42, 2.25, 7.5], [s * 0.64, 2.7, 10.3], { mat: M.steel, bevel: 0.04 }));
  // The pump: a corn cob in cherry lacquer, round the tube, flattened under the barrel.
  const prof = [[0.5, 10.0], [1.05, 10.0], [1.3, 10.22]];
  for (let k = 0; k < 8; k++) {
    const zg = 10.75 + k * 0.52;
    prof.push([1.3, zg - 0.15], [1.13, zg], [1.3, zg + 0.15]);
  }
  prof.push([1.3, 14.78], [1.05, 15.0], [0.5, 15.0]);
  const pump = lathe(prof, { sides: 16, mat: M.cherry }).move(0, TUBE, 0);
  pump.map((p) => (p[1] > 3.35 ? [p[0], 3.35 + (p[1] - 3.35) * 0.35, p[2]] : p));
  g.add('pump', pump);
  // A side saddle on the left with four red shells, brass down.
  g.add('side saddle', box([1.15, 1.7, 1.6], [1.45, 4.6, 6.95], { mat: M.polymer, bevel: 0.08 }));
  const crimp = (ctx, out) => ctx.lp[2] > 2.58 && (out.c = mulc(out.c, 0.72 + 0.28 * Math.abs(Math.sin(Math.atan2(ctx.lp[1], ctx.lp[0]) * 3))));
  for (const z of [2.25, 3.55, 4.85, 6.15]) {
    const shell = lathe([[0.52, 0], [0.52, 0.12], [0.46, 0.18], [0.46, 2.55], [0.42, 2.66], [0, 2.7]], {
      sides: 12,
      mat: (ctx) => (ctx.lp[2] < 0.57 ? M.brass(ctx) : M.cherry(ctx)),
      decals: [crimp],
    });
    g.add('shell', alongY(shell, [1.95, 1.8, z]));
  }
  // The stock with its pistol grip, walnut, checkered; a recoil pad with a white spacer.
  const stock = side(
    [[0.75, 4.75], [-2.2, 4.55], [-9.3, 4.3, 0.25], [-9.45, -0.3, 0.3], [-7.0, 0.2], [-3.9, 1.45, 1.2], G(-1.35, -0.6, 0.6), G(-1.45, -2.4, 0.35), G(-1.3, -2.95, 0.25), G(1.25, -2.95, 0.25), G(1.35, -1.2, 0.3), G(1.2, 0.95, 0.2), [0.75, 1.35]],
    2.0,
    { mat: M.walnut, bevel: 0.3, round: 3, decals: [gripChecker(25, [-1.05, 1.0], [-2.5, 0.3])] },
  );
  stock.map((p) => [p[0] * lerp(1, 1.25, clamp((-1.5 - p[2]) / 7.8)), p[1], p[2]]);
  g.add('stock', stock);
  g.add('recoil pad', side([[-9.25, 4.42, 0.2], [-10.0, 4.36, 0.25], [-10.05, -0.42, 0.25], [-9.4, -0.42, 0.2]], 2.5, { mat: M.rubber, bevel: 0.15, round: 3, decals: [spacer(-9.42)] }));
  // The holo, cherry red like the pump, on a rail on the receiver.
  g.add('rail', ...rail(1.4, 6.6, 4.72, { w: 1.7, h: 0.55 }));
  const sight = holo(g, { y: 7.5, z: 2, w: 5, h: 4, len: 4.3, frame: 1.25, wall: 0.45, body: 1.3, base: 5.22, hoodMat: M.cherry });
  g.mark('grip', [0, 0, 0]);
  g.mark('grip2', [0, TUBE - 1.3, 12.5]);
  g.mark('muzzle', [0, AX, 20]);
  g.mark('sight', sight);
  g.mark('mag', [0, 1.25, 6.15]);
  return g;
}

/** Honey Bunny: a bolt-action rifle in honey maple and blued steel, a big scope with brass trim and a red glint. */
function sniper() {
  const g = new Gun('sniper', 'Honey Bunny');
  const G = raked(18);
  const AX = 4.2, SC = 8.0;
  // The stock: forend, action, pistol grip, Monte Carlo comb, one side profile, shaped in width along it.
  const stock = side(
    [
      [15.3, 3.3, 0.3], [15.45, 2.1, 0.55], [11.0, 1.58, 2.5], [6.9, 1.1, 2.0], [4.2, 1.0], [1.9, 1.0],
      G(1.3, 0.9, 0.35), G(1.3, -2.35, 0.4), G(1.2, -3.02, 0.3), G(-1.5, -3.02, 0.3), G(-1.62, -2.4, 0.4), G(-1.5, -0.9, 0.7),
      [-3.2, 0.1, 1.6], [-10.2, -1.2, 0.3], [-10.2, 4.75, 0.3], [-7.2, 5.05, 0.8], [-3.9, 5.1, 0.6], [-2.4, 3.95, 0.6], [-1.2, 3.75],
    ],
    2.2,
    { mat: M.honey, bevel: 0.35, round: 3, decals: [gripChecker(18, [-1.1, 1.0], [-2.45, 0.35])] },
  );
  const wOf = (z) => (z >= 7 ? 1 - 0.28 * clamp((z - 7) / 8.4) : z >= 0.8 ? 1 : z >= -2.2 ? 0.86 + 0.14 * smoothstep(-2.2, 0.8, z) : 0.86 + 0.24 * smoothstep(-2.2, -6.0, z));
  stock.map((p) => [p[0] * wOf(p[2]), p[1], p[2]]);
  g.add('stock', stock);
  g.add('cheek piece', side([[-3.9, 4.95], [-8.3, 4.95, 0.5], [-8.5, 3.0, 0.7], [-4.3, 3.0, 0.9]], 0.5, { x: 1.25, mat: M.honey, bevel: 0.2, round: 3 }));
  g.add('recoil pad', side([[-10.1, 4.85, 0.25], [-10.95, 4.8, 0.3], [-10.95, -1.35, 0.3], [-10.1, -1.4, 0.25]], 2.45, { mat: M.rubber, bevel: 0.15, round: 2, decals: [spacer(-10.12)] }));
  // The round action, its port on the right, gold roll marks on the left; bolt shroud, handle, knob.
  g.add(
    'receiver',
    lathe([[0, -1.9], [0.72, -1.9], [0.85, -1.77], [0.85, 7.85], [0.72, 8.0], [0, 8.0]], {
      sides: 20,
      mat: M.blued,
      decals: [port(2.2, 5.6, AX + 0.05, AX + 0.8, [150, 154, 160]), engrave('HONEY BUNNY', { o: [0.85, AX - 0.22, 6.6], du: [0, 0, -1], dv: [0, 1, 0], h: 0.44, face: [1, 0, 0], fill: '#e9b54a' })],
    }).move(0, AX, 0),
  );
  g.add('bolt shroud', lathe([[0, -3.05], [0.32, -3.05], [0.48, -2.9], [0.55, -2.45], [0.55, -1.8], [0, -1.8]], { sides: 16, mat: M.steel }).move(0, AX, 0));
  g.add('bolt handle', sweep([[-0.6, AX + 0.15, 1.3], [-1.45, AX - 0.2, 1.1], [-2.4, AX - 0.95, 0.85]], circle(0.16, 10), { side: [0, 0, 1], mat: M.steel }));
  g.add('bolt knob', lathe([[0, -0.46], [0.22, -0.41], [0.38, -0.26], [0.46, 0], [0.38, 0.26], [0.22, 0.41], [0, 0.46]], { sides: 16, mat: M.polymer }).move(-2.7, AX - 1.24, 0.75));
  // Rail, rings, the scope: eyepiece, knurled power ring, tube, turrets, the objective bell.
  g.add('rail', ...rail(-1.4, 7.4, AX + 0.78, { w: 1.5, h: 0.5 }));
  for (const z of [0.2, 5.4]) {
    g.add('scope ring base', box([-0.62, AX + 1.2, z + 0.05], [0.62, SC - 0.55, z + 0.75], { mat: M.anod, bevel: 0.1 }));
    g.add('scope ring', lathe([[0.79, z], [0.99, z], [0.99, z + 0.8], [0.79, z + 0.8]], { sides: 16, mat: M.anod }).move(0, SC, 0));
    g.add('ring screw', screw([0.62, AX + 1.75, z + 0.4], { r: 0.13, hgt: 0.07, axis: 'x' }));
  }
  const scopeMat = (ctx) => {
    const r = Math.hypot(ctx.lp[0], ctx.lp[1]), z = ctx.lp[2];
    if (z < -2.9 && r < 1.02) return lens({ r: 1.02 })(ctx);
    if (z > 11.3 && r < 1.36) {
      // The objective: dark glass with a red sheen and a hot glint high on the left.
      const L = lens({ r: 1.36 })(ctx);
      const gl = Math.hypot(ctx.lp[0] - 0.42, ctx.lp[1] - 0.45);
      const hot = 1 - smoothstep(0.06, 0.3, gl);
      L.c = mixc(mixc(L.c, [150, 22, 26], 0.45 * smoothstep(0.3, 1.2, r)), [255, 214, 196], hot);
      L.e = Math.max(0.35 * smoothstep(0.3, 1.2, r), hot);
      return L;
    }
    if ((z < -2.85 && r >= 1.02) || z > 11.36) return M.brass(ctx);
    return M.anod(ctx);
  };
  g.add(
    'scope',
    lathe(
      [
        [0, -2.92], [1.02, -2.92], [1.04, -3.0], [1.24, -3.0], [1.3, -2.92], [1.3, -1.75], [1.22, -1.65], [1.22, -1.0], [1.12, -0.95], [0.82, -0.55],
        [0.8, -0.45], [0.8, 6.3], [0.86, 6.45], [1.52, 8.7], [1.58, 8.85], [1.58, 11.35], [1.5, 11.5], [1.36, 11.5], [1.36, 11.38], [0, 11.38],
      ],
      { sides: 20, mat: scopeMat, tex: 1.2, decals: [knurl((c) => c.lp[2] > -1.6 && c.lp[2] < -1.05 && Math.hypot(c.lp[0], c.lp[1]) > 1.15, 0.18)] },
    ).move(0, SC, 0),
  );
  g.add('turret saddle', box([-0.98, SC - 0.9, 2.2], [0.98, SC + 0.95, 3.95], { mat: M.anod, bevel: 0.25, round: 2 }));
  const turret = (h, r) =>
    lathe([[r + 0.08, 0], [r + 0.08, 0.14], [r, 0.2], [r, h - 0.1], [r - 0.08, h], [0, h]], {
      sides: 16,
      mat: M.anod,
      decals: [knurl((c) => c.lp[2] > 0.3 && c.lp[2] < h - 0.15 && Math.hypot(c.lp[0], c.lp[1]) > r - 0.02, 0.15)],
    });
  g.add('elevation turret', alongY(turret(1.05, 0.52), [0, SC + 0.9, 3.08]));
  g.add('windage turret', alongNegX(turret(0.9, 0.46), [-0.95, SC, 3.08]));
  g.add('parallax turret', alongX(turret(0.95, 0.42), [0.95, SC, 3.08]));
  g.add('turret cap', alongY(lathe([[0.4, 0], [0.4, 0.06], [0.3, 0.1], [0, 0.1]], { sides: 16, mat: M.brass }), [0, SC + 1.95, 3.08]));
  // The barrel: the chamber, a fluted run, the taper, a ported brake.
  g.add('barrel chamber', lathe([[0, 7.9], [0.7, 7.9], [0.7, 9.55], [0.66, 9.7], [0, 9.7]], { sides: 20, mat: M.blued }).move(0, AX, 0));
  const fluted = Array.from({ length: 48 }, (_, i) => {
    const a = (i / 48) * Math.PI * 2;
    const f = smoothstep(0.35, 0.95, Math.cos(a * 6));
    return [Math.cos(a) * (1 - 0.14 * f), Math.sin(a) * (1 - 0.14 * f)];
  });
  g.add('fluted barrel', sweep([[0, AX, 9.6], [0, AX, 13.6], [0, AX, 17.6]], fluted, { scale: (t) => lerp(0.66, 0.57, t), mat: M.blued, seg: 1 }));
  g.add('barrel', lathe([[0, 17.5], [0.57, 17.5], [0.54, 20.45], [0, 20.45]], { sides: 18, mat: M.blued }).move(0, AX, 0));
  const brakeMat = (ctx) => {
    const [x, y, z] = ctx.lp;
    const r = Math.hypot(x, y);
    if (r < 0.27 && z < 21.99) return BORE;
    if (Math.abs(x) / Math.max(r, 1e-6) > 0.72 && ((z > 20.7 && z < 21.05) || (z > 21.3 && z < 21.65))) return { c: [16, 16, 18], m: 0.6, r: 0.5, e: 0 };
    return M.bluedDark(ctx);
  };
  g.add('muzzle brake', lathe([[0, 20.35], [0.66, 20.35], [0.7, 20.45], [0.7, 21.85], [0.62, 22.0], [0.26, 22.0], [0.26, 21.4], [0, 21.4]], { sides: 18, mat: brakeMat }).move(0, AX, 0));
  // Trigger guard, gold trigger, the box magazine.
  g.add('trigger guard', sweep(sidePath([[4.1, 1.05], [4.15, -0.3, 0.45], [1.8, -0.45, 0.45], [1.25, 0.6]]), rect(0.62, 0.3, 0.08), { mat: M.bluedDark, seg: 1 }));
  g.add('trigger', side([[2.3, 1.05], [2.8, 1.05], [2.72, 0.5, 0.22], [2.52, -0.05, 0.12], [2.32, 0.0], [2.4, 0.5, 0.2]], 0.42, { mat: M.gold, bevel: 0.05 }));
  g.add('magazine', box([-0.75, -0.75, 4.35], [0.75, 1.2, 6.7], { mat: M.bluedDark, bevel: 0.12 }));
  g.add('magazine plate', box([-0.86, -0.98, 4.22], [0.86, -0.72, 6.83], { mat: M.steel, bevel: 0.08 }));
  // The bipod, folded forward under the forend.
  g.add('bipod mount', box([-0.72, 1.32, 13.2], [0.72, 2.0, 14.6], { mat: M.anod, bevel: 0.12 }));
  g.add('bipod pivot', alongX(cyl(0.2, -0.95, 0.95, { sides: 10, bevel: 0.05, mat: M.steel }), [0, 1.45, 14.25]));
  for (const s of [1, -1]) {
    g.add('bipod leg', sweep([[s * 0.52, 1.42, 14.0], [s * 0.52, 1.95, 19.6]], circle(0.17, 10), { mat: M.anod }));
    g.add('bipod foot', lathe([[0, 0], [0.25, 0], [0.25, 0.5], [0.18, 0.6], [0, 0.6]], { sides: 12, mat: M.rubber }).turn('x', -5.4).move(s * 0.52, 1.93, 19.4));
  }
  g.mark('grip', [0, 0, 0]);
  g.mark('grip2', [0, 1.5, 10.5]);
  g.mark('muzzle', [0, AX, 22]);
  g.mark('sight', [0, SC, -2.92]);
  g.mark('mag', [0, 0.2, 5.5]);
  return g;
}

/** Hattori Hanzo: a katana: a mirror blade with a wavy hamon, a gold-rimmed iron tsuba, black and gold fittings, a yellow silk wrap. */
function katana() {
  const g = new Gun('katana', 'Hattori Hanzo');
  const Z0 = 5.4, L = 21.45, R = 150;
  const sY = L - 2.4; // the yokote, where the point begins
  const hOf = (s) => lerp(1.32, 1.0, clamp(s / sY));
  const tOf = (s) => lerp(0.42, 0.28, clamp(s / sY));
  const yc = (s) => -(s * s) / (2 * R);
  const tip = (s) => Math.sqrt(Math.max(0, 1 - ((s - sY) / (L - sY)) ** 2));
  const spine = (s) => -hOf(Math.min(s, sY)) / 2;
  const edge = (s) => (s < sY ? hOf(s) / 2 : -hOf(sY) / 2 + hOf(sY) * tip(s));
  const thick = (s) => (s < sY ? tOf(s) : tOf(sY) * Math.max(0.15, tip(s)) * (s >= L - 1e-6 ? 0 : 1));
  const ss = [...Array.from({ length: 44 }, (_, i) => (i / 44) * sY), ...Array.from({ length: 17 }, (_, i) => sY + Math.sin(((i / 16) * Math.PI) / 2) * (L - sY))];
  const bladeMat = (ctx) => {
    const [, y, z] = ctx.p;
    const s = z - Z0;
    const sp = yc(s) + spine(s), ed = yc(s) + edge(s);
    const v = clamp((y - sp) / Math.max(1e-3, ed - sp));
    const flat = Math.abs(ctx.n[0]) > 0.5;
    let hl = 0.7 + 0.06 * Math.sin(s * 1.9) + 0.035 * Math.sin(s * 4.7 + 1.3) + 0.02 * Math.sin(s * 11 + 2);
    if (s > sY) hl = lerp(hl, 0.42, clamp((s - sY) / (L - sY)));
    const hard = smoothstep(hl - 0.03, hl + 0.03, v);
    let c, r;
    if (!flat && v < 0.12) {
      c = hex('#8e98a4');
      r = 0.18;
    } else if (v < 0.38) {
      c = hex('#8f99a6');
      r = 0.07;
    } else {
      c = hex('#c4ccd5');
      r = 0.11;
    }
    const mist = Math.exp(-(((v - hl) / 0.035) ** 2));
    c = mixc(c, hex('#eef2f5'), hard * 0.85);
    r = lerp(r, 0.34, hard);
    const m = lerp(1, 0.7, hard);
    c = mixc(c, [255, 255, 255], mist * 0.45);
    if (mist > 0.2 && ctx.rnd > 0.93) c = mixc(c, [255, 255, 255], 0.7);
    if (flat && Math.abs(s - sY) < 0.035) c = mixc(c, [250, 252, 255], 0.8);
    if (flat && v > 0.1 && v < 0.3 && s > 0.6 && s < sY - 3) {
      c = mulc(c, 0.72);
      r = 0.05;
    }
    return { c: addc(c, (ctx.rnd - 0.5) * 3), m, r, e: 0 };
  };
  g.add(
    'blade',
    sweep(
      ss.map((s) => [0, yc(s), Z0 + s]),
      [[0, -0.5], [0.3, -0.45], [0.5, -0.12], [0.1, 0.44], [0, 0.5], [-0.1, 0.44], [-0.5, -0.12], [-0.3, -0.45]],
      { xform: (t, i) => [thick(ss[i]), edge(ss[i]) - spine(ss[i]), 0, (edge(ss[i]) + spine(ss[i])) / 2], mat: bladeMat, tex: 1.1 },
    ),
  );
  g.add('habaki', sweep([[0, 0, 5.3], [0, 0, 6.35]], [[0, -0.8], [0.3, -0.74], [0.33, 0.35], [0.14, 0.82], [-0.14, 0.82], [-0.33, 0.35], [-0.3, -0.74]], { scale: (t) => [lerp(1.05, 0.95, t), 1], mat: M.gold, tex: 1.3 }));
  // Seppa, tsuba (four-lobed, iron, gold rim), fuchi, the wrapped tsuka with gold menuki, the kashira.
  g.add('seppa', along(ellipse(0.95, 1.25, 24), 5.25, 5.35, { mat: M.gold }), along(ellipse(0.95, 1.25, 24), 4.87, 4.97, { mat: M.gold }));
  const mokko = Array.from({ length: 48 }, (_, i) => {
    const a = (i / 48) * Math.PI * 2;
    const k = 1 - 0.11 * Math.pow(0.5 - 0.5 * Math.cos(4 * a), 3);
    return [1.95 * k * Math.cos(a), 2.3 * k * Math.sin(a)];
  });
  const iron = metal({ base: '#2a2522', alt: '#3d3029', rough: 0.55, rv: 0.15, metal: 0.8, wear: '#8a7a68', wearRough: 0.3 });
  const rim = (ctx, out) => {
    const [x, y] = ctx.p;
    if (Math.abs(ctx.fn[2]) < 0.6 || Math.hypot(x / 1.95, y / 2.3) > 0.86) Object.assign(out, M.gold(ctx));
  };
  g.add('tsuba', along(mokko, 4.97, 5.25, { mat: iron, bevel: 0.06, decals: [rim] }));
  const band = (z0, z1) => (ctx, out) => ctx.p[2] > z0 && ctx.p[2] < z1 && Object.assign(out, M.gold(ctx));
  g.add('fuchi', sweep([[0, 0, 4.3], [0, 0, 4.88]], ellipse(0.8, 1.08, 24), { mat: M.lacquer, decals: [band(4.72, 4.88)] }));
  g.add('tsuka', sweep(Array.from({ length: 9 }, (_, i) => [0, 0, lerp(-2.4, 4.35, i / 8)]), ellipse(0.72, 1.0, 20), { scale: (t) => 1 - 0.05 * Math.sin(t * Math.PI), mat: M.ito, tex: 1.2 }));
  for (const [s, z] of [[1, 0.9], [-1, 2.3]]) g.add('menuki', lathe([[0, -0.5], [0.18, -0.45], [0.26, -0.25], [0.28, 0], [0.26, 0.25], [0.18, 0.45], [0, 0.5]], { sides: 8, mat: M.gold }).scale(0.55, 1, 1).move(s * 0.64, 0.05, z));
  g.add('kashira', sweep([[0, 0, -3.02], [0, 0, -2.98], [0, 0, -2.9], [0, 0, -2.78], [0, 0, -2.3]], ellipse(0.76, 1.04, 20), { scale: (t, i) => [0.55, 0.8, 0.93, 1, 1][i], mat: M.lacquer, decals: [band(-2.52, -2.36)] }));
  g.mark('grip', [0, 0, 0]);
  g.mark('grip2', [0, 0, 3]);
  g.mark('muzzle', [0, yc(L) + spine(L), Z0 + L]);
  return g;
}

/**
 * The Briefcase: black pebbled leather over a hard shell, brass fittings and a steel valance at the
 * seam; its lid (the front half) leans open 12 degrees from its bottom edge, and gold light glows
 * from inside. A pickup: no markers.
 */
function briefcase() {
  const g = new Gun('briefcase', 'The Briefcase');
  const HINGE = [0, 0.45, 0];
  const OUTL = [[-5, 0.45, 0.8], [5, 0.45, 0.8], [5, 7.45, 0.8], [-5, 7.45, 0.8]];
  const INNER = [[-4.72, 0.73, 0.55], [4.72, 0.73, 0.55], [4.72, 7.17, 0.55], [-4.72, 7.17, 0.55]];
  const ring = (z) => fillet(OUTL, true, 3).map(([x, y]) => [x, y, z]);
  const stitch = (ctx, out) => {
    const [x, y, z] = ctx.lp;
    if (Math.abs(z) < 1.2 || Math.abs(ctx.n[2]) < 0.9) return;
    const bx = 5 - 0.45, by = 3.5 - 0.45, r = 0.35;
    const qx = Math.abs(x) - (bx - r), qy = Math.abs(y - 3.95) - (by - r);
    const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    if (Math.abs(sd) > 0.05) return;
    if ((x + y) / 0.3 - Math.floor((x + y) / 0.3) > 0.55) {
      out.c = mulc(out.c, 0.6);
      return;
    }
    out.c = [70, 62, 58];
    out.r = 0.6;
  };
  const keyhole = (ctx, out) => ctx.lp[2] > 1.6 && Math.hypot(Math.abs(ctx.lp[0]) - 2.98, ctx.lp[1] - 6.45) < 0.09 && (out.c = [40, 26, 8]);
  const dial = (ctx, out) => {
    const a = Math.atan2(ctx.lp[1], ctx.lp[0]);
    if (Math.abs(ctx.lp[2] - 0.18) < 0.12 && Math.sin(a * 5) > 0.6) out.c = mulc(out.c, 0.35);
  };
  // The back half with the handle.
  g.add('case back', along(OUTL, -1.45, -0.1, { mat: M.leather, bevel: 0.35, round: 3, decals: [stitch] }));
  g.add('valance', sweep(ring(-0.12), rect(0.26, 0.3), { closed: true, side: [0, 0, 1], mat: M.steel }));
  g.add('glow', along(INNER, -0.35, -0.05, { mat: M.golden }));
  const HP = fillet([[-2.3, 7.35], [-2.0, 8.9, 0.6], [2.0, 8.9, 0.6], [2.3, 7.35]], false, 4).map(([x, y]) => [x, y, -0.62]);
  g.add('handle', sweep(HP, rect(0.62, 0.5, 0.2), { side: [0, 0, 1], mat: M.leather }));
  for (const s of [1, -1]) g.add('handle mount', box([s * 1.8, 7.25, -1.0], [s * 2.8, 7.62, -0.25], { mat: M.brass, bevel: 0.12, round: 2 }));
  // The lid, leaning open, with the latches and the combination lock.
  const lid = [
    along(OUTL, 0.1, 1.45, { mat: M.leather, bevel: 0.35, round: 3, decals: [stitch] }),
    sweep(ring(0.12), rect(0.26, 0.3), { closed: true, side: [0, 0, 1], mat: M.steel }),
    along(INNER, 0.05, 0.35, { mat: M.golden }),
    box([-1.0, 6.2, 1.35], [1.0, 6.95, 1.6], { mat: M.brass, bevel: 0.08 }),
  ];
  for (const s of [1, -1]) lid.push(box([s * 2.4, 6.1, 1.35], [s * 3.55, 7.05, 1.72], { mat: M.brass, bevel: 0.1, decals: [keyhole] }));
  for (let k = 0; k < 3; k++) lid.push(alongX(cyl(0.26, 0, 0.34, { sides: 14, bevel: 0.03, mat: M.brass, decals: [dial] }), [-0.72 + k * 0.5, 6.58, 1.52]));
  for (const sx of [1, -1])
    for (const [y0, y1] of [[6.8, 7.57], [0.33, 1.1]]) {
      lid.push(box([sx * 4.35, y0, 1.15], [sx * 5.12, y1, 1.6], { mat: M.brass, bevel: 0.2, round: 2 }));
      g.add('corner', box([sx * 4.35, y0, -1.6], [sx * 5.12, y1, -1.15], { mat: M.brass, bevel: 0.2, round: 2 }));
    }
  for (const p of lid) g.add('lid', p.turn('x', 12, HINGE));
  for (const x of [-4, 4]) for (const z of [-0.8, 0.8]) g.add('foot', alongY(cyl(0.28, 0, 0.5, { sides: 12, bevel: 0.08, mat: M.brass }), [x, 0, z]));
  return g;
}

// ---------------------------------------------------------------------------------------------

/** Each model's size today (px, from the box models these replaced), to keep the first-person hold tuned. */
const SIZES = { pistol: [4, 12.77, 12], smg: [5, 20.5, 17], rifle: [6, 19.5, 28], shotgun: [6, 14.9, 29.5], sniper: [5.5, 12.84, 33], katana: [4, 5, 29.91], briefcase: [10.5, 10, 5.09] };
const MODELS = { pistol, smg, rifle, shotgun, sniper, katana, briefcase };
const args = process.argv.slice(2);
const fast = args.includes('--fast');
const only = args.filter((a) => !a.startsWith('--'));
mkdirSync(OUT, { recursive: true });
for (const [id, make] of Object.entries(MODELS)) {
  if (only.length && !only.includes(id)) continue;
  const t0 = Date.now();
  const gun = make();
  const b = build(gun, { bakeAO: !fast });
  const bytes = glb(gun, b);
  writeFileSync(join(OUT, `${gun.id}.glb`), bytes);
  validate(readFileSync(join(OUT, `${gun.id}.glb`)), gun);
  const lo = [0, 1, 2].map((k) => Math.min(...b.pos.filter((_, m) => m % 3 === k)) * 16);
  const hi = [0, 1, 2].map((k) => Math.max(...b.pos.filter((_, m) => m % 3 === k)) * 16);
  const size = hi.map((v, k) => +(v - lo[k]).toFixed(2));
  const fmt = (p) => `(${p.map((v) => +v.toFixed(2)).join(', ')})`;
  console.log(`${gun.id}.glb  ${gun.name}: ${gun.parts.length} parts, ${b.idx.length / 3} triangles, ${b.pos.length / 3} vertices, atlas ${b.W}x${b.H} at ${b.D.toFixed(1)} texels/px, ${(bytes.length / 1024).toFixed(1)} KB (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  const was = SIZES[id];
  console.log(`  size (px) x ${size[0]}  y ${size[1]}  z ${size[2]}  (${size.map((v, k) => `${v >= was[k] ? '+' : ''}${Math.round((v / was[k] - 1) * 100)}%`).join(' ')})   z ${fmt([lo[2], hi[2]])}  y ${fmt([lo[1], hi[1]])}`);
  console.log(`  markers ${Object.entries(gun.markers).map(([k, v]) => `${k} ${fmt(v)}`).join('  ')}`);
  console.log(`  bytes: ${Object.entries(b.bytes).map(([k, v]) => `${k} ${(v / 1024).toFixed(0)}K`).join(', ')}`);
  if (args.includes('--parts')) {
    const by = new Map();
    for (const p of gun.parts) by.set(p.name, (by.get(p.name) ?? 0) + p.tris.length);
    console.log(`  triangles by part: ${[...by].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
  if (bytes.length > 400 * 1024) console.log(`  WARNING: over 400 KB`);
  const blocked = clearView(gun, b.tris);
  if (blocked.length) throw new Error(`${gun.id}: the optic's window isn't clear: ${blocked.join('; ')}`);
  if (gun.window) console.log(`  optic window clear (z ${gun.window.z0}..${gun.window.z1}, y ${Math.min(...gun.window.poly.map((p) => p[1]))}..${Math.max(...gun.window.poly.map((p) => p[1]))}), from ${EYE_BACK} px behind`);
}
