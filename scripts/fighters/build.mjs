#!/usr/bin/env node
/**
 * Call of Blocky: the fighters, built procedurally and written as binary glTF 2.0 (`.glb`) to
 * `src/games/callofblocky/models/fighters/<id>.glb`, plus `index.ts` listing them. Dependency-free
 * (Node 22+): `node scripts/fighters/build.mjs [ids...]` (with ids, only those files are rebuilt and
 * index.ts is left alone). Every file is parsed back and checked after it's written: chunks,
 * accessors, winding, the rig (names, parents, rest positions, no rotations) and the budgets.
 *
 * Conventions (the platform's animation code relies on these; see docs/HUMANOID.md):
 *
 * - Units: metres (1 unit = 1 block). Origin on the ground between the feet, facing +z, +y up; the
 *   figure's own right is -x. The top of the head is at 1.82-1.86 (the fedora's crown 1.87); the
 *   eyes are at about 1.67.
 * - Rig: nodes named exactly hips > spine > chest > neck > head; chest > upperArmL > lowerArmL >
 *   handL > gripL (and the R mirror); hips > upperLegL > lowerLegL > footL (and R). Each has its rest
 *   translation (parent space) and no rotation or scale. The root node is named after the fighter's
 *   id (extras.title is its name). Joint heights are the doc's for every fighter; only the x of the
 *   shoulders (0.188-0.222) and hips (0.096-0.106) varies by build (see BUILDS).
 * - Rest pose: standing straight, arms hanging along -y. Geometry is rigid: each joint node has one
 *   child mesh node (`<joint>_mesh`) holding what that joint moves, in the joint's own space.
 *   Limb ends are faceted domes centred on their pivots, and each torso segment reaches into its
 *   neighbours with a smaller copy of itself, so elbows and knees bend ~130 degrees, hips and
 *   shoulders ~60 and spine + chest ~70 without opening gaps.
 * - Hands are fists (GRIP_R / GRIP_L). The right fist grips a vertical bar (a pistol grip): the hand
 *   reaches +z from the wrist (in the rest pose the wrist is cocked forward), palm toward +x, thumb
 *   on top, knuckles front-right. The left fist hangs below its wrist, palm toward -x, thumb forward,
 *   gripping a bar that runs along z (a handguard). It is the right fist mirrored and turned:
 *   right-hand (x, y, z) -> left (-x, -z, y). `gripR` / `gripL` are empty nodes at the centre of each
 *   fist's hold, identity rotation. The bar itself isn't modelled; a gun's grip passes through.
 * - Shading: low-poly and faceted. Parts are convex hulls (clipped by planes for cut edges and
 *   overlays) and lofts (hair, collars, the skirt, the brim). Every face has its own normal and
 *   vertices are shared only within a face; neighbouring triangles of one material within 7 degrees
 *   of coplanar are shaded as one face.
 * - Materials: glTF PBR metallic-roughness: baseColorFactor (linear) + metallicFactor +
 *   roughnessFactor, 10-19 per figure, one primitive per material per joint. A joint's primitives
 *   share one vertex buffer (POSITION, NORMAL); patterned cloth (pinstripes, Hawaiian print) has its
 *   own with TEXCOORD_0: a small repeating baseColorTexture (128 px, LINEAR, mipmapped, REPEAT), the
 *   colour baked in, a white factor, UVs a box projection in the joint's space (`uvScale` metres per
 *   tile). Untextured primitives have no UVs.
 * - Budgets (checked): <= 4000 triangles and <= 200 KB per file. Core glTF 2.0, no extensions.
 */
import { deflateSync, inflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../../src/games/callofblocky/models/fighters');
const MAX_TRIS = 4000;
const MAX_BYTES = 200 * 1024;

// ---------------------------------------------------------------------------------------------
// Vectors

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const nrm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mix1 = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const DEG = Math.PI / 180;
/** Mirror a point in x. */
const mx = (p) => [-p[0], p[1], p[2]];
/** Turn a point about an axis ('x'|'y'|'z') through a pivot, right-handed, degrees. */
function rot(p, axis, deg, o = [0, 0, 0]) {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  const [x, y, z] = sub(p, o);
  if (axis === 'x') return add(o, [x, y * c - z * s, y * s + z * c]);
  if (axis === 'y') return add(o, [z * s + x * c, y, z * c - x * s]);
  return add(o, [x * c - y * s, x * s + y * c, z]);
}

// ---------------------------------------------------------------------------------------------
// Colour

const hexRGB = (v) => [(v >> 16) & 255, (v >> 8) & 255, v & 255];
const toLinear = (c8) => {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
/** An sRGB hex colour as a linear baseColorFactor. */
const linear = (v) => [...hexRGB(v).map(toLinear), 1];
/** Scale an sRGB hex colour's brightness (in sRGB). */
const shade = (v, k) => {
  const [r, g, b] = hexRGB(v).map((c) => clamp(Math.round(c * k), 0, 255));
  return (r << 16) | (g << 8) | b;
};

// ---------------------------------------------------------------------------------------------
// Solids: convex hulls (clipped by planes) and lofts. A solid is a list of triangles [a, b, c]
// (points in the figure's rest space), counter-clockwise seen from outside.

function hash(a, b = 0, c = 0) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x3c6ef372, 0x165667b1) ^ Math.imul((c | 0) + 0x5bd1e995, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** The convex hull of a point cloud: { pts, faces: [{ v: [i, j, k], n, d }] }, faces outward. */
function hull(input) {
  const pts = [];
  const seen = new Set();
  for (const p of input) {
    if (p.some((v) => !Number.isFinite(v))) throw new Error('hull: bad point ' + p);
    const key = p.map((v) => Math.round(v * 2e5)).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    // A tiny deterministic jitter keeps coplanar and collinear inputs out of trouble.
    const k = pts.length;
    pts.push([p[0] + (hash(k, 1) - 0.5) * 2e-7, p[1] + (hash(k, 2) - 0.5) * 2e-7, p[2] + (hash(k, 3) - 0.5) * 2e-7]);
  }
  const n = pts.length;
  if (n < 4) throw new Error(`hull: ${n} points`);
  let i0 = 0;
  for (let i = 1; i < n; i++) if (pts[i][0] < pts[i0][0]) i0 = i;
  const far = (f) => {
    let best = -1, bi = -1;
    for (let i = 0; i < n; i++) {
      const d = f(pts[i]);
      if (d > best) (best = d), (bi = i);
    }
    return [bi, best];
  };
  const [i1] = far((p) => len(sub(p, pts[i0])));
  const e01 = sub(pts[i1], pts[i0]);
  const [i2] = far((p) => len(cross(e01, sub(p, pts[i0]))));
  const n012 = cross(e01, sub(pts[i2], pts[i0]));
  const [i3, vol] = far((p) => Math.abs(dot(n012, sub(p, pts[i0]))));
  if (vol < 1e-15) throw new Error('hull: flat point set');
  const mk = (a, b, c) => {
    const nn = nrm(cross(sub(pts[b], pts[a]), sub(pts[c], pts[a])));
    return { v: [a, b, c], n: nn, d: dot(nn, pts[a]) };
  };
  const cen = scl(add(add(pts[i0], pts[i1]), add(pts[i2], pts[i3])), 0.25);
  let faces = [];
  for (const [a, b, c] of [[i0, i1, i2], [i0, i2, i3], [i0, i3, i1], [i1, i3, i2]]) {
    let f = mk(a, b, c);
    if (dot(f.n, cen) - f.d > 0) f = mk(a, c, b);
    faces.push(f);
  }
  const EPS = 1e-9;
  for (let i = 0; i < n; i++) {
    if (i === i0 || i === i1 || i === i2 || i === i3) continue;
    const p = pts[i];
    const vis = new Set();
    faces.forEach((f, k) => {
      if (dot(f.n, p) - f.d > EPS) vis.add(k);
    });
    if (!vis.size) continue;
    const edges = new Set();
    for (const k of vis) {
      const [a, b, c] = faces[k].v;
      edges.add(a * 65536 + b).add(b * 65536 + c).add(c * 65536 + a);
    }
    const next = faces.filter((_, k) => !vis.has(k));
    for (const e of edges) {
      const a = Math.floor(e / 65536), b = e % 65536;
      if (!edges.has(b * 65536 + a)) next.push(mk(a, b, i));
    }
    faces = next;
  }
  return { pts, faces };
}

/**
 * A plane that keeps the half-space { p : n.p <= d }. `keep(point, towards)`: the plane through
 * `point` keeping the side `towards` points to.
 */
const keep = (point, towards) => {
  const n = scl(nrm(towards), -1);
  return { n, d: dot(n, point) };
};
/** The plane through the line a-b that also contains direction `dir`, keeping the side of `inside`. */
function keepSide(a, b, dir, inside) {
  let n = nrm(cross(sub(b, a), dir));
  if (dot(n, sub(inside, a)) > 0) n = scl(n, -1);
  return { n, d: dot(n, a) };
}
const above = (y) => keep([0, y, 0], [0, 1, 0]);
const below = (y) => keep([0, y, 0], [0, -1, 0]);
const xAbove = (x) => keep([x, 0, 0], [1, 0, 0]);
const xBelow = (x) => keep([x, 0, 0], [-1, 0, 0]);
const zAbove = (z) => keep([0, 0, z], [0, 0, 1]);
const zBelow = (z) => keep([0, 0, z], [0, 0, -1]);

/** Clip a convex point set by planes: the vertices of hull(points) ∩ planes. */
function clipPoints(points, planes) {
  let pts = points;
  for (const pl of planes) {
    const h = hull(pts);
    const side = h.pts.map((p) => dot(pl.n, p) - pl.d);
    const out = h.pts.filter((_, i) => side[i] <= 0);
    const done = new Set();
    for (const f of h.faces)
      for (let k = 0; k < 3; k++) {
        const a = f.v[k], b = f.v[(k + 1) % 3];
        const key = Math.min(a, b) * 65536 + Math.max(a, b);
        if (done.has(key)) continue;
        done.add(key);
        if ((side[a] < 0 && side[b] > 0) || (side[a] > 0 && side[b] < 0)) out.push(lerp(h.pts[a], h.pts[b], side[a] / (side[a] - side[b])));
      }
    pts = out;
    if (pts.length < 4) return [];
  }
  return pts;
}

/** A convex solid: the hull of `points`, clipped by `planes`. */
function solid(points, planes = []) {
  const pts = planes.length ? clipPoints(points, planes) : points;
  if (pts.length < 4) return [];
  let h;
  try {
    h = hull(pts);
  } catch {
    return [];
  }
  const tris = [];
  for (const f of h.faces) {
    const [a, b, c] = f.v.map((i) => h.pts[i]);
    if (len(cross(sub(b, a), sub(c, a))) < 1e-9) continue;
    tris.push([a, b, c]);
  }
  return tris;
}

/**
 * A loft through rings of points (each ring the same count, counter-clockwise seen from the end
 * the rings run toward), with fan caps. Non-convex shapes (a hollow hem) use this.
 */
function loft(rings, { start = true, end = true } = {}) {
  const tris = [];
  const n = rings[0].length;
  for (let r = 0; r + 1 < rings.length; r++) {
    const A = rings[r], B = rings[r + 1];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      tris.push([A[i], A[j], B[j]], [A[i], B[j], B[i]]);
    }
  }
  const cap = (R, flip) => {
    const c = scl(R.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / R.length);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      tris.push(flip ? [c, R[i], R[j]] : [c, R[j], R[i]]);
    }
  };
  if (start) cap(rings[0], false);
  if (end) cap(rings[rings.length - 1], true);
  const out = tris.filter(([a, b, c]) => len(cross(sub(b, a), sub(c, a))) > 1e-10);
  // Face outward whichever way the rings were given: a closed surface's signed volume is positive.
  let vol = 0;
  for (const [a, b, c] of out) vol += dot(a, cross(b, c));
  return vol >= 0 || !(start && end) ? out : out.map(([a, b, c]) => [a, c, b]);
}

/**
 * Sweep a closed profile along a path: path [{ p, n, u }] (a point, the profile's outward and up
 * directions there); profile(i) -> [[a, b], ...] (a along n, b along u). Capped at both ends.
 */
function sweep(path, profile) {
  const rings = path.map((q, i) => profile(i).map(([a, b]) => add(q.p, add(scl(q.n, a), scl(q.u, b)))));
  return loft(rings);
}

/** Where a ray from o along unit d leaves a convex solid (its triangles), or null. */
function rayOut(tris, o, d) {
  let best = null;
  for (const [a, b, c] of tris) {
    const e1 = sub(b, a), e2 = sub(c, a);
    const pv = cross(d, e2);
    const det = dot(e1, pv);
    if (Math.abs(det) < 1e-14) continue;
    const tv = sub(o, a);
    const u = dot(tv, pv) / det;
    if (u < -1e-9 || u > 1 + 1e-9) continue;
    const qv = cross(tv, e1);
    const v = dot(d, qv) / det;
    if (v < -1e-9 || u + v > 1 + 1e-9) continue;
    const t = dot(e2, qv) / det;
    if (t > 0 && (best === null || t > best)) best = t;
  }
  return best;
}

const mirrorTris = (tris) => tris.map(([a, b, c]) => [mx(a), mx(c), mx(b)]);
const mapTris = (tris, f, flip = false) => tris.map(([a, b, c]) => (flip ? [f(a), f(c), f(b)] : [f(a), f(b), f(c)]));
const moveTris = (tris, o) => mapTris(tris, (p) => add(p, o));

/** Superellipse ring in a horizontal plane: n points, front at z = f (> 0), back at z = b (< 0). */
function ring(c, hw, f, b, n = 12, p = 2, phase = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = phase + (i / n) * Math.PI * 2;
    const ct = Math.cos(t), st = Math.sin(t);
    const x = hw * Math.sign(ct) * Math.pow(Math.abs(ct), 2 / p);
    const z = (st >= 0 ? f : b) * Math.pow(Math.abs(st), 2 / p);
    out.push([c[0] + x, c[1], c[2] + z]);
  }
  return out;
}

/**
 * A limb: rings along y (each { y, rx, rz, x?, z? }), each end closed by a faceted dome centred on
 * the end ring's centre. n sides; the phase puts a face (not a corner) toward +-x and +-z.
 */
function limb(rings, { n = 8, domeTop = true, domeBottom = true, phase = Math.PI / n, grow = 0, crease = 0, domeScale = 1, domeRings = [38, 70] } = {}) {
  const pts = [];
  const R = (r, y, k = 1) => {
    const out = ring([r.x ?? 0, y, r.z ?? 0], (r.rx + grow) * k, (r.rz + grow) * k, -(r.rz + grow) * k, n, 2, phase);
    if (crease) for (const q of out) if (Math.abs(q[0] - (r.x ?? 0)) < 1e-6 || q[2] - (r.z ?? 0) > (r.rz + grow) * k * 0.95) q[2] += crease * k;
    return out;
  };
  for (const r of rings) pts.push(...R(r, r.y));
  const dome = (r, dir, k) => {
    const rr = Math.min(r.rx, r.rz) + grow;
    for (const e of domeRings) pts.push(...R(r, r.y + dir * rr * Math.sin(e * DEG) * k, Math.cos(e * DEG)));
  };
  if (domeTop) dome(rings[0].y > rings[rings.length - 1].y ? rings[0] : rings[rings.length - 1], 1, domeScale);
  if (domeBottom) dome(rings[0].y > rings[rings.length - 1].y ? rings[rings.length - 1] : rings[0], -1, 1);
  return pts;
}

