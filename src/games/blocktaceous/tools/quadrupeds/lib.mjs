/**
 * Blocktaceous: what the four-legged animals (and the pterosaur) are built with. Shapes are given
 * in metres (the animal facing +z, its left +x, feet on y = 0) and painted into micro-voxel parts,
 * a part per joint; the parts are meshed by the platform's voxel tools (`../voxel.mjs`) into one
 * skinned mesh, every vertex wholly on its part's joint, and written as a quantized, compressed
 * GLB. This file adds what those tools leave out: shapes (ellipsoids, tapered limbs, chains),
 * skeletons, poses with legs placed by inverse kinematics, and animation clips in the file.
 */
import { Palette, Voxels, faces, atlas, quadCorners, png, writeGlb, readGlb, cellKey, cellOf, DIRS } from '../voxel.mjs';
import { encodeVertexBuffer } from '../meshopt.mjs';

// ---------------------------------------------------------------------------------------------
// Vectors and quaternions ([x, y, z, w])

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
export const smooth = (t) => {
  const c = clamp(t);
  return c * c * (3 - 2 * c);
};
const RAD = Math.PI / 180;
export const TAU = Math.PI * 2;

const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qrot = (q, v) => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
};
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const qaxis = (axis, deg) => {
  const h = (deg * RAD) / 2, s = Math.sin(h);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)];
};
/** Degrees about x (nose down, a leg back), y (to its left), z (rolling to its right): yaw, then pitch, then roll. */
export const quat = (r) => (r ? qmul(qmul(qaxis([0, 1, 0], r[1]), qaxis([1, 0, 0], r[0])), qaxis([0, 0, 1], r[2])) : [0, 0, 0, 1]);

// ---------------------------------------------------------------------------------------------
// Shapes: { lo, hi, inside(p) } in metres