/** Points on an ellipsoid (centre c, radii r) in nu x nv, optionally squared off (p > 2). */
function ellipsoid(c, r, nu = 10, nv = 7, p = 2) {
  const out = [];
  const sp = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
  for (let j = 0; j <= nv; j++) {
    const v = -Math.PI / 2 + (j / nv) * Math.PI;
    for (let i = 0; i < (j === 0 || j === nv ? 1 : nu); i++) {
      const u = (i / nu) * Math.PI * 2 + Math.PI / nu;
      const cv = Math.cos(v);
      out.push([c[0] + r[0] * sp(cv, 2 / p) * sp(Math.cos(u), 2 / p), c[1] + r[1] * sp(Math.sin(v), 2 / p), c[2] + r[2] * sp(cv, 2 / p) * sp(Math.sin(u), 2 / p)]);
    }
  }
  return out;
}

/** A box (optionally chamfered on its vertical edges by ch) as points. */
function box(lo, hi, ch = 0) {
  const out = [];
  for (const y of [lo[1], hi[1]])
    for (const [x, z] of [
      [lo[0], lo[2]],
      [hi[0], lo[2]],
      [hi[0], hi[2]],
      [lo[0], hi[2]],
    ]) {
      if (!ch) out.push([x, y, z]);
      else {
        const sx = x === lo[0] ? 1 : -1, sz = z === lo[2] ? 1 : -1;
        out.push([x + sx * ch, y, z], [x, y, z + sz * ch]);
      }
    }
  return out;
}

/** Push points outward from a centre by t (per axis weights w). */
function inflateFrom(points, c, t, w = [1, 1, 1]) {
  return points.map((p) => {
    const q = nrm(sub(p, c));
    return [p[0] + q[0] * t * w[0], p[1] + q[1] * t * w[1], p[2] + q[2] * t * w[2]];
  });
}

/** Where a ray down -z at (x, y) first meets a solid's surface (its largest z), or null. */
function surfaceZ(tris, x, y) {
  let best = null;
  for (const [a, b, c] of tris) {
    const n = cross(sub(b, a), sub(c, a));
    if (n[2] <= 1e-12) continue;
    // Barycentric test in xy.
    const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(d) < 1e-14) continue;
    const l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d;
    const l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
    const z = l1 * a[2] + l2 * b[2] + l3 * c[2];
    if (best === null || z > best) best = z;
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Textures: small repeating patterns (RGBA), painted analytically with soft edges.

function texture(name, size, paint) {
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      // 4x supersampling for clean edges.
      let r = 0, g = 0, b = 0;
      for (const [ox, oy] of [
        [0.25, 0.25],
        [0.75, 0.25],
        [0.25, 0.75],
        [0.75, 0.75],
      ]) {
        const c = paint((x + ox) / size, (y + oy) / size);
        r += c[0];
        g += c[1];
        b += c[2];
      }
      const i = (y * size + x) * 4;
      px[i] = Math.round(r / 4);
      px[i + 1] = Math.round(g / 4);
      px[i + 2] = Math.round(b / 4);
      px[i + 3] = 255;
    }
  return { name, w: size, h: size, px };
}

/** Pinstripes: thin light lines on the cloth, every 1/n of the tile. */
function pinstripe(base, line, n = 6, width = 0.11) {
  const B = hexRGB(base), L = hexRGB(line);
  return texture('pinstripe', 128, (u) => {
    const f = (u * n) % 1;
    const d = Math.abs(f - 0.5);
    return d < width / 2 ? L : B;
  });
}

/** Hawaiian print: hibiscus flowers and leaves on the shirt colour, tiling. */
function hawaiian(base, petal, centre, leaf) {
  const B = hexRGB(base), P = hexRGB(petal), C = hexRGB(centre), Lf = hexRGB(leaf), W = hexRGB(0xfff4d6);
  const flowers = [
    [0.22, 0.26, 0.15, 0.3],
    [0.72, 0.62, 0.16, 1.4],
    [0.7, 0.08, 0.1, 2.2],
    [0.2, 0.8, 0.11, 0.9],
  ];
  const leaves = [
    [0.47, 0.35, 0.16, 0.6],
    [0.05, 0.55, 0.14, 2.4],
    [0.93, 0.35, 0.12, 1.9],
    [0.45, 0.9, 0.15, 0.2],
    [0.5, 0.12, 0.1, 1.2],
  ];
  const wrap = (d) => d - Math.round(d);
  return texture('hawaiian', 128, (u, v) => {
    let c = B;
    for (const [x, y, r, a] of leaves) {
      const dx = wrap(u - x), dy = wrap(v - y);
      const ca = Math.cos(a), sa = Math.sin(a);
      const lx = dx * ca + dy * sa, ly = -dx * sa + dy * ca;
      // A pointed leaf: |ly| < w(lx), with a midrib.
      const t = lx / r;
      if (t > -1 && t < 1) {
        const w = 0.42 * r * (1 - t * t) * (t < 0 ? 1 : 1 - 0.25 * t);
        if (Math.abs(ly) < w) c = Math.abs(ly) < r * 0.03 ? B : Lf;
      }
    }
    for (const [x, y, r, a] of flowers) {
      const dx = wrap(u - x), dy = wrap(v - y);
      const d = Math.hypot(dx, dy);
      const th = Math.atan2(dy, dx) + a;
      const petals = r * (0.62 + 0.38 * Math.abs(Math.cos(2.5 * th)));
      if (d < petals) {
        c = P;
        if (d < r * 0.5 && Math.abs(Math.sin(2.5 * th)) < 0.12) c = W; // petal veins
        if (d < r * 0.2) c = C;
      }
    }
    return c;
  });
}

// ---------------------------------------------------------------------------------------------
// The figure: joints, materials, parts.

/** The centre of the right fist's hold from its wrist (for a regular hand; see fistScale). */
const GRIP_R = [0.005, -0.03, 0.075];
/** Hands are smaller on the women, larger on the big-armed builds. */
const fistScale = (b) => (b.fem ? 0.88 : b.arm > 1.05 ? 1.06 : 1);
/** The left hand is the right one mirrored and turned: right-hand (x, y, z) -> left (-x, -z, y). */
const toLeftHand = (p) => [-p[0], -p[2], p[1]];
const GRIP_L = toLeftHand(GRIP_R);

const JOINT_PARENT = {
  hips: null,
  spine: 'hips',
  chest: 'spine',
  neck: 'chest',
  head: 'neck',
  upperArmL: 'chest',
  lowerArmL: 'upperArmL',
  handL: 'lowerArmL',
  gripL: 'handL',
  upperArmR: 'chest',
  lowerArmR: 'upperArmR',
  handR: 'lowerArmR',
  gripR: 'handR',
  upperLegL: 'hips',
  lowerLegL: 'upperLegL',
  footL: 'lowerLegL',
  upperLegR: 'hips',
  lowerLegR: 'upperLegR',
  footR: 'lowerLegR',
};
const EMPTY = new Set(['gripL', 'gripR']);

class Figure {
  constructor(id, name, b) {
    this.id = id;
    this.name = name;
    this.b = b;
    this.parts = {};
    this.materials = [];
    this.matKey = {};
    this.textures = [];
    const sx = b.sx, hx = b.hx;
    this.J = {
      hips: [0, 0.95, 0],
      spine: [0, 1.05, 0],
      chest: [0, 1.27, 0],
      neck: [0, 1.51, 0],
      head: [0, 1.58, 0],
      upperArmL: [sx, 1.46, 0],
      lowerArmL: [sx, 1.18, 0],
      handL: [sx, 0.93, 0],
      upperArmR: [-sx, 1.46, 0],
      lowerArmR: [-sx, 1.18, 0],
      handR: [-sx, 0.93, 0],
      upperLegL: [hx, 0.91, 0],
      lowerLegL: [hx, 0.48, 0],
      footL: [hx, 0.07, 0],
      upperLegR: [-hx, 0.91, 0],
      lowerLegR: [-hx, 0.48, 0],
      footR: [-hx, 0.07, 0],
    };
    const k = fistScale(b);
    this.J.gripR = add(this.J.handR, scl(GRIP_R, k));
    this.J.gripL = add(this.J.handL, scl(GRIP_L, k));
  }
  /** A material: colour (sRGB hex), roughness, metalness, an optional texture ({ tex, uvScale }). */
  mat(key, color, rough, metal = 0, extra = {}) {
    if (this.matKey[key] !== undefined) return key;
    this.matKey[key] = this.materials.length;
    this.materials.push({ key, color, rough, metal, ...extra });
    return key;
  }
  add(joint, mat, tris) {
    if (!(joint in this.J) || EMPTY.has(joint)) throw new Error(`no joint ${joint}`);
    if (this.matKey[mat] === undefined) throw new Error(`${this.id}: no material ${mat}`);
    ((this.parts[joint] ??= {})[mat] ??= []).push(...tris);
    return tris;
  }
  /** A convex part (hull of points, clipped by planes) on a joint. */
  solid(joint, mat, pts, planes = []) {
    return this.add(joint, mat, solid(pts, planes));
  }
  /** The same part on the left (as given, +x) and mirrored onto the right joint. */
  pair(jointL, mat, tris) {
    this.add(jointL, mat, tris);
    this.add(jointL.replace(/L$/, 'R'), mat, mirrorTris(tris));
  }
  pairSolid(jointL, mat, pts, planes = []) {
    this.pair(jointL, mat, solid(pts, planes));
  }
  get triangles() {
    let n = 0;
    for (const j of Object.values(this.parts)) for (const t of Object.values(j)) n += t.length;
    return n;
  }
}

// ---------------------------------------------------------------------------------------------
// Builds: shoulder and hip joints (x), girths. Heights are the rig's for everyone.

const BUILDS = {
  slim: { sx: 0.2, hx: 0.098, W: 0.95, D: 0.95, arm: 0.93, leg: 0.94, neck: 0.95, head: 1.0, belly: 0, fem: false },
  regular: { sx: 0.205, hx: 0.1, W: 1, D: 1, arm: 1, leg: 1, neck: 1, head: 1, belly: 0, fem: false },
  broad: { sx: 0.222, hx: 0.104, W: 1.1, D: 1.06, arm: 1.14, leg: 1.08, neck: 1.15, head: 1.03, belly: 0, fem: false },
  heavy: { sx: 0.218, hx: 0.106, W: 1.12, D: 1.12, arm: 1.1, leg: 1.1, neck: 1.12, head: 1.04, belly: 0.03, fem: false },
  female: { sx: 0.188, hx: 0.096, W: 0.9, D: 0.94, arm: 0.84, leg: 0.92, neck: 0.84, head: 0.96, belly: 0, fem: true },
  athlete: { sx: 0.19, hx: 0.097, W: 0.93, D: 0.95, arm: 0.9, leg: 0.96, neck: 0.88, head: 0.96, belly: 0, fem: true },
};

/** The trunk's outer surface (a shirt over the body): [y, half width, front z, back z]. */
const TRUNK_M = [
  [0.8, 0.115, 0.05, -0.075],
  [0.86, 0.152, 0.08, -0.106],
  [0.93, 0.156, 0.093, -0.112],
  [1.0, 0.146, 0.092, -0.1],
  [1.05, 0.14, 0.092, -0.095],
  [1.12, 0.141, 0.098, -0.095],
  [1.2, 0.148, 0.106, -0.098],
  [1.28, 0.156, 0.114, -0.102],
  [1.36, 0.162, 0.117, -0.105],
  [1.42, 0.176, 0.108, -0.102],
  [1.47, 0.196, 0.08, -0.09],
];
const TRUNK_F = [
  [0.8, 0.112, 0.046, -0.078],
  [0.86, 0.16, 0.076, -0.112],
  [0.93, 0.162, 0.088, -0.114],
  [1.0, 0.145, 0.083, -0.098],
  [1.06, 0.126, 0.079, -0.087],
  [1.13, 0.128, 0.085, -0.087],
  [1.2, 0.136, 0.098, -0.089],
  [1.27, 0.144, 0.12, -0.092],
  [1.34, 0.148, 0.114, -0.094],
  [1.41, 0.162, 0.096, -0.092],
  [1.47, 0.18, 0.072, -0.08],
];

function trunkAt(s, y) {
  const T = s.b.fem ? TRUNK_F : TRUNK_M;
  let k = 0;
  while (k < T.length - 2 && T[k + 1][0] < y) k++;
  const [y0, w0, f0, b0] = T[k], [y1, w1, f1, b1] = T[k + 1];
  const t = (y - y0) / (y1 - y0);
  const deep = s.b.fem ? 1.06 : 1.1;
  let w = mix1(w0, w1, t) * s.b.W, f = mix1(f0, f1, t) * s.b.D * deep, b = mix1(b0, b1, t) * s.b.D * deep;
  // A belly: forward and a little wider around the navel.
  if (s.b.belly) {
    const k2 = Math.max(0, 1 - Math.abs(y - 1.1) / 0.17);
    f += s.b.belly * k2 * 1.3;
    w += s.b.belly * k2 * 0.5;
  }
  return { w, f, b };
}

/** Trunk points between y0 and y1 (rings every ~5 cm), grown by g, with a squared-off section. */
function trunkPoints(s, y0, y1, g = 0, { n = 12, p = 2.5, extra = null } = {}) {
  const pts = [];
  const steps = Math.max(1, Math.ceil((y1 - y0) / 0.07 - 1e-9));
  for (let i = 0; i <= steps; i++) {
    const y = y0 + ((y1 - y0) * i) / steps;
    const t = trunkAt(s, y);
    const e = extra ? extra(y) : { w: 0, f: 0, b: 0 };
    pts.push(...ring([0, y, 0], t.w + g + e.w, t.f + g + e.f, t.b - g - e.b, n, p, 0));
  }
  return pts;
}

/** The shoulder line and the base of the neck above the trunk's last ring. */
function shoulderPoints(s, g) {
  const sx = s.b.sx;
  const pts = [];
  for (const side of [1, -1]) {
    pts.push([side * (sx + 0.014 + g), 1.472 + g, 0.046 + g], [side * (sx + 0.014 + g), 1.472 + g, -0.05 - g]);
    pts.push([side * (sx + 0.004 + g), 1.487 + g, 0.036 + g], [side * (sx + 0.004 + g), 1.487 + g, -0.04 - g]);
    pts.push([side * (sx * 0.6 + g), 1.503 + g, 0.062 + g], [side * (sx * 0.6 + g), 1.503 + g, -0.07 - g]);
    pts.push([side * (0.066 + g), 1.52 + g, 0.05 + g], [side * (0.066 + g), 1.52 + g, -0.062 - g]);
  }
  return pts;
}

const neckR = (s) => (s.b.fem ? 0.05 : 0.054) * s.b.neck;
/** The neck's centre line sits a little behind the rig's axis. */
const NECK_Z = -0.008;

// ---------------------------------------------------------------------------------------------
// The body generator. `s` = { fig, b: build, o: outfit, d: the outfit's colours }.

function legs(fig, s) {
  const { o, b } = s;
  const g = b.leg;
  const hx = b.hx;
  const L = (y, rx, rz, extra = {}) => ({ y, rx: rx * g, rz: rz * g, x: hx, ...extra });
  const bare = o.legs === 'bare';
  const thigh = [L(0.91, bare ? 0.08 : 0.09, 0.088), L(0.78, bare ? 0.075 : 0.084, 0.081), L(0.6, bare ? 0.062 : 0.072, 0.068), L(0.48, bare ? 0.056 : 0.064, 0.062)];
  // Upper leg: the thigh from its hip dome to the knee dome.
  if (o.legs === 'shorts') {
    fig.pairSolid('upperLegL', 'pants', limb([L(0.91, 0.094, 0.092), L(0.75, 0.092, 0.089), L(0.57, 0.09, 0.086)], { domeBottom: false }));
    fig.pairSolid('upperLegL', 'skin', limb([L(0.6, 0.066, 0.064), L(0.52, 0.056, 0.056), L(0.48, 0.054, 0.054)], { domeTop: false }));
  } else {
    fig.pairSolid('upperLegL', bare ? 'skin' : 'pants', limb(thigh, { crease: o.crease ? 0.006 : 0, domeRings: [50] }));
  }
  // Lower leg: the knee dome, then trousers (or a bare calf) down to the ankle.
  if (o.legs === 'shorts' || bare) {
    const k = bare ? 0.92 : 1;
    fig.pairSolid('lowerLegL', 'skin', limb([L(0.48, 0.052 * k, 0.052 * k), L(0.38, 0.055 * k, 0.059 * k, { z: -0.008 }), L(0.25, 0.046 * k, 0.049 * k, { z: -0.004 }), L(0.12, 0.033 * k, 0.035 * k), L(0.07, 0.031 * k, 0.033 * k)], { domeBottom: false }));
    if (o.socks) fig.pairSolid('lowerLegL', 'socks', limb([L(0.15, 0.037 * k, 0.039 * k), L(0.075, 0.036 * k, 0.038 * k)], { domeTop: false, domeBottom: false }));
  } else if (o.legs === 'cigarette') {
    // Slim trousers that stop above the ankle.
    fig.pairSolid('lowerLegL', 'pants', limb([L(0.48, 0.059, 0.059), L(0.38, 0.056, 0.059), L(0.2, 0.046, 0.048), L(0.13, 0.043, 0.045)], { domeBottom: false, crease: 0.004 }));
    fig.pairSolid('lowerLegL', 'skin', limb([L(0.14, 0.032, 0.033), L(0.07, 0.03, 0.031)], { domeTop: false, domeBottom: false }));
  } else {
    const fl = o.legs === 'track' ? 1.07 : 1;
    fig.pairSolid('lowerLegL', 'pants', limb([L(0.48, 0.062, 0.062), L(0.38, 0.061, 0.063), L(0.22, 0.058 * fl, 0.059 * fl), L(0.1, 0.059 * fl, 0.06 * fl), L(0.07, 0.06 * fl, 0.062 * fl, { z: 0.004 })], { domeBottom: false, crease: o.crease ? 0.005 : 0 }));
  }
  // A stripe down the outside of each leg (the tracksuit).
  if (o.legStripe) {
    const up = limb(thigh, { grow: 0.003, domeTop: false, domeBottom: false });
    fig.pairSolid('upperLegL', 'stripe', up, [xAbove(hx + 0.02), zAbove(-0.012), zBelow(0.012), below(0.86)]);
    const lo = limb([L(0.48, 0.062, 0.062), L(0.38, 0.061, 0.063), L(0.22, 0.062, 0.063), L(0.1, 0.063, 0.064), L(0.07, 0.064, 0.066)], { grow: 0.003, domeTop: false, domeBottom: false });
    fig.pairSolid('lowerLegL', 'stripe', lo, [xAbove(hx + 0.02), zAbove(-0.012), zBelow(0.012), above(0.08)]);
  }
  shoes(fig, s);
}

function shoes(fig, s) {
  const { o, b } = s;
  const hx = b.hx;
  const fem = b.fem;
  const W = fem ? 0.92 : 1.1, Lg = fem ? 0.98 : 1.1;
  const A = 0.07; // ankle height
  const style = o.shoeStyle ?? 'oxford';
  const sole = style === 'sneaker' ? 0.024 : 0.014;
  const P = (x, y, z) => [hx + x * W, A + y, z * Lg];
  const half = [
    // heel
    [0.034, -A + sole, -0.062],
    [0.036, -0.02, -0.068],
    [0.0, -0.015, -0.074],
    [0.028, 0.02, -0.058],
    [0.0, 0.028, -0.062],
    // collar / ankle opening
    [0.04, 0.022, -0.02],
    [0.041, 0.018, 0.03],
    [0.0, 0.034, 0.03],
    // instep
    [0.037, 0.0, 0.08],
    [0.0, 0.018, 0.085],
    // ball of the foot (widest)
    [0.047, -A + sole, 0.11],
    [0.046, -0.035, 0.12],
    // toe box
    [0.04, -0.03, 0.17],
    [0.026, -0.036, 0.205],
    [0.0, -0.031, 0.18],
    [0.0, -0.041, 0.214],
    [0.03, -A + sole, 0.2],
    [0.0, -A + sole, 0.215],
    [0.036, -A + sole, -0.03],
  ];
  const all = [];
  for (const [x, y, z] of half) all.push(P(x, y, z), P(-x, y, z));
  if (style === 'flat') {
    // A low ballet flat: the instep bare above it.
    fig.pairSolid('footL', 'shoes', all, [below(A - 0.012)]);
    fig.pairSolid('footL', 'skin', [...ring([hx, A - 0.02, 0.02], 0.028, 0.05, -0.045, 8), ...ring([hx, A + 0.02, -0.005], 0.029, 0.032, -0.032, 8)]);
  } else {
    fig.pairSolid('footL', 'shoes', all);
  }
  // The sole: a slightly wider slab under it.
  const slab = [];
  for (const p of all)
    if (p[1] <= sole + 1e-6) {
      const x = hx + (p[0] - hx) * 1.06, z = p[2] * 1.025 + (p[2] > 0 ? 0.002 : -0.002);
      slab.push([x, 0, z], [x, sole + 0.001, z]);
    }
  fig.pairSolid('footL', 'sole', slab);
  if (o.shoeStripes) {
    // Two black stripes crossing each side of the shoe (the Bride's sneakers).
    const up = inflateFrom(all, [hx, A - 0.03, 0.07], 0.0025);
    for (const side of [1, -1])
      for (const [dz, lean] of [
        [0.0, 1],
        [0.05, -1],
      ]) {
        const a0 = [hx, A - 0.05, 0.03 + dz], a1 = [hx, A + 0.02, 0.03 + dz - lean * 0.05];
        fig.pairSolid('footL', 'stripe', up, [side > 0 ? xAbove(hx + 0.02) : xBelow(hx - 0.02), keepSide(a0, a1, [1, 0, 0], [hx, 0.03, -1]), keepSide(add(a0, [0, 0, 0.012]), add(a1, [0, 0, 0.012]), [1, 0, 0], [hx, 0.03, 1]), above(sole + 0.004)]);
      }
  }
}

function pelvis(fig, s) {
  const { o } = s;
  const pm = o.legs === 'bare' ? 'dress' : 'pants';
  // The seat and hips of the trousers (or the skirt's lining), reaching up into the belly.
  fig.solid('hips', pm, [...trunkPoints(s, 0.8, 1.045, -0.004, { n: 10 }), ...trunkPoints(s, 1.11, 1.11, -0.024, { n: 10 })]);
  if (o.belt) {
    fig.solid('hips', 'belt', trunkPoints(s, 1.0, 1.045, 0.004, { n: 16 }), o.jacket && !o.openJacket ? [zAbove(0.02)] : []);
    const t = trunkAt(s, 1.02);
    fig.solid('hips', 'buckle', box([-0.022, 1.004, t.f], [0.022, 1.041, t.f + 0.011]));
  }
  if (o.skirt) skirt(fig, s);
}

/** A flared skirt from the waist to above the knee (hips), turned up inside at the hem. */
function skirt(fig, s) {
  const { o } = s;
  const n = 16;
  const ys = [1.08, 1.0, 0.9, 0.78, o.skirt];
  const rings = ys.map((y) => {
    const t = trunkAt(s, Math.max(y, 0.9));
    const fl = y < 0.93 ? (0.93 - y) * 0.3 : 0;
    return ring([0, y, -0.004], t.w + 0.008 + fl * 0.55, t.f + 0.008 + fl, t.b - 0.008 - fl, n, 2.2, 0);
  });
  const last = rings[rings.length - 1];
  const inner = last.map((p) => [p[0] * 0.9, p[1] + 0.035, p[2] * 0.9]);
  fig.add('hips', 'dress', loft([...rings, inner]));
  if (o.apron) {
    const grown = rings.flatMap((r) => r.map((p) => [p[0] * 1.025, p[1], p[2] * 1.03 + 0.002]));
    fig.solid('hips', 'apron', grown, [zAbove(0.03), xBelow(0.095), xAbove(-0.095), above(o.skirt + 0.06), below(1.035)]);
    // The waistband and its ties.
    fig.solid('hips', 'apron', trunkPoints(s, 1.03, 1.06, 0.012, { n: 16 }));
  }
}

/**
 * The trunk. Segments: hips (the hem, below 1.045), spine (1.045-1.27), chest (1.27-top); each
 * reaches into its neighbours with a smaller copy of itself so bends never open a gap. With a
 * jacket, each segment is two halves cut along the open front (the lapels' V above the button,
 * the parted fronts below), the shirt and tie set back inside.
 */
const SEGS = [
  ['spine', 1.045, 1.27],
  ['chest', 1.27, 1.47],
];

function segmentPoints(s, seg, g) {
  const [joint, y0, y1] = seg;
  const pts = trunkPoints(s, y0, y1, g);
  if (joint === 'chest') pts.push(...shoulderPoints(s, g));
  else pts.push(...trunkPoints(s, y1 + 0.07, y1 + 0.07, g - 0.024));
  pts.push(...trunkPoints(s, y0 - 0.07, y0 - 0.07, g - 0.024));
  return pts;
}

/** The open front of a shirt (a V down to `depth`) or a jacket (see jacketEdge). */
function frontCut(s, side, edge) {
  // edge: [[x, y], ...] from the collar down; the kept side is away from the middle.
  const planes = [];
  const J = s.o.jacket ? s.o.jacketGrow ?? 0.012 : 0;
  for (let k = 0; k + 1 < edge.length; k++) {
    const [x0, y0] = edge[k], [x1, y1] = edge[k + 1];
    const a = [side * x0, y0, trunkAt(s, y0).f + J], bb = [side * x1, y1, trunkAt(s, y1).f + J];
    planes.push(keepSide(a, bb, [-side * 0.45, 0, -1], [side * 0.4, (y0 + y1) / 2, 0]));
  }
  return planes;
}

/** The edge of a jacket's open front, from the collar down to the hem (x >= 0). */
function jacketEdge(s) {
  const o = s.o;
  const top = o.vTop ?? 0.052;
  if (o.openJacket) return [
    [top, 1.49],
    [top + 0.004, 1.2],
    [top + 0.01, 0.8],
  ];
  const button = o.button ?? 1.1;
  return [
    [top, 1.49],
    [0, button],
    [o.hemOpen ?? 0.075, 0.8],
  ];
}

function torso(fig, s) {
  const { o } = s;
  const shirtMat = o.shirtMat ?? 'shirt';
  if (!o.jacket) {
    // A shirt (or dress, or tracksuit top) is the outer layer; open collars show a V of skin.
    for (const seg of SEGS) {
      const pts = segmentPoints(s, seg, 0);
      if (o.neckV) {
        const edge = [
          [o.neckVTop ?? 0.05, 1.5],
          [0, o.neckV],
        ];
        for (const side of [1, -1]) fig.solid(seg[0], shirtMat, pts, [side > 0 ? xAbove(0) : xBelow(0), ...frontCut(s, side, edge)]);
        if (seg[0] === 'chest') fig.solid('chest', 'skin', [...trunkPoints(s, o.neckV - 0.02, 1.47, -0.006), ...shoulderPoints(s, -0.006)], [xBelow(0.07), xAbove(-0.07), zAbove(0.0)]);
      } else fig.solid(seg[0], shirtMat, pts);
    }
    return;
  }
  const J = o.jacketGrow ?? 0.012;
  const edge = jacketEdge(s);
  for (const seg of SEGS) {
    const pts = segmentPoints(s, seg, J);
    for (const side of [1, -1]) fig.solid(seg[0], 'jacket', pts, [side > 0 ? xAbove(0) : xBelow(0), ...frontCut(s, side, edge)]);
    // The shirt, set back inside the opening.
    const lo = seg[0] === 'spine' ? seg[1] - 0.02 : seg[1] - 0.03;
    const shirt = trunkPoints(s, lo, seg[2] + (seg[0] === 'chest' ? 0 : 0.03), 0);
    if (seg[0] === 'chest') shirt.push(...shoulderPoints(s, 0));
    const w = (o.vTop ?? 0.052) + 0.03;
    fig.solid(seg[0], shirtMat, shirt, [zAbove(0.02), xBelow(o.openJacket ? w + 0.02 : w), xAbove(o.openJacket ? -w - 0.02 : -w)]);
  }
  if (o.ruffles) {
    // Ruffles down the shirt front (the Crooner).
    for (let k = 0; k < 5; k++) {
      const y = 1.43 - k * 0.045;
      const t = trunkAt(s, y);
      const w = 0.028 - k * 0.002;
      for (const joint of [y > 1.27 ? 'chest' : 'spine'])
        fig.solid(joint, 'shirt', [
          [-w, y + 0.012, t.f + 0.002],
          [w, y + 0.012, t.f + 0.002],
          [-w * 1.1, y - 0.014, t.f + 0.012],
          [w * 1.1, y - 0.014, t.f + 0.012],
          [-w, y - 0.016, t.f],
          [w, y - 0.016, t.f],
          [0, y - 0.018, t.f + 0.014],
        ]);
    }
  }
}