/** How square the shapes are: 2 is round, more is boxier (flat sides with rounded edges, as the platform's figures are drawn). */
export const SQUARE = 2.8;
const pw = (v, n) => (n === 2 ? v * v : Math.abs(v) ** n);
export const ell = (c, r, n = SQUARE) => ({
  lo: sub(c, r),
  hi: add(c, r),
  inside: (p) => pw((p[0] - c[0]) / r[0], n) + pw((p[1] - c[1]) / r[1], n) + pw((p[2] - c[2]) / r[2], n) <= 1,
});
/** A limb from a to b, radius ra to rb; `sx` widens (or narrows) it across x, `sy` across y; `n` how square it is across. */
export function cap(a, b, ra, rb = ra, sx = 1, sy = 1, n = SQUARE) {
  const ab = sub(b, a);
  const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1e-9;
  const m = Math.max(ra, rb), mx = m * Math.max(1, sx), my = m * Math.max(1, sy);
  return {
    lo: [Math.min(a[0], b[0]) - mx, Math.min(a[1], b[1]) - my, Math.min(a[2], b[2]) - m],
    hi: [Math.max(a[0], b[0]) + mx, Math.max(a[1], b[1]) + my, Math.max(a[2], b[2]) + m],
    inside: (p) => {
      const t = clamp(((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / l2);
      const r = ra + (rb - ra) * t;
      const dx = (p[0] - a[0] - ab[0] * t) / sx, dy = (p[1] - a[1] - ab[1] * t) / sy, dz = p[2] - a[2] - ab[2] * t;
      return pw(dx, n) + pw(dy, n) + pw(dz, n) <= pw(r, n);
    },
  };
}
export const union = (...shapes) => ({
  lo: shapes.reduce((m, s) => m.map((v, a) => Math.min(v, s.lo[a])), [Infinity, Infinity, Infinity]),
  hi: shapes.reduce((m, s) => m.map((v, a) => Math.max(v, s.hi[a])), [-Infinity, -Infinity, -Infinity]),
  inside: (p) => shapes.some((s) => p[0] >= s.lo[0] && p[0] <= s.hi[0] && p[1] >= s.lo[1] && p[1] <= s.hi[1] && p[2] >= s.lo[2] && p[2] <= s.hi[2] && s.inside(p)),
});
/** A chain of limbs through points, with a radius at each. */
export const chain = (pts, radii, sx = 1, sy = 1, n = SQUARE) => union(...pts.slice(1).map((p, i) => cap(pts[i], p, radii[i], radii[i + 1], sx, sy, n)));
/** A box, its edges rounded by r. */
export const box = (lo, hi, r = 0) => ({
  lo,
  hi,
  inside: (p) => {
    if (r <= 0) return true;
    let d2 = 0;
    for (let a = 0; a < 3; a++) {
      const q = Math.max(lo[a] + r - p[a], 0, p[a] - (hi[a] - r));
      d2 += q * q;
    }
    return d2 <= r * r;
  },
});
/** A shape, kept only where `keep(p)` holds. */
export const where = (s, keep) => ({ lo: s.lo, hi: s.hi, inside: (p) => s.inside(p) && keep(p) });
/** A shape mirrored across x = 0. */
export const mirror = (s) => ({ lo: [-s.hi[0], s.lo[1], s.lo[2]], hi: [-s.lo[0], s.hi[1], s.hi[2]], inside: (p) => s.inside([-p[0], p[1], p[2]]) });

/** A repeatable noise in 0..1 from a point in a lattice of `size` metres. */
export function noise(p, size, salt = 0) {
  let h = Math.imul(Math.floor(p[0] / size) + 7919 * (salt + 1), 0x27d4eb2d) ^ Math.imul(Math.floor(p[1] / size) + 104729, 0x165667b1) ^ Math.imul(Math.floor(p[2] / size) + 15485863, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------------------------
// The model

export class Model {
  /** `scale`: voxels a metre. */
  constructor(id, name, scale) {
    this.id = id;
    this.name = name;
    this.S = scale;
    this.vox = new Voxels();
    this.P = new Palette();
    this.joints = new Map();
    this.empties = new Set();
    this.legs = {};
    this.rest = {};
    this.clips = [];
  }
  colour(name, rgb, opts = {}) {
    return this.P.add(name, rgb, { rough: 0.85, vary: 0.035, ...opts });
  }
  /** A joint at a place (metres, standing as modelled), hanging from its parent ('root' for none). */
  joint(name, parent, at, { empty = false } = {}) {
    this.joints.set(name, { name, parent: parent === 'root' ? null : parent, at });
    if (empty) this.empties.add(name);
    return name;
  }
  /** The same joint on both sides: `nameL` at `at`, `nameR` mirrored; a parent ending `*` is sided too. */
  jointLR(name, parent, at) {
    const sided = parent.endsWith('*');
    for (const [s, x] of [['L', 1], ['R', -1]]) this.joint(name + s, sided ? parent.slice(0, -1) + s : parent, [at[0] * x, at[1], at[2]]);
  }
  /** A leg for the gaits: its three joints (hip or shoulder, knee or elbow, ankle or wrist). */
  leg(key, upper, lower, foot, { plant = null, bend = 0 } = {}) {
    // `plant`: where its ankle stands, if not where it was modelled (a model built in another pose); `bend`: 1 knee forward, -1 back, if the modelled leg is too straight to tell.
    this.legs[key] = { upper, lower, foot, plant, bend };
  }
  /** Paint a shape into a part: `colour` a name, or `(p) => name` (nothing: leave the cell). */
  paint(part, shape, colour) {
    if (!this.joints.has(part)) throw new Error(`${this.id}: no joint ${part}`);
    const S = this.S;
    const f = typeof colour === 'function' ? colour : () => colour;
    const lo = shape.lo.map((v) => Math.floor(v * S)), hi = shape.hi.map((v) => Math.ceil(v * S));
    this.vox.paint(part, lo, hi, (i, j, k) => {
      const p = [(i + 0.5) / S, (j + 0.5) / S, (k + 0.5) / S];
      if (p[1] < 0) return;
      for (let a = 0; a < 3; a++) if (p[a] < shape.lo[a] || p[a] > shape.hi[a]) return;
      if (!shape.inside(p)) return;
      return f(p);
    });
  }
  /** Paint on both sides: `partL` as given (x > 0), `partR` mirrored (the colour sees the left's point). */
  paintLR(part, shape, colour) {
    const f = typeof colour === 'function' ? colour : () => colour;
    const sided = this.joints.has(part + 'L');
    this.paint(sided ? part + 'L' : part, shape, f);
    this.paint(sided ? part + 'R' : part, mirror(shape), (p) => f([-p[0], p[1], p[2]]));
  }
  /** Clear a shape's cells from a part. */
  erase(part, shape) {
    this.paint(part, shape, () => false);
  }
  /** Recolour a part's voxels where they're filled: `fn(p, colour)` gives the new one (or nothing). */
  recolour(part, fn) {
    const S = this.S;
    this.vox.recolour(part, (i, j, k, c) => fn([(i + 0.5) / S, (j + 0.5) / S, (k + 0.5) / S], c));
  }
  /** Is a point inside the part (or any part)? */
  filled(p, part) {
    return this.vox.filled(Math.floor(p[0] * this.S), Math.floor(p[1] * this.S), Math.floor(p[2] * this.S), part);
  }
  /**
   * A clip: `pose(u)` for u in 0..1 gives { joint: { r: [degrees x, y, z], t: [metres] } } for the
   * joints it moves (from how the model was built), and `feet: { leg: { x, y, z, pitch } }`: where
   * each leg's ankle is from where it stands (the legs bend to reach; a leg left out stays
   * planted), or `legs: false` to pose the legs' joints itself.
   */
  clip(name, duration, pose, { keys = 16, loop = true } = {}) {
    this.clips.push({ name, duration, pose, keys, loop });
  }
}

// ---------------------------------------------------------------------------------------------
// Poses

/** How far short the legs fell of where a pose wanted their ankles (metres, the worst since it was reset): a pose asking too much. */
export const reach = { short: 0 };

/** Each joint's place and turn in the model's space for a pose (joint -> { r, t }). */
function solve(model, pose) {
  const world = new Map();
  const local = new Map();
  const at = (name) => {
    if (world.has(name)) return world.get(name);
    const j = model.joints.get(name);
    const parent = j.parent ? at(j.parent) : { p: [0, 0, 0], q: [0, 0, 0, 1] };
    const restT = j.parent ? sub(j.at, model.joints.get(j.parent).at) : j.at;
    const ps = pose[name] ?? {};
    const t = ps.t ? add(restT, ps.t) : restT;
    const q = quat(ps.r);
    // A scale is for leaves only (a membrane drawn in): what hangs from a joint isn't scaled with it here.
    local.set(name, { t, q, s: ps.s ?? [1, 1, 1] });
    const w = { p: add(parent.p, qrot(parent.q, t)), q: qmul(parent.q, q) };
    world.set(name, w);
    return w;
  };
  // The legs: each ankle put where the pose says (from where it stands), in its parent's own plane.
  if (pose.legs !== false)
    for (const [key, leg] of Object.entries(model.legs)) {
      const H = model.joints.get(leg.upper), K = model.joints.get(leg.lower), A = model.joints.get(leg.foot);
      const f = pose.feet?.[key] ?? {};
      const parent = at(H.parent);
      const hip = add(parent.p, qrot(parent.q, sub(H.at, model.joints.get(H.parent).at)));
      const target = add(leg.plant ?? A.at, [f.x ?? 0, f.y ?? 0, f.z ?? 0]);
      const v = qrot(qinv(parent.q), sub(target, hip));
      const u0 = sub(K.at, H.at), l0 = sub(A.at, K.at);
      const Lu = Math.hypot(u0[1], u0[2]), Ll = Math.hypot(l0[1], l0[2]);
      const ang = (z, y) => Math.atan2(z, -y);
      const want = Math.hypot(v[1], v[2]);
      const d = clamp(want, Math.abs(Lu - Ll) + 1e-4, Lu + Ll - 1e-4);
      reach.short = Math.max(reach.short, Math.abs(want - d));
      const aT = ang(v[2], v[1]);
      const alpha = Math.acos(clamp((Lu * Lu + d * d - Ll * Ll) / (2 * Lu * d), -1, 1));
      // The knee bends the way it does at rest (ahead of the line from hip to ankle, or behind it).
      const t0 = sub(A.at, H.at);
      let bend = leg.bend || Math.sign(Math.sin(ang(u0[2], u0[1]) - ang(t0[2], t0[1])));
      if (!bend) bend = leg.upper.includes('F') ? -1 : 1;
      const phiU = aT + bend * alpha;
      const knee = [Math.sin(phiU) * Lu, -Math.cos(phiU) * Lu];
      const phiL = ang(Math.sin(aT) * d - knee[0], -Math.cos(aT) * d - knee[1]);
      const th1 = -(phiU - ang(u0[2], u0[1])) / RAD;
      const thL = -(phiL - ang(l0[2], l0[1])) / RAD;
      const fwd = qrot(parent.q, [0, 0, 1]);
      const parentPitch = Math.atan2(-fwd[1], Math.hypot(fwd[0], fwd[2])) / RAD;
      // Sideways reach: the whole leg swung out or in from the hip.
      const side = leg.plant ? 0 : Math.atan2(v[0] - t0[0], Math.max(0.05, -v[1])) / RAD;
      pose = { ...pose, [leg.upper]: { r: [th1, 0, side] }, [leg.lower]: { r: [thL - th1, 0, 0] }, [leg.foot]: { r: [(f.pitch ?? 0) - parentPitch - thL, 0, -side] } };
    }
  for (const name of model.joints.keys()) at(name);
  return { world, local };
}

// ---------------------------------------------------------------------------------------------
// The file

const pad4 = (n) => Math.ceil(n / 4) * 4;

/** Drop faces that can never show: buried a voxel or more deep inside another part. */
function cull(vox, list) {
  const deep = (i, j, k, part) => {
    for (const [name, cells] of vox.parts) {
      if (name === part) continue;
      if (!cells.has(cellKey(i, j, k))) continue;
      let all = true;
      for (const { n } of DIRS) if (!cells.has(cellKey(i + n[0], j + n[1], k + n[2]))) all = false;
      if (all) return true;
    }
    return false;
  };
  return list.filter((f) => !(f.ao === 15 && deep(f.cell[0], f.cell[1], f.cell[2], f.part) && deep(f.cell[0] + DIRS[f.dir].n[0], f.cell[1] + DIRS[f.dir].n[1], f.cell[2] + DIRS[f.dir].n[2], f.part)));
}

/**
 * Faces of one part, plane, colour and occlusion merged: unshaded ones into rectangles, and ones
 * shaded along one edge only (a step's riser or tread) into strips along that edge, where
 * stretching the tile leaves its shading as it was.
 */
function merge(list) {
  const out = [];
  const groups = new Map();
  for (const f of list) {
    const along = f.ao === 0 ? 'both' : (f.ao & ~3) === 0 ? 'v' : (f.ao & ~12) === 0 ? 'u' : null;
    if (!along) {
      out.push(f);
      continue;
    }
    const { n } = DIRS[f.dir];
    const a = n[0] ? 0 : n[1] ? 1 : 2;
    const key = `${f.part}|${f.dir}|${f.cell[a]}|${f.colour}|${f.shade}|${f.ao}`;
    if (!groups.has(key)) groups.set(key, { along, fs: [] });
    groups.get(key).fs.push(f);
  }
  for (const { along, fs } of groups.values()) {
    const { u, v } = DIRS[fs[0].dir];
    const ua = u.indexOf(1), va = v.indexOf(1);
    const at = new Map(fs.map((f) => [`${f.cell[ua]},${f.cell[va]}`, f]));
    const used = new Set();
    const free = (x, y) => at.has(`${x},${y}`) && !used.has(`${x},${y}`);
    const sorted = [...fs].sort((p, q) => p.cell[va] - q.cell[va] || p.cell[ua] - q.cell[ua]);
    for (const f of sorted) {
      const u0 = f.cell[ua], v0 = f.cell[va];
      if (used.has(`${u0},${v0}`)) continue;
      let w = 1, h = 1;
      if (along !== 'v') while (free(u0 + w, v0)) w++;
      if (along !== 'u')
        grow: for (;;) {
          for (let x = 0; x < w; x++) if (!free(u0 + x, v0 + h)) break grow;
          h++;
        }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) used.add(`${u0 + x},${v0 + y}`);
      out.push({ ...f, du: w, dv: h });
    }
  }
  return out;
}

/** The model as a GLB, and what's in it. */
export function build(model, { generator, vary = false } = {}) {
  const S = model.S;
  const bones = [...model.joints.keys()].filter((j) => !model.empties.has(j));
  for (const part of model.vox.parts.keys()) if (!bones.includes(part)) throw new Error(`${model.id}: part ${part} has no bone`);
  let { faces: list } = faces(model.vox, model.P, { vary });
  list = merge(cull(model.vox, list));
  const A = atlas(list, model.P);
  const round = (v) => Math.round(v * 1e5) / 1e5;
  const nodes = [{ name: model.id, children: [], extras: { title: model.name } }];
  const nodeOf = {};
  const rest = solve(model, { ...model.rest, legs: model.rest.legs ?? false });
  for (const [name, j] of model.joints) {
    nodeOf[name] = nodes.length;
    const l = rest.local.get(name);
    const node = { name, translation: l.t.map(round), children: [] };
    if (l.q[3] < 0.999999) node.rotation = l.q.map((v) => Math.round(v * 1e6) / 1e6);
    if (l.s.some((v) => v !== 1)) node.scale = l.s;
    nodes.push(node);
  }
  for (const [name, j] of model.joints) nodes[j.parent ? nodeOf[j.parent] : 0].children.push(nodeOf[name]);
  const meshNode = nodes.length;
  nodes.push({ name: 'skin' });
  nodes[0].children.push(meshNode);
  for (const n of nodes) if (n.children && !n.children.length) delete n.children;

  const boneOf = Object.fromEntries(bones.map((j, i) => [j, i]));
  // Bone by bone, and within a bone by direction and tile, then place: runs of like values pack small.
  const tileOf = list.map((_, i) => A.uvs[i][0][0] + A.uvs[i][0][1] * 4096);
  const order = list.map((_, i) => i).sort((a, b) => boneOf[list[a].part] - boneOf[list[b].part] || list[a].dir - list[b].dir || tileOf[a] - tileOf[b] || a - b);
  const pos = [], nor = [], uv = [], jo = [], we = [], idx = [];
  for (const fi of order) {
    const f = list[fi];
    const base = pos.length / 3;
    const corners = quadCorners(f);
    const n = DIRS[f.dir].n;
    for (let c = 0; c < 4; c++) {
      pos.push(...corners[c]);
      nor.push(n[0] * 127, n[1] * 127, n[2] * 127);
      uv.push(Math.round(A.uvs[fi][c][0] * 65535), Math.round(A.uvs[fi][c][1] * 65535));
      jo.push(boneOf[f.part], 0, 0, 0);
      we.push(255, 0, 0, 0);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  // Each bone's inverse bind matrix: from voxel coordinates into its joint's space as modelled.
  const ibm = new Float32Array(bones.length * 16);
  bones.forEach((j, n) => {
    for (let k = 0; k < 3; k++) ibm[n * 16 + k * 5] = 1 / S;
    ibm[n * 16 + 15] = 1;
    for (let k = 0; k < 3; k++) ibm[n * 16 + 12 + k] = -model.joints.get(j).at[k];
  });
  const first = bones.find((j) => !model.joints.get(j).parent);
  const base = writeGlb({
    generator,
    nodes,
    sceneName: model.id,
    meshName: model.id,
    meshNode,
    attributes: {
      POSITION: { values: pos, componentType: 5122, type: 'VEC3', minmax: true },
      NORMAL: { values: nor, componentType: 5120, type: 'VEC3', normalized: true },
      TEXCOORD_0: { values: uv, componentType: 5123, type: 'VEC2', normalized: true },
      JOINTS_0: { values: jo, componentType: 5121, type: 'VEC4' },
      WEIGHTS_0: { values: we, componentType: 5121, type: 'VEC4', normalized: true },
    },
    indices: idx,
    skin: { name: `${model.id}_skeleton`, joints: bones.map((j) => nodeOf[j]), skeleton: nodeOf[first], inverseBindMatrices: ibm },
    material: { name: model.id, albedo: png(A.albedo), mr: png(A.mr) },
    compress: true,
    quantized: true,
  });
  const bytes = animate(base, model, nodeOf);
  // The size as it stands at rest, for the report.
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let a = 0; a < 3; a++) (lo[a] = Math.min(lo[a], pos[i + a] / S)), (hi[a] = Math.max(hi[a], pos[i + a] / S));
  // And as it stands at rest, if that's another pose: every part's cells where its joint puts them.
  if (Object.keys(model.rest).length) {
    lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const bind = solve(model, { legs: false }).world;
    for (const [part, cells] of model.vox.parts) {
      const w = rest.world.get(part), b = bind.get(part);
      for (const key of cells.keys()) {
        const c = cellOf(key);
        const sc = rest.local.get(part).s;
        const p = add(w.p, qrot(w.q, sub([(c[0] + 0.5) / S, (c[1] + 0.5) / S, (c[2] + 0.5) / S], b.p).map((v, a) => v * sc[a])));
        for (let a = 0; a < 3; a++) (lo[a] = Math.min(lo[a], p[a] - 0.5 / S)), (hi[a] = Math.max(hi[a], p[a] + 0.5 / S));
      }
    }
  }
  if (process.argv.includes('--joints')) for (const [name, w] of rest.world) console.log(`  ${name}: ${w.p.map((v) => v.toFixed(2)).join(', ')}`);
  return { bytes, stats: { triangles: idx.length / 3, voxels: model.vox.count, tiles: A.tiles, bytes: bytes.length, lo, hi, nodes: nodes.map((n) => n.name), clips: model.clips.map((c) => c.name) } };
}

/** Write the clips into a GLB: rotations as 16-bit quaternions, compressed like the mesh. */
function animate(glb, model, nodeOf) {
  const jlen = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jlen).toString('utf8'));
  const old = glb.subarray(20 + jlen + 8);
  // The file's buffer again, view by view, with the indices repacked: every face is a quad of four
  // new vertices in order, (b, b+1, b+2) then (b, b+2, b+3), which the triangle codec writes in a
  // byte a triangle (all three vertices next; then the last edge and the next vertex), a third of
  // what the tools' index sequence takes.
  const bin = [];
  let offset = 0;
  const indexView = json.accessors[json.meshes[0].primitives[0].indices].bufferView;
  json.bufferViews.forEach((v, i) => {
    const ext = v.extensions?.EXT_meshopt_compression;
    let src = ext ? old.subarray(ext.byteOffset, ext.byteOffset + ext.byteLength) : old.subarray(v.byteOffset, v.byteOffset + v.byteLength);
    if (i === indexView) {
      const tris = ext.count / 3;
      src = Buffer.alloc(1 + tris + 16);
      src[0] = 0xe1;
      for (let t = 0; t < tris; t += 2) src[1 + t] = 0xf0;
      ext.mode = 'TRIANGLES';
      ext.byteLength = src.length;
    }
    const padded = Buffer.concat([src, Buffer.alloc(pad4(src.length) - src.length)]);
    bin.push(padded);
    if (ext) ext.byteOffset = offset;
    else v.byteOffset = offset;
    offset += padded.length;
  });
  let fallback = json.buffers[1].byteLength;
  const view = (raw, count, stride) => {
    const enc = Buffer.from(encodeVertexBuffer(raw, count, stride));
    const padded = Buffer.concat([enc, Buffer.alloc(pad4(enc.length) - enc.length)]);
    bin.push(padded);
    json.bufferViews.push({ buffer: 1, byteOffset: fallback, byteLength: raw.length, extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: offset, byteLength: enc.length, byteStride: stride, mode: 'ATTRIBUTES', count } } });
    offset += padded.length;
    fallback += pad4(raw.length);
    return json.bufferViews.length - 1;
  };
  const times = [], quats = [], vecs = [];
  const animations = [];
  const pending = [];
  for (const clip of model.clips) {
    const n = clip.keys + 1;
    const frames = [];
    reach.short = 0;
    for (let k = 0; k < n; k++) {
      const u = clip.loop ? (k / clip.keys) % 1 : k / clip.keys;
      frames.push(solve(model, clip.pose(u)).local);
    }
    if (reach.short > 0.02) console.warn(`  ${model.id} ${clip.name}: a leg is ${reach.short.toFixed(2)} m short of its foot`);
    const tAt = times.length;
    for (let k = 0; k < n; k++) times.push((k / clip.keys) * clip.duration);
    const anim = { name: clip.name, samplers: [], channels: [] };
    const input = { times: tAt, count: n, max: clip.duration };
    const restPose = solve(model, { ...model.rest, legs: model.rest.legs ?? false }).local;
    for (const name of model.joints.keys()) {
      const r0 = restPose.get(name);
      const moved = (get) => frames.some((f) => get(f.get(name)).some((v, i) => Math.abs(v - get(r0)[i]) > 1e-5));
      if (moved((l) => l.q)) {
        const at = quats.length / 4;
        let prev = null;
        for (const f of frames) {
          let q = f.get(name).q;
          // Neighbouring keys on the same side of the sphere, so they blend the short way.
          if (prev && q[0] * prev[0] + q[1] * prev[1] + q[2] * prev[2] + q[3] * prev[3] < 0) q = q.map((v) => -v);
          prev = q;
          quats.push(...q.map((v) => Math.round(v * 32767)));
        }
        pending.push({ anim, node: nodeOf[name], path: 'rotation', input, kind: 'q', at });
      }
      for (const [path, get] of [['translation', (l) => l.t], ['scale', (l) => l.s]]) {
        if (!moved(get)) continue;
        const at = vecs.length / 3;
        for (const f of frames) vecs.push(...get(f.get(name)));
        pending.push({ anim, node: nodeOf[name], path, input, kind: 'v', at });
      }
    }
    animations.push(anim);
  }
  const tRaw = Buffer.from(new Float32Array(times).buffer);
  const qRaw = Buffer.from(new Int16Array(quats).buffer);
  const vRaw = Buffer.from(new Float32Array(vecs).buffer);
  const tView = view(tRaw, times.length, 4);
  const qView = quats.length ? view(qRaw, quats.length / 4, 8) : -1;
  const vView = vecs.length ? view(vRaw, vecs.length / 3, 12) : -1;
  const inputs = new Map();
  for (const p of pending) {
    let inAcc = inputs.get(p.input);
    if (inAcc === undefined) {
      json.accessors.push({ bufferView: tView, byteOffset: p.input.times * 4, componentType: 5126, count: p.input.count, type: 'SCALAR', min: [0], max: [Math.fround(p.input.max)] });
      inAcc = json.accessors.length - 1;
      inputs.set(p.input, inAcc);
    }
    if (p.kind === 'q') json.accessors.push({ bufferView: qView, byteOffset: p.at * 8, componentType: 5122, normalized: true, count: p.input.count, type: 'VEC4' });
    else json.accessors.push({ bufferView: vView, byteOffset: p.at * 12, componentType: 5126, count: p.input.count, type: 'VEC3' });
    p.anim.samplers.push({ input: inAcc, output: json.accessors.length - 1, interpolation: 'LINEAR' });
    p.anim.channels.push({ sampler: p.anim.samplers.length - 1, target: { node: p.node, path: p.path } });
  }
  if (animations.length) json.animations = animations;
  const binBuf = Buffer.concat(bin);
  json.buffers[0].byteLength = binBuf.length;
  json.buffers[1].byteLength = fallback;
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(pad4(jsonBuf.length) - jsonBuf.length, 0x20)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + jsonBuf.length + 8 + binBuf.length, 8);
  header.writeUInt32LE(jsonBuf.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(binBuf.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonBuf, bh, binBuf]);
}

/** Parse a GLB back and check what the game relies on: the nodes, the clips, every accessor readable. */
export function validate(bytes, model) {
  const { json, read } = readGlb(bytes);
  const names = new Set(json.nodes.map((n) => n.name));
  for (const need of ['head', 'saddle']) if (!names.has(need)) throw new Error(`${model.id}: no ${need} node`);
  // (Not the indices: they're in the triangle codec, which the tools' reader doesn't know; the preview page's does.)
  const indices = json.meshes[0].primitives[0].indices;
  json.accessors.forEach((a, i) => i !== indices && read(a));
  const clips = new Set((json.animations ?? []).map((a) => a.name));
  for (const need of ['idle', 'walk', 'run', 'attack', 'eat', 'sleep', 'roar']) if (!clips.has(need)) throw new Error(`${model.id}: no ${need} clip`);
}