/** The jacket's hem (on the hips), or an untucked shirt's tail. */
function hem(fig, s) {
  const { o } = s;
  if (!o.jacket) {
    if (o.untucked) {
      const pts = [...trunkPoints(s, o.untucked, 1.045, 0.008, { extra: (y) => ({ w: 0.004 * clamp((1.0 - y) / 0.1, 0, 1), f: 0, b: 0 }) }), ...trunkPoints(s, 1.11, 1.11, -0.016)];
      if (o.neckV) fig.solid('hips', o.shirtMat ?? 'shirt', pts);
      else fig.solid('hips', o.shirtMat ?? 'shirt', pts);
    }
    return;
  }
  const J = o.jacketGrow ?? 0.012;
  const hemY = o.hemY ?? 0.83;
  const flare = (y) => {
    const k = clamp((1.0 - y) / 0.15, 0, 1);
    return { w: 0.012 * k, f: 0.004 * k, b: 0.01 * k };
  };
  const pts = trunkPoints(s, Math.max(hemY, 0.88), 1.045, J, { extra: flare });
  if (hemY < 0.88) {
    // Below the seat the trunk narrows into the crotch; the jacket keeps falling straight.
    const t = trunkAt(s, 0.9), e = flare(0.9);
    pts.push(...ring([0, hemY, 0], t.w + J + e.w, t.f + J + e.f, t.b - J - e.b, 12, 2.5, 0));
  }
  pts.push(...trunkPoints(s, 1.115, 1.115, J - 0.024));
  const edge = jacketEdge(s);
  for (const side of [1, -1]) fig.solid('hips', 'jacket', pts, [side > 0 ? xAbove(0) : xBelow(0), ...frontCut(s, side, edge)]);
  if (o.flaps) {
    // Hip pocket flaps.
    const grown = trunkPoints(s, 0.9, 1.0, J + 0.005, { extra: flare });
    for (const side of [1, -1]) fig.solid('hips', 'jacket', grown, [side > 0 ? xAbove(0.07) : xBelow(-0.07), side > 0 ? xBelow(0.15) : xAbove(-0.15), above(0.925), below(0.948), zAbove(0.03)]);
  }
}

/** Lapels beside the V, the jacket's collar round the back of the neck, a breast pocket, buttons. */
function lapels(fig, s) {
  const { o, b } = s;
  if (!o.jacket) return;
  const J = o.jacketGrow ?? 0.012;
  const edge = jacketEdge(s);
  const top = edge[0][0];
  const button = o.openJacket ? 1.12 : edge[1][1];
  const lapelW = o.lapelW ?? 0.055;
  const mat = o.lapelMat ?? (o.pinstripe ? 'jacket' : 'lapel');
  const grown = [...trunkPoints(s, button - 0.02, 1.47, J + 0.007), ...shoulderPoints(s, J + 0.007)];
  for (const side of [1, -1]) {
    // The lapel: a band beside the opening, widest at the notch, narrowing to the button.
    const along = frontCut(s, side, edge.slice(0, 2));
    const tN = trunkAt(s, 1.44);
    const outerA = [side * (top + lapelW), 1.44, tN.f + J], outerB = [side * (o.openJacket ? top + 0.02 : 0.004), button, trunkAt(s, button).f + J];
    const outer = keepSide(outerA, outerB, [-side * 0.3, 0, -1], [0, 1.3, 0.3]);
    const notch = keepSide([side * top, 1.466, 0.3], [side * (top + lapelW + 0.03), 1.43, 0.3], [0, 0, 1], [0, 1.2, 0]);
    const planes = [...along, outer, notch, side > 0 ? xAbove(0) : xBelow(0), zAbove(0.02), above(button)];
    fig.solid('chest', mat, grown, [...planes, above(1.265)]);
    fig.solid('spine', mat, grown, [...planes, below(1.275)]);
  }
  // The collar: round the back of the neck (under the shirt collar's top), down to the notches.
  const open = 36;
  fig.add('chest', mat, sweep(collarPath(s, open, 1.474, 0, 0.011, 6), band(0.034, 0.01)));
  const { rx, zf } = collarRing(s);
  const tN = trunkAt(s, 1.46);
  for (const side of [1, -1]) {
    const e = (y, g) => [side * Math.sin(open * DEG) * (rx + g), y, NECK_Z + Math.cos(open * DEG) * (zf - NECK_Z + g)];
    fig.solid('chest', mat, [e(1.474, 0.011), e(1.508, 0.012), e(1.474, 0.022), e(1.508, 0.024), [side * (top + 0.004), 1.462, tN.f + J + 0.006], [side * (top + 0.024), 1.456, tN.f + J - 0.002], [side * (top + 0.012), 1.47, tN.f + J - 0.012]]);
  }
  // A welt pocket on the left breast, a pocket square in it.
  const px = 0.095 * b.W;
  fig.solid('chest', 'jacket', trunkPoints(s, 1.33, 1.39, J + 0.004), [xAbove(px - 0.034), xBelow(px + 0.034), above(1.352), below(1.362), zAbove(0.03)]);
  if (o.pocketSquare) {
    const t = trunkAt(s, 1.37);
    const z = t.f + J;
    for (const [dx, h] of [
      [-0.016, 0.022],
      [0.006, 0.03],
    ])
      fig.solid('chest', 'square', [
        [px + dx - 0.014, 1.358, z - 0.004],
        [px + dx + 0.014, 1.358, z - 0.004],
        [px + dx - 0.014, 1.358, z + 0.004],
        [px + dx + 0.014, 1.358, z + 0.004],
        [px + dx, 1.358 + h, z + 0.0],
      ]);
  }
  if (!o.openJacket) {
    const tB = trunkAt(s, button);
    for (const dy of o.buttons === 2 ? [0, -0.1] : [0]) fig.solid(dy < -0.05 ? 'hips' : 'spine', 'button', ellipsoid([0, button + dy - 0.004, tB.f + J + 0.001], [0.009, 0.009, 0.005], 6, 2));
  }
}

/** The ring a collar follows: round the back of the neck, forward to the top of the chest. */
function collarRing(s) {
  const r = neckR(s);
  return { rx: r + 0.008, zf: NECK_Z + r + 0.016, zb: NECK_Z - r - 0.008, r };
}
function collarPath(s, open, y0, lift, g, count = 7) {
  const { rx, zf, zb } = collarRing(s);
  const path = [];
  for (let i = 0; i <= count; i++) {
    const a = (open + ((360 - 2 * open) * i) / count) * DEG;
    const rz = Math.cos(a) > 0 ? zf - NECK_Z : NECK_Z - zb;
    const n = nrm([Math.sin(a) / (rx + g), 0, Math.cos(a) / (rz + g)]);
    path.push({ p: [Math.sin(a) * (rx + g), y0 - lift * Math.max(0, Math.cos(a)), NECK_Z + Math.cos(a) * (rz + g)], n, u: [0, 1, 0] });
  }
  return path;
}
const band = (h, t = 0.007) => () => [
  [0, 0],
  [t, 0],
  [t + 0.003, h],
  [0.002, h],
];

/** A shirt collar round the neck (neck joint): kinds shirt, open, camp, track, crew, peter. */
function collar(fig, s) {
  const { o } = s;
  const kind = o.collar;
  if (!kind) return;
  const mat = o.collarMat ?? 'shirt';
  const { rx, zf } = collarRing(s);
  const end = (open, y, g = 0.004) => [Math.sin(open * DEG) * (rx + g), y, NECK_Z + Math.cos(open * DEG) * (zf - NECK_Z + g)];
  if (kind === 'shirt') {
    const open = 22;
    fig.add('neck', mat, sweep(collarPath(s, open, 1.47, 0.012, 0), band(0.046)));
    for (const side of [1, -1]) {
      const e0 = end(open, 1.505), e1 = end(open, 1.46);
      const t = trunkAt(s, 1.44);
      fig.solid('neck', mat, [e0, e1, add(e0, [0, 0, -0.008]), add(e1, [0, 0, -0.008]), [e0[0] + 0.022, 1.492, e0[2] - 0.012], [0.036, 1.438, t.f + 0.006], [0.016, 1.447, t.f + 0.008], [0.03, 1.44, t.f - 0.002]].map((p) => [side * Math.abs(p[0]), p[1], p[2]]));
    }
  } else if (kind === 'open' || kind === 'camp') {
    // Spread open over the collarbones: a low band behind, wide points lying on the chest.
    const wide = kind === 'camp' ? 1.3 : 1;
    const open = 62;
    fig.add('neck', mat, sweep(collarPath(s, open, 1.476, 0, 0), band(0.034)));
    for (const side of [1, -1]) {
      const e0 = end(open, 1.51), e1 = end(open, 1.478);
      const t1 = trunkAt(s, 1.43), t2 = trunkAt(s, 1.4);
      fig.solid('chest', mat, [e0, e1, [0.05, 1.472, t1.f - 0.01], [0.05 + 0.045 * wide, 1.43, t1.f - 0.006], [0.056 + 0.01 * wide, 1.4 - 0.01 * wide, t2.f + 0.006], [0.05, 1.415, t1.f + 0.008], [0.07 + 0.03 * wide, 1.46, t1.f - 0.018], [0.05 + 0.045 * wide, 1.43, t1.f - 0.014], [0.056 + 0.01 * wide, 1.4 - 0.01 * wide, t2.f - 0.002]].map((p) => [side * Math.abs(p[0]), p[1], p[2]]));
    }
  } else if (kind === 'track') {
    // A zipped stand collar, and the zip down the front.
    fig.add('neck', mat, sweep(collarPath(s, 0.001, 1.468, 0.01, 0, 12), band(0.058, 0.009)));
    const zip = trunkPoints(s, 1.0, 1.47, 0.003);
    fig.solid('chest', 'stripe', zip, [xAbove(-0.004), xBelow(0.004), zAbove(0.03), above(1.265)]);
    fig.solid('spine', 'stripe', zip, [xAbove(-0.004), xBelow(0.004), zAbove(0.03), below(1.275)]);
    fig.solid('neck', 'buckle', box([-0.005, 1.49, zf + 0.008], [0.005, 1.515, zf + 0.014]));
  } else if (kind === 'crew') {
    fig.add('neck', mat, sweep(collarPath(s, 0.001, 1.47, 0.006, 0.002, 12), band(0.016, 0.008)));
  } else if (kind === 'peter') {
    // A round white collar: a low band and two rounded flaps at the front.
    const open = 26;
    fig.add('neck', mat, sweep(collarPath(s, open, 1.47, 0.006, 0), band(0.026)));
    for (const side of [1, -1]) {
      const pts = [];
      for (let i = 0; i < 7; i++) {
        const a = (i / 6) * Math.PI;
        const x = side * (0.006 + 0.036 * (0.5 - 0.5 * Math.cos(a)));
        const y = 1.465 - 0.036 * Math.sin(a) * 0.9;
        const z = trunkAt(s, y).f + 0.004;
        pts.push([x, y, z + 0.003], [x, y, z - 0.004]);
      }
      pts.push([side * 0.045, 1.478, 0.03], end(open, 1.478).map((v, i) => (i === 0 ? side * Math.abs(v) : v)));
      fig.solid('chest', mat, pts);
    }
  }
}

/** The tie (on the chest and spine) and its knot, or a bow tie (on the neck). */
function tie(fig, s) {
  const { o } = s;
  if (!o.tie) return;
  const { zf } = collarRing(s);
  if (o.tie === 'bow') {
    for (const side of [1, -1])
      fig.solid('neck', 'tie', [
        [side * 0.006, 1.492, zf + 0.026],
        [side * 0.006, 1.468, zf + 0.026],
        [side * 0.05, 1.503, zf + 0.018],
        [side * 0.05, 1.458, zf + 0.018],
        [side * 0.044, 1.506, zf + 0.004],
        [side * 0.044, 1.455, zf + 0.004],
        [side * 0.006, 1.492, zf + 0.006],
        [side * 0.006, 1.468, zf + 0.006],
      ]);
    fig.solid('neck', 'tie', box([-0.01, 1.468, zf + 0.012], [0.01, 1.492, zf + 0.031], 0.004));
    return;
  }
  // The knot, between the collar points.
  fig.solid('neck', 'tie', [
    [-0.015, 1.5, zf + 0.012],
    [0.015, 1.5, zf + 0.012],
    [-0.009, 1.46, zf + 0.024],
    [0.009, 1.46, zf + 0.024],
    [-0.013, 1.5, zf - 0.004],
    [0.013, 1.5, zf - 0.004],
    [0, 1.455, zf + 0.016],
  ]);
  // The blade follows the shirt front down from the knot, widening.
  const shirt = trunkPoints(s, 1.0, 1.5, 0.004);
  const w = (y) => mix1(0.011, o.tieW ?? 0.028, clamp((1.462 - y) / 0.3, 0, 1));
  const planes = [keepSide([w(1.462), 1.462, 0], [w(1.162), 1.162, 0], [0, 0, 1], [0, 1.3, 0]), keepSide([-w(1.462), 1.462, 0], [-w(1.162), 1.162, 0], [0, 0, 1], [0, 1.3, 0]), zAbove(0.03), below(1.462)];
  const tip = o.jacket && !o.openJacket ? (o.button ?? 1.1) + 0.01 : 1.05;
  fig.solid('chest', 'tie', shirt, [...planes, above(1.265)]);
  fig.solid('spine', 'tie', shirt, [...planes, below(1.275), above(tip + 0.02)]);
  // The pointed tip.
  const t = trunkAt(s, tip + 0.02);
  const W = o.tieW ?? 0.028;
  fig.solid('spine', 'tie', [
    [-W, tip + 0.022, t.f + 0.006],
    [W, tip + 0.022, t.f + 0.006],
    [0, tip - 0.01, t.f + 0.006],
    [-W, tip + 0.022, t.f - 0.002],
    [W, tip + 0.022, t.f - 0.002],
    [0, tip - 0.01, t.f - 0.002],
  ]);
  if (o.tieBar) {
    const tb = trunkAt(s, 1.34);
    fig.solid('chest', 'gold', box([-0.026, 1.334, tb.f + 0.004], [0.026, 1.341, tb.f + 0.012]));
  }
}

/** Overlay panels on a shirt: the bowling shirt's cream panels, the tracksuit's side stripes. */
function panels(fig, s) {
  const { o } = s;
  if (o.panels) {
    for (const seg of SEGS) {
      const pts = trunkPoints(s, seg[1] - (seg[0] === 'spine' ? 0.03 : 0), seg[2], 0.003);
      if (seg[0] === 'chest') pts.push(...shoulderPoints(s, 0.003));
      for (const side of [1, -1]) fig.solid(seg[0], 'panel', pts, [side > 0 ? xAbove(0.045) : xBelow(-0.045), side > 0 ? xBelow(0.078) : xAbove(-0.078), zAbove(0.03), ...(seg[0] === 'chest' ? [below(1.395)] : [])]);
    }
    const tail = trunkPoints(s, o.untucked ?? 0.9, 1.05, 0.011);
    for (const side of [1, -1]) fig.solid('hips', 'panel', tail, [side > 0 ? xAbove(0.045) : xBelow(-0.045), side > 0 ? xBelow(0.078) : xAbove(-0.078), zAbove(0.03)]);
  }
  if (o.sideStripe) {
    for (const seg of SEGS) {
      const pts = trunkPoints(s, seg[1] - 0.02, seg[2], 0.003);
      for (const side of [1, -1]) fig.solid(seg[0], 'stripe', pts, [side > 0 ? xAbove(0.08) : xBelow(-0.08), zAbove(-0.016), zBelow(0.016), below(1.37)]);
    }
  }
  if (o.buttonsDown) {
    // A placket of buttons down the front.
    for (const y of [1.37, 1.29, 1.21, 1.13, 1.05]) {
      const t = trunkAt(s, y);
      fig.solid(y > 1.27 ? 'chest' : 'spine', o.buttonsDown, ellipsoid([0, y, t.f + 0.002], [0.006, 0.006, 0.004], 6, 2));
    }
  }
  if (o.nameTag) fig.solid('chest', 'apron', trunkPoints(s, 1.33, 1.38, 0.004), [xAbove(0.05), xBelow(0.105), above(1.335), below(1.358), zAbove(0.03)]);
  if (o.chain) {
    // A gold chain round the neck, lying on the chest.
    const path = [];
    for (let i = 0; i <= 14; i++) {
      const a = (-80 + (160 * i) / 14) * DEG;
      const x = Math.sin(a) * 0.075;
      const y = 1.47 - Math.cos(a) * 0.075;
      const z = trunkAt(s, y).f * Math.cos(a * 0.6) + 0.004;
      path.push({ p: [x, y, z], n: [0, 0, 1], u: [0, 1, 0] });
    }
    fig.add('chest', 'gold', sweep(path, () => [[0, -0.003], [0.005, -0.003], [0.005, 0.003], [0, 0.003]]));
  }
}

function arms(fig, s) {
  const { o, b } = s;
  const sx = b.sx;
  const g = b.arm;
  const A = (y, rx, rz, extra = {}) => ({ y, rx: rx * g, rz: rz * g, x: sx, ...extra });
  const sleeve = o.jacket ? 'jacket' : o.sleeveMat ?? o.shirtMat ?? 'shirt';
  const flat = 0.45; // the shoulder's dome, flattened under the jacket's shoulder line
  if (o.sleeves === 'short' || o.sleeves === 'puff') {
    const puff = o.sleeves === 'puff' ? 1.14 : 1;
    const hemY = o.sleeves === 'puff' ? 1.35 : 1.3;
    fig.pairSolid('upperArmL', sleeve, limb([A(1.46, 0.066 * puff, 0.066 * puff), A(1.39, 0.065 * puff, 0.063 * puff), A(hemY, 0.062, 0.06)], { domeBottom: false, domeScale: flat }));
    fig.pairSolid('upperArmL', 'skin', limb([A(hemY + 0.02, 0.051, 0.05), A(1.2, 0.045, 0.044), A(1.18, 0.044, 0.044)], { domeTop: false }));
    if (o.sleeveTrim) fig.pairSolid('upperArmL', o.sleeveTrim, limb([A(hemY + 0.014, 0.064, 0.062), A(hemY - 0.004, 0.064, 0.062)], { domeTop: false, domeBottom: false }));
    fig.pairSolid('lowerArmL', 'skin', limb([A(1.18, 0.043, 0.043), A(1.1, 0.044, 0.042), A(1.0, 0.034, 0.032), A(0.95, 0.028, 0.025)], { domeBottom: false }));
  } else {
    const upper = [A(1.46, 0.064, 0.064), A(1.36, 0.061, 0.06), A(1.24, 0.056, 0.055), A(1.18, 0.055, 0.054)];
    fig.pairSolid('upperArmL', sleeve, limb(upper, { domeScale: flat }));
    const end = 0.972;
    const fore = [A(1.18, 0.052, 0.052), A(1.1, 0.052, 0.051), A(1.02, 0.047, 0.046), A(end, 0.046, 0.045)];
    fig.pairSolid('lowerArmL', sleeve, limb(fore, { domeBottom: false }));
    if (o.sleeveStripe) {
      fig.pairSolid('upperArmL', 'stripe', limb(upper, { grow: 0.003, domeTop: false, domeBottom: false }), [xAbove(sx + 0.02), zAbove(-0.012), zBelow(0.012)]);
      fig.pairSolid('lowerArmL', 'stripe', limb(fore, { grow: 0.003, domeTop: false, domeBottom: false }), [xAbove(sx + 0.02), zAbove(-0.012), zBelow(0.012)]);
    }
    // The shirt cuff showing below a jacket sleeve (or the shirt's own cuff band).
    const cuffMat = o.cuffMat ?? (o.jacket ? 'shirt' : sleeve);
    fig.pairSolid('lowerArmL', cuffMat, limb([A(end + 0.012, 0.039, 0.038), A(0.952, 0.038, 0.037)], { domeTop: false, domeBottom: false }));
    fig.pairSolid('lowerArmL', 'skin', limb([A(0.97, 0.027, 0.024), A(0.94, 0.026, 0.023)], { domeTop: false, domeBottom: false }));
    if (o.cufflinks) fig.pairSolid('lowerArmL', 'gold', box([sx + 0.03 * g, 0.958, -0.006], [sx + 0.04 * g, 0.968, 0.006]));
  }
  if (o.watch) {
    // A gold watch on the left wrist.
    fig.solid('lowerArmL', 'gold', limb([A(0.956, 0.03 / g, 0.027 / g), A(0.941, 0.03 / g, 0.027 / g)], { domeTop: false, domeBottom: false }));
    fig.solid('lowerArmL', 'glass', box([sx + 0.024, 0.94, -0.011], [sx + 0.034, 0.957, 0.011]));
  }
}

/**
 * A fist gripping a bar, in the right hand's frame: wrist at the origin, the hand pointing +z,
 * palm toward +x, thumb up (+y); the bar runs along y through GRIP_R. Returns point clouds (each
 * one convex part).
 */
function fist(b) {
  const k = fistScale(b);
  const [gx, gy, gz] = GRIP_R;
  const parts = [];
  const P = (x, y, z) => [x * k, y * k, z * k];
  // The back of the hand, from the wrist to the knuckles (front-right of the bar).
  const back = [];
  for (const [x, y] of [
    [-0.022, 0.018],
    [-0.016, 0.026],
    [0.016, 0.026],
    [0.022, 0.018],
    [0.022, -0.02],
    [0.014, -0.028],
    [-0.014, -0.028],
    [-0.022, -0.02],
  ])
    back.push(P(x, y, -0.012));
  for (const [y, z] of [
    [0.012, 0.098],
    [-0.012, 0.102],
    [-0.036, 0.099],
    [-0.058, 0.092],
  ])
    back.push(P(-0.044, y + gy + 0.03, z - 0.014), P(-0.036, y + gy + 0.03, z - 0.004));
  back.push(P(-0.042, 0.02, 0.03), P(-0.044, -0.062, 0.05), P(-0.02, -0.07, 0.045), P(-0.016, 0.024, 0.045), P(0.02, 0.02, 0.03), P(0.018, -0.04, 0.02));
  parts.push(back);
  // Four fingers wrapping round the front of the bar and down its left side; the middle finger
  // reaches furthest, the little finger is the smallest.
  for (const [y, h, reach] of [
    [0.004, 0.018, 1.0],
    [-0.019, 0.019, 1.04],
    [-0.042, 0.018, 0.98],
    [-0.062, 0.015, 0.88],
  ]) {
    const yy = y + gy + 0.028;
    const D = [];
    for (const [x, z, edge] of [
      [-0.051, 0.094, 1],
      [-0.043, 0.082, 0],
      [-0.028, 0.108, 1],
      [0.002, 0.113, 1],
      [0.03, 0.102, 1],
      [0.041, 0.078, 1],
      [0.036, 0.052, 0],
      [0.012, 0.046, 0],
    ]) {
      const zz = gz + (z - gz) * reach;
      const xx = gx + (x - gx) * (reach < 0.95 ? 0.94 : 1);
      // The outer corners are bevelled: the knuckle rolls read as separate fingers.
      const inset = edge ? 0.0032 : 0.0005;
      D.push(P(xx, yy - h * 0.5 + inset, zz), P(xx, yy + h * 0.5 - inset, zz));
    }
    parts.push(D);
  }
  // The thumb: from its base on the palm's left, forward along the left side above the index finger.
  parts.push([P(0.006, 0.02, 0.018), P(0.024, 0.016, 0.022), P(0.012, -0.006, 0.02), P(0.03, -0.002, 0.03), P(0.03, 0.022, 0.06), P(0.046, 0.018, 0.062), P(0.04, 0.005, 0.064), P(0.03, 0.018, 0.098), P(0.042, 0.014, 0.098), P(0.038, 0.005, 0.094), P(0.028, 0.006, 0.092)]);
  // The wrist: a faceted ball so the hand turns cleanly against the cuff.
  parts.push(ellipsoid(P(0, -0.004, 0.0), [0.024 * k, 0.028 * k, 0.026 * k], 6, 2));
  return parts;
}

function hands(fig, s) {
  const { b, o } = s;
  const parts = fist(b);
  const put = (mat, tris) => {
    fig.add('handR', mat, moveTris(tris, fig.J.handR));
    // The left hand: the same fist, mirrored and turned to hang below the wrist.
    fig.add('handL', mat, moveTris(mapTris(tris, toLeftHand, true), fig.J.handL));
  };
  for (const pts of parts) put('skin', solid(pts));
  if (o.handWraps) {
    // Boxer's tape round the knuckles and the palm.
    put('wrap', solid(inflateFrom(parts[0], [0, -0.03, 0.03], 0.003), [zAbove(0.035), zBelow(0.09)]));
    put('wrap', solid(inflateFrom(parts[parts.length - 1], [0, -0.004, 0], 0.003), [zAbove(-0.01)]));
  }
  if (o.ring) {
    // A gold pinky ring on the right hand.
    const gy = GRIP_R[1];
    fig.add('handR', 'gold', moveTris(solid(box([-0.049, gy - 0.037, 0.072], [-0.03, gy - 0.027, 0.1], 0.003).map((p) => scl(p, fistScale(b)))), fig.J.handR));
  }
}

function neck(fig, s) {
  const r = neckR(s);
  fig.solid('neck', 'skin', limb([{ y: 1.44, rx: r, rz: r * 0.96, z: NECK_Z }, { y: 1.63, rx: r * 0.95, rz: r * 0.92, z: NECK_Z - 0.01 }], { domeTop: false, domeBottom: false }));
  collar(fig, s);
}

// ---------------------------------------------------------------------------------------------
// The head: a faceted skull and jaw, a brow, a nose wedge, eyes, lips, ears; hair and hats.

/** Head scale (about the head pivot) and its width factor. */
const headScale = (s) => s.b.head * 1.06;

function headPoints(s, grow = 0, underHair = false) {
  const f = s.b.fem;
  const H = headScale(s);
  const jaw = f ? 0.055 : 0.068, chin = f ? 0.019 : 0.03, cheek = f ? 0.071 : 0.076;
  const pts = [];
  const both = (x, y, z) => {
    for (const sx of x === 0 ? [1] : [1, -1]) {
      let p = [sx * x * H * (f ? 0.97 : 1), 1.58 + y * H, z * H];
      if (grow) p = add(p, scl(nrm(sub(p, [0, 1.58 + 0.09 * H, -0.005])), grow));
      // Where hair (or a hat) always covers the skull, the skin sits 5 mm lower, so no corner of
      // it can show between the hair's facets.
      if (underHair && (y >= 0.17 || (z <= -0.08 && y >= 0.035))) p = add(p, scl(nrm(sub(p, [0, 1.58 + 0.09 * H, -0.005])), -0.005));
      pts.push(p);
    }
  };
  // Chin and jaw.
  both(0, -0.033, 0.074);
  both(chin, -0.031, 0.069);
  both(0, -0.018, 0.086);
  both(chin, -0.016, 0.081);
  both(jaw * 0.86, -0.019, 0.038);
  both(jaw, -0.002, -0.012);
  both(jaw + 0.002, 0.03, -0.042);
  // Mouth and cheeks.
  both(0, 0.012, 0.092);
  both(0.028, 0.012, 0.084);
  both(0.058, 0.036, 0.066);
  both(cheek, 0.066, 0.052);
  both(0.046, 0.074, 0.08);
  // Brow and forehead.
  both(0, 0.108, 0.098);
  both(0.046, 0.11, 0.09);
  both(0.07, 0.103, 0.058);
  both(0, 0.155, 0.092);
  both(0.05, 0.155, 0.075);
  both(0.074, 0.14, 0.038);
  // Temples, sides, crown and back.
  both(0.08, 0.1, 0.01);
  both(0.082, 0.07, -0.03);
  both(0.078, 0.035, -0.04);
  both(0, 0.214, 0.046);
  both(0.052, 0.205, 0.035);
  both(0, 0.232, -0.02);
  both(0.058, 0.216, -0.028);
  both(0, 0.205, -0.086);
  both(0.062, 0.174, -0.092);
  both(0, 0.13, -0.116);
  both(0.066, 0.1, -0.1);
  both(0.076, 0.125, -0.05);
  both(0, 0.06, -0.105);
  both(0.054, 0.04, -0.09);
  both(0, 0.012, -0.075);
  both(0.044, 0.0, -0.064);
  return pts;
}

/** A point on the head in head units (x, y, z before scaling). */
const HP = (s) => {
  const H = headScale(s);
  return (x, y, z) => [x * H, 1.58 + y * H, z * H];
};

function head(fig, s) {
  const { o, b } = s;
  const H = headScale(s);
  const f = b.fem;
  const P = HP(s);
  // The full skull places the face and the hair; the skin drawn is the same, a little lower under the hair.
  const skull = solid(headPoints(s));
  fig.solid('head', 'skin', headPoints(s, 0, true));
  s.skull = skull;
  const ez = (x, y) => (surfaceZ(skull, x * H, 1.58 + y * H) ?? 0.08 * H) / H;
  // Brow ridge.
  fig.solid('head', 'skin', [P(-0.062, 0.098, 0.074), P(0.062, 0.098, 0.074), P(-0.05, 0.117, 0.092), P(0.05, 0.117, 0.092), P(-0.048, 0.102, 0.097), P(0.048, 0.102, 0.097), P(0, 0.113, 0.102), P(0, 0.1, 0.103), P(-0.062, 0.12, 0.068), P(0.062, 0.12, 0.068)]);
  // The nose: a wedge from the brow to its tip, nostrils either side.
  const nw = f ? 0.012 : 0.017, nt = f ? 0.119 : 0.131;
  fig.solid('head', 'skin', [P(0, 0.104, 0.1), P(-0.008, 0.1, 0.094), P(0.008, 0.1, 0.094), P(0, 0.045, nt), P(-nw, 0.04, 0.1), P(nw, 0.04, 0.1), P(0, 0.033, 0.113), P(-nw * 0.7, 0.032, 0.1), P(nw * 0.7, 0.032, 0.1)]);
  // Ears.
  for (const sd of [1, -1]) fig.solid('head', 'skin', [P(sd * 0.075, 0.108, -0.01), P(sd * 0.089, 0.102, -0.02), P(sd * 0.09, 0.062, -0.022), P(sd * 0.075, 0.04, -0.004), P(sd * 0.08, 0.1, -0.036), P(sd * 0.08, 0.05, -0.03), P(sd * 0.072, 0.07, 0.0)]);
  // Eyes: a white almond and a dark iris under the brow (unless shades cover them).
  if (!o.shades) {
    for (const sd of [1, -1]) {
      const cx = sd * 0.031, cy = 0.084;
      const w = f ? 0.016 : 0.015, h = f ? 0.0072 : 0.0056;
      const white = [], iris = [];
      for (const [dx, dy] of [
        [-w, 0.0005],
        [-w * 0.35, h],
        [w * 0.5, h * 0.9],
        [w, 0.002],
        [w * 0.4, -h * 0.7],
        [-w * 0.5, -h * 0.6],
      ]) {
        const x = cx + dx * sd, y = cy + dy;
        const z = ez(x, y);
        white.push(P(x, y, z + 0.002), P(x, y, z - 0.004));
      }
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const x = cx + sd * 0.001 + Math.cos(a) * 0.0068, y = cy + 0.0012 + Math.sin(a) * h * 0.92;
        const z = ez(x, y);
        iris.push(P(x, y, z + 0.0032), P(x, y, z - 0.003));
      }
      fig.solid('head', 'whites', white);
      fig.solid('head', 'eyes', iris);
    }
  }
  for (const sd of [1, -1]) {
    // Eyebrows: stern bars for the men, arched for the women (under the shades' top edge anyway).
    const cx = sd * 0.031, by = f ? 0.103 : 0.1;
    const bw = f ? 0.021 : 0.024;
    const bp = [];
    for (const [dx, dy, t] of f
      ? [
          [-bw, -0.001, 0.0022],
          [bw * 0.1, 0.006, 0.0028],
          [bw, 0.001, 0.002],
        ]
      : [
          [-bw, -0.004, 0.0048],
          [0, 0.002, 0.0055],
          [bw, 0.005, 0.004],
        ]) {
      const x = cx - dx * sd, y = by + dy;
      const z = ez(x, y);
      bp.push(P(x, y + t, z + 0.0045), P(x, y - t, z + 0.0045), P(x, y, z - 0.003));
    }
    fig.solid('head', 'brows', bp);
  }
  // Lips (coloured for the women) or a mouth line.
  {
    const my = 0.011, mw = f ? 0.02 : 0.022;
    const pts = [];
    for (const [dx, dy] of [
      [-mw, 0],
      [-mw * 0.5, f ? 0.0065 : 0.0025],
      [0, f ? 0.004 : 0.0025],
      [mw * 0.5, f ? 0.0065 : 0.0025],
      [mw, 0],
      [mw * 0.5, f ? -0.007 : -0.0025],
      [0, f ? -0.008 : -0.0025],
      [-mw * 0.5, f ? -0.007 : -0.0025],
    ]) {
      const z = ez(dx, my + dy);
      pts.push(P(dx, my + dy, z + (f ? 0.004 : 0.002)), P(dx, my + dy, z - 0.004));
    }
    fig.solid('head', f ? 'lips' : 'mouth', pts);
  }
  // Facial hair: the skull grown a little and cut to shape.
  if (o.beard) {
    const grown = headPoints(s, o.beard === 'pencil' ? 0.0025 : 0.005);
    const cut = (planes) => fig.solid('head', 'hair', grown, planes);
    const y = (v) => 1.58 + v * H;
    if (o.beard === 'goatee') {
      cut([below(y(0.0)), xBelow(0.026 * H), xAbove(-0.026 * H), zAbove(0.04 * H)]);
      cut([above(y(0.017)), below(y(0.03)), xBelow(0.03 * H), xAbove(-0.03 * H), zAbove(0.06 * H)]);
    } else if (o.beard === 'pencil') {
      cut([above(y(0.02)), below(y(0.026)), xBelow(0.025 * H), xAbove(-0.025 * H), zAbove(0.06 * H)]);
    }
  }
  hair(fig, s);
  if (o.shades) shades(fig, s);
  if (o.hat) hat(fig, s);
}

function shades(fig, s) {
  const P = HP(s);
  const f = s.b.fem;
  const y = 0.087, z = 0.107;
  const lw = f ? 0.03 : 0.032;
  for (const sd of [1, -1]) {
    // A lens: flat-topped (a wayfarer), tilted a little, wrapping back at the outer edge.
    const pts = [];
    for (const [dx, dy] of [
      [0.006, 0.016],
      [lw, 0.018],
      [lw + 0.007, 0.012],
      [lw + 0.002, -0.01],
      [lw * 0.55, -0.016],
      [0.009, -0.012],
      [0.005, 0.002],
    ]) {
      const zz = z - dx * 0.25 + dy * 0.12;
      pts.push(P(sd * dx, y + dy, zz + 0.0035), P(sd * dx, y + dy, zz - 0.003));
    }
    fig.solid('head', 'shades', pts);
    // The arm back to the ear.
    fig.solid('head', 'shades', [P(sd * (lw + 0.006), y + 0.016, z - 0.012), P(sd * (lw + 0.006), y + 0.008, z - 0.012), P(sd * 0.086, y + 0.016, -0.02), P(sd * 0.087, y + 0.009, -0.02), P(sd * (lw + 0.003), y + 0.016, z - 0.02), P(sd * 0.081, y + 0.016, -0.02)]);
  }
  // The bridge.
  fig.solid('head', 'shades', [P(-0.009, y + 0.016, z + 0.003), P(0.009, y + 0.016, z + 0.003), P(-0.009, y + 0.008, z + 0.003), P(0.009, y + 0.008, z + 0.003), P(0, y + 0.012, z - 0.006)]);
}

// Hair: shells lofted over the skull. Each style gives a hairline (its latitude, degrees, at each
// angle round the head; 0 = the front, 90 = the left side) and a thickness; the shell is placed by
// casting rays from inside the skull, so it sits on the head's own facets.

const HAIR_THETA = [0, 18, 36, 52, 66, 80, 94, 110, 128, 148, 166, 180, -166, -148, -128, -110, -94, -80, -66, -52, -36, -18];
function table(rows) {
  return (th) => {
    const a = Math.abs(th);
    for (let k = 1; k < rows.length; k++)
      if (a <= rows[k][0]) {
        const [a0, v0] = rows[k - 1], [a1, v1] = rows[k];
        return v0 + ((v1 - v0) * (a - a0)) / (a1 - a0);
      }
    return rows[rows.length - 1][1];
  };
}
const HAIRLINE_M = table([
  [0, 27],
  [36, 23],
  [62, 12],
  [74, -4],
  [84, -16],
  [92, -2],
  [104, -8],
  [128, -28],
  [180, -42],
]);
const HAIRLINE_F = table([
  [0, 29],
  [40, 23],
  [66, 10],
  [86, 0],
  [104, -10],
  [132, -32],
  [180, -44],
]);

function hairShell(s, { line, thick, hang = null, shape = null, lip = 0.004, ts = [0, 0.17, 0.38, 0.62, 0.86], thetas = HAIR_THETA, ridge = 0 }) {
  const H = headScale(s);
  const C = [0, 1.58 + 0.1 * H, -0.006 * H];
  const dirOf = (th, ph) => [Math.cos(ph * DEG) * Math.sin(th * DEG), Math.sin(ph * DEG), Math.cos(ph * DEG) * Math.cos(th * DEG)];
  const at = (th, ph, d) => {
    if (hang && ph < 0 && hang(th)) {
      const e = dirOf(th, 0);
      const q = add(C, scl(e, rayOut(s.skull, C, e) + d));
      return [q[0], C[1] + Math.sin(ph * DEG) * 0.13 * H, q[2]];
    }
    const e = dirOf(th, ph);
    return add(C, scl(e, rayOut(s.skull, C, e) + d));
  };
  const rings = [thetas.map((th) => at(th, line(th), -lip))];
  for (const t of ts)
    rings.push(
      thetas.map((th, i) => {
        const ph0 = line(th);
        const ph = ph0 + (88 - ph0) * t;
        // Ridges: combed strands running from the hairline to the crown.
        const q = at(th, ph, thick(th, t, ph) + (t > 0 && t < 0.85 ? ridge * (i % 2) * Math.sin(Math.PI * t) : 0));
        return shape ? shape(q, th, t, ph) : q;
      }),
    );
  // Close over the crown at a pole (a flat cap would let the skull's top poke through).
  if (ts[ts.length - 1] > 0.5) {
    let pole = at(0, 90, thick(0, 1, 90));
    if (shape) pole = shape(pole, 0, 1, 90);
    rings.push(thetas.map(() => pole));
  }
  return loft(rings);
}

/** A tapered tube between two points (a ponytail's segment). */
function tube(a, b2, ra, rb, n = 7) {
  const d = nrm(sub(b2, a));
  const u = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = nrm(cross(d, u)), e2 = cross(d, e1);
  const pts = [];
  for (const [c, r] of [
    [a, ra],
    [b2, rb],
  ])
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      pts.push(add(c, add(scl(e1, Math.cos(t) * r), scl(e2, Math.sin(t) * r * 0.85))));
    }
  return pts;
}

function hair(fig, s) {
  const { o } = s;
  const H = headScale(s);
  const P = HP(s);
  const style = o.hairStyle;
  const add1 = (tris) => fig.add('head', 'hair', tris);
  const bump = (th, w) => Math.exp(-((th / w) ** 2));
  const ss = (a, b2, t) => {
    const x = clamp((t - a) / (b2 - a), 0, 1);
    return x * x * (3 - 2 * x);
  };
  if (style === 'long') {
    // Slicked back and down to the collar, tucked behind the ears (the Hitman).
    const line = table([
      [0, 28],
      [36, 24],
      [62, 13],
      [80, 2],
      [92, -2],
      [104, -30],
      [120, -70],
      [180, -76],
    ]);
    add1(hairShell(s, { line, thick: (th, t) => (0.012 + 0.008 * ss(0.1, 0.5, t) + (Math.abs(th) > 110 ? 0.006 * (1 - t) : 0) + 0.006 * bump(Math.abs(th) - 40, 30) * (1 - t)) * (1 - 0.55 * bump(th, 12) * (1 - ss(0.3, 0.7, t))), hang: (th) => Math.abs(th) > 100, ridge: 0.004 }));
  } else if (style === 'buzz') {
    const hatted = !!o.hat;
    add1(hairShell(s, { line: HAIRLINE_M, thick: () => (hatted ? 0.008 : 0.0065), ...(hatted ? { ts: [0, 0.2, 0.38], thetas: [0, 36, 66, 94, 128, 156, 180, -156, -128, -94, -66, -36] } : { ts: [0, 0.13, 0.28, 0.44, 0.6, 0.75, 0.9] }) }));
  } else if (style === 'crew') {
    // Short at the sides, a flat top standing up in front.
    const top = 1.58 + 0.248 * H;
    add1(hairShell(s, { line: HAIRLINE_M, thick: (th, t) => 0.003 + 0.013 * ss(0.15, 0.4, t) + (t > 0.1 ? 0.009 * hash(Math.round(th) + 7, Math.round(t * 100)) * ss(0.1, 0.4, t) : 0) + 0.012 * bump(th, 36) * ss(0.02, 0.25, t), shape: (q) => (q[1] > top ? [q[0], top, q[2]] : q) }));
  } else if (style === 'slick') {
    // Combed back, glossy, a soft wave over the brow.
    add1(hairShell(s, { line: HAIRLINE_M, thick: (th, t) => (0.005 + 0.014 * ss(0.1, 0.45, t) + 0.02 * bump(th + 14, 36) * Math.sin(Math.PI * clamp(t / 0.6, 0, 1))) * (1 - 0.65 * bump(th - 48, 8) * (1 - ss(0.35, 0.7, t))), ridge: 0.0035 }));
  } else if (style === 'pomp') {
    // A high rolled pompadour; the sides swept back; long sideburns.
    add1(
      hairShell(s, {
        line: HAIRLINE_M,
        thick: (th, t) => 0.006 + 0.012 * ss(0.1, 0.4, t) + 0.05 * bump(th, 42) * Math.max(0, 1 - t / 0.66) ** 0.7,
        ridge: 0.004,
        shape: (q, th, t) => add(q, [0, 0.03 * bump(th, 42) * Math.sin(Math.PI * clamp(t / 0.5, 0, 1)) + 0.012 * bump(th, 42) * (t < 0.05 ? 1 : 0), 0.022 * bump(th, 42) * Math.max(0, 1 - t / 0.45)]),
      }),
    );
    for (const sd of [1, -1]) fig.solid('head', 'hair', [P(sd * 0.077, 0.115, 0.024), P(sd * 0.084, 0.115, 0.012), P(sd * 0.078, 0.052, 0.022), P(sd * 0.083, 0.052, 0.01), P(sd * 0.079, 0.115, -0.004), P(sd * 0.079, 0.052, -0.002)]);
  } else if (style === 'short') {
    // Short and a little ragged.
    add1(hairShell(s, { line: HAIRLINE_M, thick: (th, t) => 0.005 + 0.013 * ss(0.1, 0.45, t) + (t > 0.1 ? 0.012 * hash(Math.round(th), Math.round(t * 100)) * ss(0.1, 0.5, t) : 0) + 0.008 * bump(th, 30) * ss(0.0, 0.3, t) }));
  } else if (style === 'bob') {
    // The bob: blunt bangs at the brow, straight sides to the jaw, a squared back.
    const line = table([
      [0, 4],
      [44, 3],
      [54, -8],
      [58, -58],
      [180, -58],
    ]);
    add1(hairShell(s, { line, thick: (th, t, ph) => 0.016 + (ph < 0 ? 0.01 * clamp(-ph / 58, 0, 1) : 0) + 0.004 * t, hang: (th) => Math.abs(th) > 52, lip: 0.008 }));
  } else if (style === 'pony' || style === 'ponycap') {
    // Pulled back tight into a high ponytail, a swept fringe.
    const roll = style === 'ponycap' ? 0.024 : 0.012;
    const fringe = style === 'pony' ? (th) => HAIRLINE_F(th) - 17 * bump(th + 22, 26) : HAIRLINE_F;
    add1(hairShell(s, { line: fringe, thick: (th, t) => 0.006 + 0.01 * ss(0.1, 0.5, t) + roll * bump(th - (style === 'ponycap' ? 0 : -20), 34) * Math.sin(Math.PI * clamp(t / 0.6, 0, 1)) + (style === 'pony' ? 0.006 * bump(th + 22, 26) * (1 - t) : 0), ridge: 0.003 }));
    const tie = P(0, 0.17, -0.112);
    const a = add(tie, [0, -0.012 * H, -0.03 * H]);
    const bb = add(a, [0, -0.09 * H, -0.014 * H]);
    const c = add(bb, [0, -0.11 * H, 0.012 * H]);
    fig.solid('head', 'hairTie', tube(add(tie, [0, 0.006, 0.01]), add(tie, [0, -0.004, -0.012]), 0.017 * H, 0.016 * H, 8));
    fig.solid('head', 'hair', tube(tie, a, 0.017 * H, 0.032 * H));
    fig.solid('head', 'hair', tube(a, bb, 0.032 * H, 0.028 * H));
    fig.solid('head', 'hair', tube(bb, c, 0.028 * H, 0.006 * H));
  }
}

function hat(fig, s) {
  const { o } = s;
  const H = headScale(s);
  const P = HP(s);
  if (o.hat === 'fedora') {
    // A snap-brim fedora: the brim dips at the front, curls up at the sides; a pinched crown; a band.
    const by = 0.158;
    const inner = [], outer = [], outerLo = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const sa = Math.sin(a), ca = Math.cos(a);
      const y = by + 0.014 * sa * sa - (ca > 0 ? 0.02 * ca * ca : 0.004 * ca * ca);
      outer.push(P(0.148 * sa, y, 0.162 * ca - 0.008));
      outerLo.push(P(0.148 * sa, y - 0.008, 0.162 * ca - 0.008));
      inner.push(P(0.086 * sa, by + 0.004, 0.106 * ca - 0.012));
    }
    fig.add('head', 'hat', loft([outerLo, outer, inner]));
    const crown = [];
    for (const [y, rx, rz] of [
      [by, 0.088, 0.108],
      [by + 0.055, 0.084, 0.103],
      [by + 0.092, 0.068, 0.088],
    ])
      crown.push(...ring(P(0, y, -0.014), rx * H, rz * H, -rz * H, 12, 2.2, 0));
    crown.push(P(0, by + 0.104, -0.02));
    // The pinch at the front and the crease along the top.
    fig.solid('head', 'hat', crown, [keepSide(P(-0.1, by + 0.075, 0.08), P(0.1, by + 0.075, 0.08), [0, 0.55, -1], P(0, by, 0)), keepSide(P(0.05, by + 0.1, 0.1), P(0.05, by + 0.1, -0.1), [1, -0.35, 0], P(0, by, 0)), keepSide(P(-0.05, by + 0.1, 0.1), P(-0.05, by + 0.1, -0.1), [1, 0.35, 0], P(0, by, 0))]);
    fig.solid('head', 'hatBand', [...ring(P(0, by + 0.002, -0.014), 0.091 * H, 0.111 * H, -0.111 * H, 10, 2.2, 0), ...ring(P(0, by + 0.028, -0.014), 0.09 * H, 0.11 * H, -0.11 * H, 10, 2.2, 0)]);
  } else if (o.hat === 'waitress') {
    // A little white cap perched on top.
    const pts = [];
    for (const [y, rx, rz] of [
      [0.214, 0.066, 0.026],
      [0.25, 0.07, 0.016],
    ])
      pts.push(...ring(P(0, y, 0.03), rx * H, rz * H, -rz * H, 8, 2.5, 0));
    fig.solid('head', 'cap', pts.map((p) => rot(p, 'x', -24, P(0, 0.214, 0.03))));
  }
}

// ---------------------------------------------------------------------------------------------
// Outfits: the ten from art.ts (names and colours), as characters.

const COMMON = { belt: true, crease: false, collar: null, tie: null, jacket: false, sleeves: 'long', legs: 'trousers' };
const OUTFITS = [
  {
    id: 'hitman',
    name: 'The Hitman',
    build: 'slim',
    skin: 0xe2b38e,
    hair: 0x1a1512,
    jacket: 0x17171b,
    shirt: 0xf4f1ea,
    tie: 0x0c0c0e,
    pants: 0x17171b,
    shoes: 0x0a0a0a,
    o: { hairStyle: 'long', jacket: true, tie: 'long', tieW: 0.022, collar: 'shirt', crease: true, flaps: true, vTop: 0.05, lapelW: 0.046 },
  },
  {
    id: 'partner',
    name: 'The Partner',
    build: 'broad',
    skin: 0x6b4630,
    hair: 0x121010,
    jacket: 0x17171b,
    shirt: 0xf4f1ea,
    tie: 0xb3202a,
    pants: 0x17171b,
    shoes: 0x0a0a0a,
    o: { hairStyle: 'buzz', beard: 'goatee', jacket: true, tie: 'long', tieW: 0.026, collar: 'shirt', crease: true, flaps: true, lapelW: 0.056 },
  },
  {
    id: 'bride',
    name: 'The Bride',
    build: 'athlete',
    skin: 0xf0c9a4,
    hair: 0xe8c65a,
    shirt: 0xf2c418,
    pants: 0xf2c418,
    shoes: 0xf2c418,
    accent: 0x121212,
    o: { hairStyle: 'pony', collar: 'track', collarMat: 'shirt', legs: 'track', sleeveStripe: true, legStripe: true, sideStripe: true, shoeStyle: 'sneaker', shoeStripes: true, belt: false, untucked: 0.95, sheen: true },
  },
  {
    id: 'wife',
    name: 'The Wife',
    build: 'female',
    skin: 0xf3d5bd,
    hair: 0x0d0b0b,
    shirt: 0xf7f5f0,
    pants: 0x121214,
    shoes: 0x121214,
    lips: 0xc2182b,
    o: { hairStyle: 'bob', collar: 'open', neckV: 1.385, legs: 'cigarette', shoeStyle: 'flat', belt: true, beltColor: 0x121214 },
  },
  {
    id: 'bowler',
    name: 'The Bowler',
    build: 'heavy',
    skin: 0xd7a179,
    hair: 0x5a3a1e,
    shirt: 0xd63a2f,
    pants: 0x2d4e86,
    shoes: 0x2a1a10,
    accent: 0xf4efe2,
    o: { hairStyle: 'pomp', sleeves: 'short', sleeveTrim: 'panel', collar: 'camp', neckV: 1.4, panels: true, untucked: 0.93, belt: false, buttonsDown: 'panel' },
  },
  {
    id: 'crooner',
    name: 'The Crooner',
    build: 'slim',
    skin: 0xc48a62,
    hair: 0x241810,
    jacket: 0x8fc2ea,
    shirt: 0xffffff,
    tie: 0x111111,
    pants: 0x8fc2ea,
    shoes: 0x1a1a1a,
    o: { hairStyle: 'slick', beard: 'pencil', jacket: true, tie: 'bow', collar: 'shirt', ruffles: true, crease: true, lapelMat: 'satin', vTop: 0.058, button: 1.08, lapelW: 0.05 },
  },
  {
    id: 'boxer',
    name: 'The Boxer',
    build: 'broad',
    skin: 0xe8b894,
    hair: 0xd9b25a,
    jacket: 0x6b3a1f,
    shirt: 0xf1eee6,
    pants: 0x3a5a8c,
    shoes: 0x2a1a10,
    o: { hairStyle: 'crew', jacket: true, leather: true, openJacket: true, collar: 'crew', vTop: 0.075, hemY: 0.93, lapelW: 0.068, handWraps: true, jacketGrow: 0.014, shoeStyle: 'boot' },
  },
  {
    id: 'kahuna',
    name: 'The Kahuna',
    build: 'heavy',
    skin: 0xb8784e,
    hair: 0x2a1c12,
    shirt: 0x1fa3a0,
    pants: 0xcbb68a,
    shoes: 0x7a4a26,
    accent: 0xff5c8a,
    o: { hairStyle: 'short', sleeves: 'short', legs: 'shorts', collar: 'camp', neckV: 1.385, shades: true, untucked: 0.9, flowers: true, belt: false, chain: true, shoeStyle: 'loafer' },
  },
  {
    id: 'waitress',
    name: 'The Waitress',
    build: 'female',
    skin: 0xf0c8a8,
    hair: 0xb8421e,
    shirt: 0xf49ac1,
    pants: 0xf0c8a8,
    shoes: 0xf7f5f0,
    accent: 0xffffff,
    lips: 0xd01c3a,
    o: { hairStyle: 'ponycap', shirtMat: 'dress', legs: 'bare', skirt: 0.6, apron: true, sleeves: 'puff', sleeveTrim: 'apron', collar: 'peter', collarMat: 'apron', hat: 'waitress', socks: true, shoeStyle: 'sneaker', belt: false, nameTag: true, buttonsDown: 'apron' },
  },
  {
    id: 'boss',
    name: 'The Boss',
    build: 'heavy',
    skin: 0x8a5a3c,
    hair: 0x2b2b30,
    jacket: 0x3a3a44,
    shirt: 0x1c1c22,
    tie: 0xd9b030,
    pants: 0x3a3a44,
    shoes: 0x0a0a0a,
    accent: 0x8a8a96,
    o: { hairStyle: 'buzz', hat: 'fedora', shades: true, jacket: true, tie: 'long', tieW: 0.03, collar: 'shirt', pinstripe: true, crease: true, pocketSquare: true, tieBar: true, ring: true, watch: true, cufflinks: true, lapelW: 0.062, buttons: 2, button: 1.12 },
  },
];

/** A fighter's materials, from its outfit's colours. Only the ones its parts use are written. */
function materials(fig, d) {
  const o = d.o;
  const glossy = ['slick', 'long', 'pomp'].includes(o.hairStyle);
  fig.mat('skin', d.skin, 0.6);
  fig.mat('hair', d.hair, glossy ? 0.32 : 0.62);
  fig.mat('brows', shade(d.hair, d.hair > 0x906000 ? 0.62 : 0.9), 0.6);
  fig.mat('eyes', 0x17100e, 0.25);
  fig.mat('whites', 0xf1ece4, 0.35);
  fig.mat('mouth', shade(d.skin, 0.68), 0.5);
  fig.mat('lips', d.lips ?? shade(d.skin, 0.72), 0.35);
  fig.mat('shades', 0x0b0b0e, 0.1, 0.35);
  fig.mat('gold', 0xd9b030, 0.3, 1);
  fig.mat('glass', 0xe8f0f2, 0.08, 0.2);
  fig.mat('button', 0x101012, 0.35);
  if (o.flowers) {
    fig.textures.push(hawaiian(d.shirt, d.accent, 0xffe066, shade(d.shirt, 0.55)));
    fig.mat('shirt', 0xffffff, 0.7, 0, { tex: fig.textures.length - 1, uvScale: 0.26 });
  } else fig.mat('shirt', d.shirt, o.sheen ? 0.5 : 0.8);
  if (o.pinstripe) {
    fig.textures.push(pinstripe(d.jacket, d.accent, 8, 0.09));
    fig.mat('jacket', 0xffffff, 0.85, 0, { tex: fig.textures.length - 1, uvScale: 0.26 });
    fig.mat('pants', 0xffffff, 0.85, 0, { tex: fig.textures.length - 1, uvScale: 0.26 });
  } else {
    if (d.jacket) fig.mat('jacket', d.jacket, o.leather ? 0.42 : 0.85);
    if (d.jacket) fig.mat('lapel', d.jacket, o.leather ? 0.35 : 0.55);
    fig.mat('pants', d.pants, o.legs === 'track' ? 0.5 : 0.85);
  }
  fig.mat('satin', 0x131316, 0.28);
  fig.mat('tie', d.tie ?? 0x111111, 0.4);
  const shoe = o.shoeStyle ?? 'oxford';
  fig.mat('shoes', d.shoes, shoe === 'sneaker' ? 0.7 : shoe === 'loafer' || shoe === 'boot' ? 0.5 : 0.25);
  fig.mat('sole', shoe === 'sneaker' ? 0xf4f1ea : 0x16110e, 0.8);
  fig.mat('stripe', d.accent ?? 0x121212, 0.5);
  fig.mat('panel', d.accent ?? 0xf4efe2, 0.8);
  fig.mat('belt', o.beltColor ?? 0x2a1a12, 0.45);
  fig.mat('buckle', 0xc9c9cf, 0.25, 1);
  fig.mat('dress', d.shirt, 0.75);
  fig.mat('apron', 0xffffff, 0.8);
  fig.mat('socks', 0xffffff, 0.9);
  fig.mat('cap', 0xffffff, 0.8);
  fig.mat('hairTie', o.hairStyle === 'ponycap' ? 0xffffff : 0x121212, 0.6);
  fig.mat('hat', d.hair, 0.8);
  fig.mat('hatBand', 0x111114, 0.5);
  fig.mat('square', 0xd9b030, 0.45);
  fig.mat('wrap', 0xf4f1ea, 0.9);
}

function makeFighter(d) {
  const b = BUILDS[d.build];
  const o = { ...COMMON, ...d.o };
  const fig = new Figure(d.id, d.name, b);
  materials(fig, d);
  const s = { fig, b, o, d };
  legs(fig, s);
  pelvis(fig, s);
  torso(fig, s);
  hem(fig, s);
  lapels(fig, s);
  panels(fig, s);
  tie(fig, s);
  arms(fig, s);
  hands(fig, s);
  neck(fig, s);
  head(fig, s);
  return fig;
}

// ---------------------------------------------------------------------------------------------
// PNG and GLB writing

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
function png({ w, h, px }) {
  // RGB (the alpha is always opaque), filter 1 (sub) for smaller files.
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (w * 3 + 1);
    raw[o] = 1;
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) {
        const v = px[(y * w + x) * 4 + c];
        const left = x ? px[(y * w + x - 1) * 4 + c] : 0;
        raw[o + 1 + x * 3 + c] = (v - left) & 255;
      }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  return Buffer.concat([PNG_SIG, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))]);
}

const JOINT_ORDER = Object.keys(JOINT_PARENT);

/**
 * One joint's mesh: flat-shaded triangles grouped by material, sharing one vertex buffer. Each
 * triangle keeps its own face normal, except that neighbours in the same material that are within
 * a few degrees of coplanar are shaded as one face (they share vertices and an averaged normal).
 * Returns { pos, nor, uv (or null), groups: [{ key, idx }] } in the joint's space; `textured`
 * picks the joint's textured materials (their vertices carry UVs) or the rest.
 */
const MERGE_COS = Math.cos(7 * DEG);
function jointMesh(fig, joint, textured) {
  const o = fig.J[joint];
  const pos = [], nor = [], uv = [];
  const map = new Map();
  const groups = [];
  const pkey = (q) => `${Math.round(q[0] * 1e5)},${Math.round(q[1] * 1e5)},${Math.round(q[2] * 1e5)}`;
  for (const [key, all] of Object.entries(fig.parts[joint] ?? {})) {
    const m = fig.materials[fig.matKey[key]];
    if ((m.tex !== undefined) !== textured) continue;
    // Slivers (under ~0.5 mm^2) left by hulls of near-coplanar points are dropped.
    const tris = [];
    for (const [a, b, c] of all) {
      const cr = cross(sub(b, a), sub(c, a));
      if (len(cr) >= 1e-6) tris.push({ v: [a, b, c].map((p) => sub(p, o)), n: nrm(cr), area: len(cr) / 2, face: -1 });
    }
    if (!tris.length) continue;
    // Faces: grow regions of neighbours (sharing an edge) whose normals stay within 4 degrees.
    const byEdge = new Map();
    tris.forEach((t, i) => {
      const k = t.v.map(pkey);
      for (let e = 0; e < 3; e++) {
        const a = k[e], b2 = k[(e + 1) % 3];
        const ek = a < b2 ? a + '|' + b2 : b2 + '|' + a;
        if (!byEdge.has(ek)) byEdge.set(ek, []);
        byEdge.get(ek).push(i);
      }
      t.keys = k;
    });
    const faces = [];
    for (let i = 0; i < tris.length; i++) {
      if (tris[i].face >= 0) continue;
      const f = { n: scl(tris[i].n, tris[i].area), members: [i] };
      tris[i].face = faces.length;
      const stack = [i];
      while (stack.length) {
        const t = tris[stack.pop()];
        for (let e = 0; e < 3; e++) {
          const a = t.keys[e], b2 = t.keys[(e + 1) % 3];
          for (const j of byEdge.get(a < b2 ? a + '|' + b2 : b2 + '|' + a)) {
            const u = tris[j];
            if (u.face >= 0 || dot(u.n, nrm(f.n)) < MERGE_COS || dot(u.n, t.n) < MERGE_COS) continue;
            u.face = faces.length;
            f.n = add(f.n, scl(u.n, u.area));
            f.members.push(j);
            stack.push(j);
          }
        }
      }
      f.n = nrm(f.n);
      faces.push(f);
    }
    const idx = [];
    for (const t of tris) {
      const n = faces[t.face].n;
      const ax = Math.abs(n[0]) > Math.abs(n[1]) && Math.abs(n[0]) > Math.abs(n[2]) ? 0 : Math.abs(n[1]) > Math.abs(n[2]) ? 1 : 2;
      for (let k = 0; k < 3; k++) {
        const q = t.v[k];
        const vk = `${t.keys[k]},${key},${t.face}`;
        let i = map.get(vk);
        if (i === undefined) {
          i = pos.length / 3;
          map.set(vk, i);
          pos.push(q[0], q[1], q[2]);
          nor.push(n[0], n[1], n[2]);
          if (textured) {
            // Box projection in the joint's space (the rest pose).
            const S = m.uvScale;
            const [u, v] = ax === 0 ? [q[2] * Math.sign(n[0]), q[1]] : ax === 1 ? [q[0], q[2]] : [q[0] * -Math.sign(n[2]), q[1]];
            uv.push(u / S, -v / S);
          }
        }
        idx.push(i);
      }
    }
    groups.push({ key, idx });
  }
  return { pos, nor, uv: textured ? uv : null, groups };
}

function glb(fig) {
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
  const accessors = [];
  const acc = (a) => (accessors.push(a), accessors.length - 1);
  // All positions share one buffer view, all normals another, UVs and indices one each; accessors
  // point into them by byte offset. (Views are assigned once everything is gathered.)
  const streams = { pos: [], nor: [], uv: [], idx: [] };
  const lengths = { pos: 0, nor: 0, uv: 0, idx: 0 };
  const put = (stream, buf) => {
    const at = lengths[stream];
    streams[stream].push(buf);
    lengths[stream] += buf.length;
    return at;
  };
  // The shortest decimal that reads back as the same float32 (bounds stay exact, JSON short).
  const short = (v) => {
    for (let p = 1; p < 10; p++) {
      const x = Number(v.toPrecision(p));
      if (Math.fround(x) === Math.fround(v)) return x;
    }
    return v;
  };
  const meshes = [];
  const nodes = [{ name: fig.id, children: [], extras: { title: fig.name } }];
  const nodeOf = {};
  const meshOf = {};
  for (const j of JOINT_ORDER) if (!EMPTY.has(j)) meshOf[j] = [jointMesh(fig, j, false), jointMesh(fig, j, true)].filter((mm) => mm.groups.length);
  // Only the materials (and textures) the parts use are written.
  const usedKeys = fig.materials.map((m) => m.key).filter((k) => Object.values(meshOf).some((sets) => sets.some((mm) => mm.groups.some((g) => g.key === k))));
  const matIndex = Object.fromEntries(usedKeys.map((k, i) => [k, i]));
  const usedTex = [...new Set(usedKeys.map((k) => fig.materials[fig.matKey[k]].tex).filter((t) => t !== undefined))];
  let tris = 0;
  for (const j of JOINT_ORDER) {
    const parent = JOINT_PARENT[j];
    const t = parent ? sub(fig.J[j], fig.J[parent]) : fig.J[j];
    const node = { name: j, translation: t.map((v) => Math.round(v * 1e5) / 1e5), children: [] };
    nodeOf[j] = nodes.length;
    nodes.push(node);
    nodes[parent ? nodeOf[parent] : 0].children.push(nodeOf[j]);
    if (!meshOf[j]?.length) continue;
    const primitivesOut = [];
    for (const mm of meshOf[j]) {
      // One vertex buffer per joint (two if some of its cloth is textured: only that carries UVs),
      // positions rounded to 0.01 mm; one index range per material.
      const count = mm.pos.length / 3;
      if (count > 65535) throw new Error(`${fig.id}: ${j} has ${count} vertices`);
      const pos = mm.pos.map((v) => Math.fround(Math.round(v * 1e5) / 1e5));
      const min = [0, 1, 2].map((k) => Math.min(...pos.filter((_, i) => i % 3 === k)));
      const max = [0, 1, 2].map((k) => Math.max(...pos.filter((_, i) => i % 3 === k)));
      const attributes = {
        POSITION: acc({ bufferView: 'pos', byteOffset: put('pos', f32(pos)), componentType: 5126, count, type: 'VEC3', min: min.map(short), max: max.map(short) }),
        NORMAL: acc({ bufferView: 'nor', byteOffset: put('nor', f32(mm.nor)), componentType: 5126, count, type: 'VEC3' }),
      };
      if (mm.uv) attributes.TEXCOORD_0 = acc({ bufferView: 'uv', byteOffset: put('uv', f32(mm.uv)), componentType: 5126, count, type: 'VEC2' });
      const allIdx = mm.groups.flatMap((g) => g.idx);
      const i0 = put('idx', Buffer.from(new Uint16Array(allIdx).buffer));
      let at = 0;
      for (const g of mm.groups) {
        const I = acc({ bufferView: 'idx', byteOffset: i0 + at * 2, componentType: 5123, count: g.idx.length, type: 'SCALAR' });
        at += g.idx.length;
        primitivesOut.push({ attributes, indices: I, material: matIndex[g.key] });
        tris += g.idx.length / 3;
      }
    }
    meshes.push({ name: `${j}_mesh`, primitives: primitivesOut });
    const mnode = nodes.length;
    nodes.push({ name: `${j}_mesh`, mesh: meshes.length - 1 });
    node.children.unshift(mnode);
  }
  for (const n of nodes) if (n.children && !n.children.length) delete n.children;
  const viewOf = {};
  for (const k of ['pos', 'nor', 'uv', 'idx']) if (lengths[k]) viewOf[k] = addView(Buffer.concat(streams[k]), k === 'idx' ? 34963 : 34962);
  for (const a of accessors) {
    a.bufferView = viewOf[a.bufferView];
    if (!a.byteOffset) delete a.byteOffset;
  }
  const images = usedTex.map((ti) => ({ name: `${fig.id}_${fig.textures[ti].name}`, bufferView: addView(png(fig.textures[ti])), mimeType: 'image/png' }));
  const json = {
    asset: { version: '2.0', generator: 'Call of Blocky scripts/fighters/build.mjs' },
    scene: 0,
    scenes: [{ name: fig.id, nodes: [0] }],
    nodes,
    meshes,
    materials: usedKeys.map((k) => {
      const m = fig.materials[fig.matKey[k]];
      return {
        name: `${fig.id}_${m.key}`,
        pbrMetallicRoughness: {
          baseColorFactor: linear(m.color).map((v) => Math.round(v * 1e4) / 1e4),
          metallicFactor: m.metal,
          roughnessFactor: m.rough,
          ...(m.tex !== undefined ? { baseColorTexture: { index: usedTex.indexOf(m.tex) } } : {}),
        },
      };
    }),
    ...(images.length
      ? {
          textures: images.map((_, i) => ({ sampler: 0, source: i })),
          samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
          images,
        }
      : {}),
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: 0 }],
  };
  const tail = (4 - (offset % 4)) % 4;
  if (tail) chunks.push(Buffer.alloc(tail));
  const bin = Buffer.concat(chunks);
  json.buffers[0].byteLength = bin.length;
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
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
  return { bytes: Buffer.concat([header, jh, jsonBuf, bh, bin]), tris };
}

// ---------------------------------------------------------------------------------------------
// Validation: parse the GLB back and check the file, the rig and the budgets.

function validate(buf, fig) {
  const fail = (m) => {
    throw new Error(`${fig.id}.glb: ${m}`);
  };
  if (buf.readUInt32LE(0) !== 0x46546c67 || buf.readUInt32LE(4) !== 2 || buf.readUInt32LE(8) !== buf.length) fail('bad header');
  const jlen = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a || jlen % 4) fail('bad JSON chunk');
  const json = JSON.parse(buf.subarray(20, 20 + jlen).toString('utf8'));
  const bo = 20 + jlen;
  const blen = buf.readUInt32LE(bo);
  if (buf.readUInt32LE(bo + 4) !== 0x004e4942 || blen % 4 || bo + 8 + blen !== buf.length) fail('bad BIN chunk');
  const bin = buf.subarray(bo + 8);
  if (json.buffers[0].byteLength !== blen) fail('buffer length');
  for (const v of json.bufferViews) if (v.byteOffset + v.byteLength > blen || v.byteOffset % 4) fail('bufferView out of range');
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
  // The rig: names, parents, rest translations, no rotation or scale.
  const byName = new Map(json.nodes.map((n, i) => [n.name, i]));
  const parentOf = new Map();
  json.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parentOf.set(c, i)));
  if (json.nodes[json.scenes[0].nodes[0]].name !== fig.id) fail('root not named after the fighter');
  const world = (i) => {
    let p = [0, 0, 0];
    for (let k = i; k !== undefined; k = parentOf.get(k)) p = add(p, json.nodes[k].translation ?? [0, 0, 0]);
    return p;
  };
  for (const j of JOINT_ORDER) {
    const i = byName.get(j);
    if (i === undefined) fail(`joint ${j} missing`);
    const n = json.nodes[i];
    if (n.rotation || n.scale || n.matrix) fail(`${j} has a rotation/scale`);
    const want = JOINT_PARENT[j] ?? fig.id;
    if (json.nodes[parentOf.get(i)].name !== want) fail(`${j}'s parent is ${json.nodes[parentOf.get(i)].name}, not ${want}`);
    if (len(sub(world(i), fig.J[j])) > 1e-4) fail(`${j} at ${world(i)}`);
    if (EMPTY.has(j) && (n.mesh !== undefined || n.children)) fail(`${j} should be empty`);
  }
  // Geometry: bounds, unit normals, winding, indices; triangles in budget.
  let tris = 0;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const [mi, mesh] of json.meshes.entries()) {
    const node = json.nodes.findIndex((n) => n.mesh === mi);
    const w = world(node);
    for (const prim of mesh.primitives) {
      const pa = json.accessors[prim.attributes.POSITION];
      const P = read(pa), N = read(json.accessors[prim.attributes.NORMAL]), I = read(json.accessors[prim.indices]);
      const mat0 = json.materials[prim.material];
      if (mat0.pbrMetallicRoughness.baseColorTexture) {
        if (prim.attributes.TEXCOORD_0 === undefined || read(json.accessors[prim.attributes.TEXCOORD_0]).length / 2 !== pa.count) fail('textured primitive without UVs');
      }
      for (let k = 0; k < 3; k++) {
        let a = Infinity, b = -Infinity;
        for (let m = k; m < P.length; m += 3) (a = Math.min(a, P[m])), (b = Math.max(b, P[m]));
        if (a !== Math.fround(pa.min[k]) || b !== Math.fround(pa.max[k])) fail('POSITION min/max');
        lo[k] = Math.min(lo[k], a + w[k]);
        hi[k] = Math.max(hi[k], b + w[k]);
      }
      for (let m = 0; m < N.length; m += 3) if (Math.abs(Math.hypot(N[m], N[m + 1], N[m + 2]) - 1) > 1e-4) fail('normal not unit');
      for (const i of I) if (i >= pa.count) fail('index out of range');
      for (let m = 0; m < I.length; m += 3) {
        const [a, b, c] = [I[m], I[m + 1], I[m + 2]].map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
        const cr = cross(sub(b, a), sub(c, a));
        const n = [N[I[m] * 3], N[I[m] * 3 + 1], N[I[m] * 3 + 2]];
        if (dot(cr, n) <= 0 && len(cr) > 1e-6) fail(`triangle winding (${mesh.name}) ${len(cr)}`);
      }
      tris += I.length / 3;
      const mat = json.materials[prim.material];
      if (!mat?.pbrMetallicRoughness?.baseColorFactor) fail('material without PBR');
    }
  }
  if (tris > MAX_TRIS) fail(`${tris} triangles (budget ${MAX_TRIS})`);
  if (buf.length > MAX_BYTES) fail(`${buf.length} bytes (budget ${MAX_BYTES})`);
  if (lo[1] < -0.002 || hi[1] > 2.0 || hi[1] < 1.75) fail(`height ${lo[1]}..${hi[1]}`);
  for (const img of json.images ?? []) {
    const v = json.bufferViews[img.bufferView];
    const data = bin.subarray(v.byteOffset, v.byteOffset + v.byteLength);
    if (!data.subarray(0, 8).equals(PNG_SIG)) fail('image is not a PNG');
    const w = data.readUInt32BE(16), h = data.readUInt32BE(20);
    let o = 8;
    const idat = [];
    while (o < data.length) {
      const l = data.readUInt32BE(o);
      if (crc32(data.subarray(o + 4, o + 8 + l)) !== data.readUInt32BE(o + 8 + l)) fail('PNG CRC');
      if (data.subarray(o + 4, o + 8).toString('ascii') === 'IDAT') idat.push(data.subarray(o + 8, o + 8 + l));
      o += 12 + l;
    }
    if (inflateSync(Buffer.concat(idat)).length !== (w * 3 + 1) * h) fail('PNG data size');
  }
  return { tris, lo, hi, materials: json.materials.length };
}

// ---------------------------------------------------------------------------------------------

const only = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
for (const d of OUTFITS) {
  if (only.length && !only.includes(d.id)) continue;
  const fig = makeFighter(d);
  const { bytes } = glb(fig);
  const file = join(OUT, `${d.id}.glb`);
  writeFileSync(file, bytes);
  const v = validate(readFileSync(file), fig);
  const fmt = (p) => p.map((x) => x.toFixed(3)).join(', ');
  console.log(`${d.id}.glb  ${d.name} (${d.build}): ${v.tris} tris, ${v.materials} materials, ${(bytes.length / 1024).toFixed(1)} KB, bounds (${fmt(v.lo)}) .. (${fmt(v.hi)})`);
}
if (!only.length) {
  const lines = [
    ...OUTFITS.map((d) => `import ${d.id} from './${d.id}.glb?url';`),
    '',
    '/**',
    ' * The fighters (GLB, written by `scripts/fighters/build.mjs`; see its header and docs/HUMANOID.md',
    ' * for the rig: hips > spine > chest > neck > head, the arms and legs, `gripR` / `gripL`).',
    ' */',
    'export interface FighterModel {',
    '  id: string;',
    '  name: string;',
    '  url: string;',
    '}',
    '',
    'export const FIGHTERS: FighterModel[] = [',
    ...OUTFITS.map((d) => `  { id: '${d.id}', name: '${d.name}', url: ${d.id} },`),
    '];',
    '',
  ];
  writeFileSync(join(OUT, 'index.ts'), lines.join('\n'));
}
