/**
 * The two-legged animals' designs: each from its fossils' proportions (a horizontal spine over the
 * hips, the tail a counterweight to the head and chest), in metres, in our own colours. See
 * `biped.mjs` for what a design holds.
 */
import { hash, cellKey, cellOf, smoothstep } from './sculpt.mjs';

const jit = (info, amount, salt = 1) => (hash(info.i, info.j, info.k, salt) - 0.5) * amount;

/** Countershading round a tube: belly below `lo`, back above `hi` (of -1..1), ragged where they meet. */
const shaded = (belly, flank, back, lo = -0.42, hi = 0.3, rag = 0.22) => (info) => {
  const v = info.v + jit(info, rag);
  return v < lo ? belly : v > hi ? back : flank;
};

/** A row of teeth under a part's lowest outer cells, every other voxel, from z0 to z1 (metres). */
function teeth(sc, part, z0, z1, { up = false, every = 2, colour = 'tooth', inset = 0 } = {}) {
  const cells = sc.vox.parts.get(part);
  const rows = new Map();
  for (const key of cells.keys()) {
    const [i, j, k] = cellOf(key);
    if (i < 0 || (k + 0.5) / sc.vpm < z0 || (k + 0.5) / sc.vpm > z1) continue;
    const r = rows.get(k);
    if (!r || (up ? j > r.j : j < r.j) || (j === r.j && i > r.i)) rows.set(k, { i, j });
  }
  for (const [k, { i, j }] of rows) {
    if (((k % every) + every) % every) continue;
    for (const ii of [i - inset, -1 - (i - inset)]) sc.vox.set(part, ii, j + (up ? 1 : -1), k, colour);
  }
}

/** The outermost filled cell of a part at a height and a place along (metres): its i. */
function surface(sc, part, y, z) {
  const j = Math.floor(y * sc.vpm), k = Math.floor(z * sc.vpm);
  for (let i = 80; i >= 0; i--) if (sc.vox.get(part, i, j, k)) return [i, j, k];
  return null;
}
/** An eye on each side of the head: `cells` are [dz, dy, colour] from the eye's own cell. */
function eyes(sc, part, y, z, cells = [[0, 0, 'eye']]) {
  const at = surface(sc, part, y, z);
  if (!at) throw new Error(`no surface for an eye at ${y}, ${z}`);
  for (const [dz, dy, colour] of cells) {
    let i = at[0];
    while (i > 0 && !sc.vox.get(part, i, at[1] + dy, at[2] + dz)) i--;
    for (const ii of [i, -1 - i]) sc.vox.set(part, ii, at[1] + dy, at[2] + dz, colour);
  }
}
/** The inside of the mouth: the top layer of the lower jaw, in from its rim. */
function tongue(sc, part = 'jaw', colour = 'mouth') {
  const cells = sc.vox.parts.get(part);
  for (const key of [...cells.keys()]) {
    const [i, j, k] = cellOf(key);
    if (cells.has(cellKey(i, j + 1, k))) continue;
    if (cells.has(cellKey(i + 1, j, k)) && cells.has(cellKey(i - 1, j, k)) && cells.has(cellKey(i, j, k + 1))) cells.set(key, colour);
  }
}

/**
 * A theropod's leg from its hip's height: the knee forward, the ankle back, the ball of the foot
 * under the hip, three toes. `bulk` thickens it, `o` overrides.
 */
function legOf(h, x, bulk = 1, o = {}) {
  const b = bulk * h;
  return {
    x,
    hip: [h, 0],
    knee: [0.6 * h, 0.25 * h],
    ankle: [0.345 * h, -0.15 * h],
    ball: [0.056 * h, 0.077 * h],
    thigh: [[0.126 * b, 0.245 * b], [0.095 * b, 0.126 * b]],
    shin: [[0.09 * b, 0.14 * b], [0.06 * b, 0.07 * b]],
    meta: [[0.06 * b, 0.07 * b], [0.063 * b, 0.06 * b]],
    toes: { length: 0.33 * h, radius: 0.056 * b, spread: 26, claw: 0.22 },
    colour: legSkin('flank', 'back', 'belly'),
    ...o,
  };
}
/** A leg's colours: the thigh's front darker like the back, the shin's back pale, the foot mottled. */
const legSkin = (flank, back, belly, foot = flank) => (bone, info) => {
  if (bone === 'thigh') return info.v + jit(info, 0.3) > 0.55 && info.s < 0.9 * info.len ? back : flank;
  if (bone === 'shin') return info.v + jit(info, 0.3) < -0.5 ? belly : flank;
  return hash(info.i, info.j, info.k, 5) < 0.18 ? back : foot;
};

/**
 * A skull and lower jaw lofted along z from `z0` (the back) to `z1` (the snout's tip): `top` the
 * skull's height at the back, a quarter, 0.6 and the tip; `w` its half-width there; the jawline
 * from `line` to `lineTip`; the jaw `d` deep at the back and the tip. Teeth, a tongue, eyes and
 * nostrils unless told not to.
 */
function skull(sc, o) {
  const at = (f) => o.z0 + (o.z1 - o.z0) * f;
  const line = (f) => o.line + (o.lineTip - o.line) * f;
  const F = [0, 0.25, 0.6, 1];
  sc.loft('head', F.map((f, n) => ({ z: at(f), y: [line(f) - (n === 0 ? o.back ?? 0.5 * o.d[0] : 0), o.top[n]], w: o.w[n] })), o.skin, { power: o.power ?? 3 });
  const jw = o.jawW ?? 0.88;
  const j0 = o.jawFrom ?? 0.08;
  sc.loft('jaw', [
    { z: at(j0), y: [line(j0) - o.d[0], line(j0) + 0.02 * o.d[0]], w: o.w[0] * jw },
    { z: at(0.4), y: [line(0.4) - o.d[0] * 0.95, line(0.4) + 0.02 * o.d[0]], w: o.w[1] * jw * 0.92 },
    { z: at(0.8), y: [line(0.8) - (o.d[0] + o.d[1]) / 2, line(0.8) + 0.02 * o.d[0]], w: o.w[2] * jw },
    { z: at(o.jawTo ?? 0.97), y: [line(1) - o.d[1], line(1) + 0.02 * o.d[0]], w: o.w[3] * jw * 0.95 },
  ], o.jawSkin, { power: o.power ?? 3 });
  tongue(sc);
  if (o.teeth !== false) {
    teeth(sc, 'head', at(o.teethFrom ?? 0.42), at(1), { every: o.every ?? 2 });
    teeth(sc, 'jaw', at((o.teethFrom ?? 0.42) + 0.03), at(0.95), { up: true, inset: 1, every: o.every ?? 2 });
  }
  if (o.eye) eyes(sc, 'head', o.eye[0], o.eye[1], o.eyeCells ?? [[0, 0, 'eye'], [-1, 0, 'pupil']]);
  if (o.nostril) eyes(sc, 'head', o.nostril[0], o.nostril[1], [[0, 0, 'pupil']]);
  return [0, line(j0) , at(j0) + 0.02 * (o.z1 - o.z0)];
}

/** An arm in a plane beside the chest: shoulder, elbow, wrist ([y, z]), and claws at the hand. */
function arm(sc, part, x, sh, el, wr, r, colour, { claws = 2, clawLen = 1.6, claw = 'claw' } = {}) {
  sc.tube(part, [{ p: [x, ...sh], r: [r, r * 1.2] }, { p: [x, ...el], r: [r * 0.85, r] }], colour, { capShrink: 0, power: 2 });
  sc.tube(part, [{ p: [x, ...el], r: [r * 0.8, r * 0.9] }, { p: [x, ...wr], r: [r * 0.7, r * 0.8] }], colour, { power: 2 });
  const dy = wr[0] - el[0], dz = wr[1] - el[1], l = Math.hypot(dy, dz) || 1;
  for (let c = 0; c < claws; c++) {
    const off = claws === 1 ? 0 : (c / (claws - 1) - 0.5) * r * 1.5;
    sc.capsule(part, [x + off, wr[0], wr[1]], [x + off * 1.3, wr[0] + (dy / l) * r * clawLen - r * 0.5 * clawLen, wr[1] + (dz / l) * r * clawLen], r * 0.5, r * 0.25, claw);
  }
}

/** Tufts along the top of the back: single voxels standing on the highest cell of the middle rows. */
function tufts(sc, parts, z0, z1, chance, colour, { rows = [0], salt = 9, tall = 1 } = {}) {
  for (const part of parts) {
    const cells = sc.vox.parts.get(part);
    const top = new Map();
    for (const key of cells.keys()) {
      const [i, j, k] = cellOf(key);
      if (!rows.includes(i) && !rows.includes(-1 - i)) continue;
      const z = (k + 0.5) / sc.vpm;
      if (z < z0 || z > z1) continue;
      const id = `${i},${k}`;
      if (!top.has(id) || top.get(id)[1] < j) top.set(id, [i, j, k]);
    }
    for (const [i, j, k] of top.values()) {
      const h = hash(i < 0 ? -1 - i : i, 0, k, salt);
      if (h > chance) continue;
      for (let n = 1; n <= (h < chance * 0.4 ? tall : 1); n++) sc.vox.set(part, i, j + n, k, colour);
    }
  }
}

// ---------------------------------------------------------------------------------------------

const tyrannosaurus = {
  id: 'tyrannosaurus',
  name: 'Tyrannosaurus',
  vpm: 12, texels: 1,
  colours: { back: 0x4f4534, band: 0x362f25, flank: 0x86704a, belly: 0xd6c59c, rust: 0x9a4a2c, claw: 0x24201c, tooth: 0xf2ead2, mouth: 0x8a3038, eye: 0xf0b030, pupil: 0x141210 },
  spine: [
    [-6.58, 2.5, 0.05, 0.06],
    [-5.6, 2.6, 0.12, 0.15, 'tail4'],
    [-4.4, 2.72, 0.2, 0.25, 'tail3'],
    [-3.2, 2.84, 0.3, 0.37, 'tail2'],
    [-2.1, 2.93, 0.42, 0.52],
    [-1.1, 3.0, 0.55, 0.68, 'tail1'],
    [0, 3.02, 0.68, 0.82],
    [1.0, 2.94, 0.78, 0.95, 'chest'],
    [2.0, 2.9, 0.8, 1.0],
    [2.9, 3.05, 0.66, 0.86, 'neck'],
    [3.45, 3.4, 0.56, 0.7],
    [3.9, 3.72, 0.47, 0.56, 'head'],
  ],
  skin(info) {
    const base = shaded('belly', 'flank', 'back')(info);
    // Dark bands over the back, broken and uneven, fading out down the flanks.
    const band = Math.sin(info.s * 5.2 + Math.sin(info.s * 1.7) * 1.2) + jit(info, 0.5, 2);
    if (base !== 'belly' && info.v > 0.05 && band > 0.55 + (1 - info.v) * 0.5) return 'band';
    return base;
  },
  leg: {
    x: 0.66,
    hip: [2.85, 0.0],
    knee: [1.72, 0.72],
    ankle: [0.98, -0.42],
    ball: [0.16, 0.22],
    thigh: [[0.36, 0.7], [0.27, 0.36]],
    shin: [[0.26, 0.4], [0.17, 0.2]],
    meta: [[0.17, 0.2], [0.18, 0.17]],
    toes: { length: 0.95, radius: 0.16, spread: 26, claw: 0.22 },
    colour(bone, info) {
      if (bone === 'thigh') return info.v + jit(info, 0.3) > 0.55 && info.s < 0.9 ? 'back' : 'flank';
      if (bone === 'shin') return info.v + jit(info, 0.3) < -0.5 ? 'belly' : 'flank';
      return hash(info.i, info.j, info.k, 5) < 0.18 ? 'back' : 'flank';
    },
  },
  arms(sc, part) {
    const x = 0.74;
    sc.tube(part, [{ p: [x, 2.3, 2.6], r: [0.1, 0.12] }, { p: [x, 1.98, 2.46], r: [0.085, 0.1] }], 'flank', { capShrink: 0 });
    sc.tube(part, [{ p: [x, 1.98, 2.46], r: [0.08, 0.09] }, { p: [x, 1.84, 2.76], r: [0.07, 0.08] }], 'flank');
    sc.capsule(part, [x - 0.05, 1.82, 2.8], [x - 0.06, 1.72, 2.9], 0.05, 0.03, 'claw');
    sc.capsule(part, [x + 0.05, 1.82, 2.8], [x + 0.06, 1.72, 2.9], 0.05, 0.03, 'claw');
  },
  head(sc) {
    const skin = (p, q) => (q.v + jit(q, 0.25) > 0.25 ? 'back' : 'flank');
    sc.loft('head', [
      { z: 3.55, y: [3.3, 4.08], w: 0.44 },
      { z: 4.15, y: [3.42, 4.25], w: 0.56 },
      { z: 4.7, y: [3.5, 4.18], w: 0.46 },
      { z: 5.4, y: [3.52, 4.06], w: 0.36 },
      { z: 5.92, y: [3.55, 3.92], w: 0.3 },
    ], skin, { power: 3.2 });
    // Brow ridges over the eyes, and a rough ridge down the snout.
    sc.ellipsoid('head', [0.44, 4.2, 4.3], [0.1, 0.09, 0.2], 'rust', { mirror: true });
    sc.box('head', [-0.08, 4.0, 4.8], [0.08, 4.2, 5.6], (p, i, j, k) => (p[1] < 4.19 - (p[2] - 4.8) * 0.2 && hash(i, j, k, 3) > 0.25 ? 'band' : undefined));
    sc.loft('jaw', [
      { z: 3.8, y: [2.9, 3.52], w: 0.48 },
      { z: 4.5, y: [2.9, 3.52], w: 0.45 },
      { z: 5.3, y: [3.06, 3.53], w: 0.32 },
      { z: 5.84, y: [3.22, 3.55], w: 0.26 },
    ], (p, q) => (q.v < -0.1 ? 'belly' : 'flank'), { power: 3.2 });
    tongue(sc);
    teeth(sc, 'head', 4.5, 5.9);
    teeth(sc, 'jaw', 4.55, 5.75, { up: true, inset: 1 });
    eyes(sc, 'head', 4.06, 4.36, [[0, 0, 'eye'], [-1, 0, 'pupil'], [0, 1, 'band'], [1, 1, 'band'], [-1, 1, 'band']]);
    eyes(sc, 'head', 3.84, 5.74, [[0, 0, 'pupil']]);
  },
  joints: { jaw: [0, 3.5, 3.9], armL: [0.74, 2.3, 2.6] },
  points: { mouth: [0, 3.35, 5.9], chin: [0, 2.9, 4.6], saddle: [0, 3.95, 1.2] },
  gait: { tailSway: 6, jaw: 38, armSwing: 4 },
};


// ---------------------------------------------------------------------------------------------

const utahraptor = {
  id: 'utahraptor',
  name: 'Utahraptor',
  vpm: 22,
  texels: 1,
  colours: { back: 0x45505a, band: 0x2c3238, flank: 0x7c7263, belly: 0xe4dbc4, rust: 0xa5542b, quill: 0x1f2226, tip: 0xece6d6, snout: 0x5b4b41, claw: 0x1c1a18, tooth: 0xf4eeda, mouth: 0x8a3038, eye: 0xf2c230, pupil: 0x121110 },
  spine: [
    [-3.38, 1.3, 0.025, 0.03],
    [-2.7, 1.31, 0.04, 0.05, 'tail4'],
    [-2.0, 1.33, 0.06, 0.075, 'tail3'],
    [-1.3, 1.35, 0.1, 0.12, 'tail2'],
    [-0.6, 1.37, 0.18, 0.22, 'tail1'],
    [0, 1.38, 0.26, 0.3],
    [0.55, 1.35, 0.3, 0.35, 'chest'],
    [1.0, 1.38, 0.27, 0.33],
    [1.35, 1.5, 0.19, 0.23, 'neck'],
    [1.58, 1.65, 0.14, 0.165],
    [1.76, 1.79, 0.115, 0.13, 'head'],
  ],
  skin(info) {
    const base = shaded('belly', 'flank', 'back', -0.4, 0.2, 0.5)(info);
    // Feathers: barred across the back and tail, flecked on the flanks.
    if (base === 'back' && Math.sin(info.s * 11) > 0.5 + jit(info, 0.6, 2)) return 'band';
    if (base === 'flank' && hash(info.i, info.j, info.k, 4) < 0.12) return 'back';
    return base;
  },
  leg: legOf(1.26, 0.23, 1.04, { colour: legSkin('flank', 'back', 'belly', 'snout') }),
  foot(sc, part, ball) {
    // The sickle claw, held up off the ground on the inner toe.
    sc.capsule(part, [ball[0] - 0.06, 0.1, ball[2] + 0.06], [ball[0] - 0.08, 0.26, ball[2] + 0.2], 0.05, 0.04, 'snout');
    sc.capsule(part, [ball[0] - 0.08, 0.27, ball[2] + 0.2], [ball[0] - 0.08, 0.1, ball[2] + 0.36], 0.045, 0.02, 'claw');
  },
  arms(sc, part) {
    const x = 0.34;
    arm(sc, part, x, [1.3, 0.92], [1.1, 0.68], [0.98, 1.0], 0.055, 'flank', { claws: 3, clawLen: 2 });
    // The wing: long feathers folded back along the body from the forearm, barred, pale-tipped.
    sc.fill(part, [x - 0.01, 0.8, 0.05], [x + 0.065, 1.36, 1.02], (p, i, j, k) => {
      const f = (1.02 - p[2]) / 0.95;
      if (f < 0 || f > 1) return;
      const top = 1.33 - f * 0.2, deep = 0.1 + 0.3 * Math.sin(Math.min(1, f * 1.5) * Math.PI * 0.5) * (1 - f * 0.55);
      const bottom = top - deep + (hash(0, 0, k, 7) - 0.5) * 0.07;
      if (p[1] > top || p[1] < bottom) return;
      const t = (top - p[1]) / (top - bottom);
      return t > 0.84 ? 'tip' : t > 0.6 ? 'quill' : t > 0.3 && Math.sin(p[2] * 34) > 0.2 ? 'rust' : 'back';
    });
  },
  head(sc) {
    const jaw = skull(sc, {
      z0: 1.66, z1: 2.62, line: 1.72, lineTip: 1.74, top: [1.86, 1.9, 1.86, 1.8], w: [0.115, 0.135, 0.1, 0.065], d: [0.1, 0.05],
      skin: (p, q) => (q.f > 0.55 ? (q.v > 0.3 ? 'band' : 'snout') : q.v + jit(q, 0.3) > 0.2 ? 'back' : 'flank'),
      jawSkin: (p, q) => (q.f > 0.5 ? 'snout' : 'belly'),
      eye: [1.84, 2.0], nostril: [1.8, 2.52],
    });
    this.joints.jaw = jaw;
    // A crest of feathers down the back of the head and neck.
    tufts(sc, ['head'], 1.66, 2.02, 0.75, 'rust', { rows: [0] });
  },
  extras(sc) {
    tufts(sc, ['neck', 'chest'], 1.0, 1.8, 0.6, 'band', { tall: 2 });
    tufts(sc, ['hips', 'tail1', 'tail2'], -1.4, 1.0, 0.35, 'band');
    // The tail's fan: a vane of feathers either side of its last third.
    for (const [part, z0, z1] of [['tail4', -3.5, -2.7], ['tail3', -2.7, -2.25]]) {
      sc.fill(part, [-0.24, 1.29, z0], [0.24, 1.34, z1], (p, i, j, k) => {
        const f = (-2.25 - p[2]) / 1.2;
        const w = 0.05 + 0.17 * Math.sin(Math.min(1, f) * Math.PI * 0.62) + (hash(0, 0, k, 3) - 0.5) * 0.05;
        if (f < 0 || Math.abs(p[0]) > w || p[2] < -3.46) return;
        return p[2] < -3.3 ? 'tip' : Math.abs(p[0]) > w - 0.05 ? 'quill' : Math.sin(p[2] * 26) > 0.2 ? 'rust' : 'back';
      });
    }
  },
  joints: { jaw: null, armL: [0.32, 1.3, 0.92] },
  points: { mouth: [0, 1.72, 2.62], chin: [0, 1.62, 2.1], saddle: [0, 1.66, 0.45] },
  gait: { tailSway: 5, jaw: 36, armSwing: 5, neckBob: 5, run: { lean: 8, neck: 10, head: -8 } },
};

const carnotaurus = {
  id: 'carnotaurus',
  name: 'Carnotaurus',
  vpm: 16,
  texels: 1,
  colours: { back: 0x8a3f2a, blotch: 0x4e2219, flank: 0xb0623a, belly: 0xe3c79a, stud: 0xd9a070, horn: 0x2b211c, claw: 0x231c18, tooth: 0xf3ecd6, mouth: 0x7c2a30, eye: 0xe8d040, pupil: 0x111010 },
  spine: [
    [-4.33, 2.05, 0.035, 0.045],
    [-3.5, 2.12, 0.08, 0.1, 'tail4'],
    [-2.7, 2.2, 0.13, 0.17, 'tail3'],
    [-1.9, 2.27, 0.2, 0.25, 'tail2'],
    [-0.9, 2.33, 0.31, 0.38, 'tail1'],
    [0, 2.36, 0.4, 0.47],
    [0.8, 2.32, 0.45, 0.55, 'chest'],
    [1.5, 2.3, 0.44, 0.56],
    [2.1, 2.42, 0.36, 0.45, 'neck'],
    [2.52, 2.6, 0.31, 0.37],
    [2.82, 2.76, 0.28, 0.32, 'head'],
  ],
  skin(info) {
    const base = shaded('belly', 'flank', 'back', -0.42, 0.25, 0.25)(info);
    if (base === 'belly') return base;
    // Dark blotches over the back, and rows of pale studs (its skin's bony bumps) along the sides.
    const blotch = Math.sin(info.s * 4.1 + info.v * 2.2) * Math.sin(info.s * 1.7 - info.v * 3.1) + jit(info, 0.3, 2);
    if (info.v > -0.1 && blotch > 0.42) return 'blotch';
    const row = Math.abs(((info.v + 1) * 3.2) % 1 - 0.5) < 0.12;
    if (row && hash(info.i, info.j, info.k, 6) < 0.3) return 'stud';
    return base;
  },
  leg: legOf(2.22, 0.42, 0.82, { colour: legSkin('flank', 'back', 'belly') }),
  arms(sc, part) {
    // All but gone: a stub held back against the chest, the hand a nub.
    sc.capsule(part, [0.5, 1.98, 1.78], [0.53, 1.8, 1.52], 0.085, 0.06, 'flank');
    sc.capsule(part, [0.53, 1.8, 1.52], [0.54, 1.74, 1.44], 0.05, 0.035, 'claw');
  },
  head(sc) {
    this.joints.jaw = skull(sc, {
      z0: 2.66, z1: 3.64, line: 2.66, lineTip: 2.7, top: [2.93, 2.99, 2.95, 2.84], w: [0.27, 0.31, 0.25, 0.18], d: [0.2, 0.1], power: 3.4,
      skin: (p, q) => (q.v + jit(q, 0.3) > 0.1 ? 'back' : 'flank'),
      jawSkin: (p, q) => (q.v < 0 ? 'belly' : 'flank'),
      eye: [2.9, 3.0], nostril: [2.82, 3.54], eyeCells: [[0, 0, 'eye'], [-1, 0, 'pupil'], [0, 1, 'blotch'], [-1, 1, 'blotch']],
    });
    // The horns: thick, short, out and up over the eyes.
    sc.capsule('head', [0.2, 2.98, 2.92], [0.47, 3.12, 2.95], 0.1, 0.045, (p, t) => (t > 0.35 ? 'horn' : 'back'), { mirror: true });
    tufts(sc, ['head'], 3.05, 3.5, 0.5, 'blotch', { rows: [0, 1] });
  },
  joints: { jaw: null, armL: [0.5, 1.98, 1.78] },
  points: { mouth: [0, 2.66, 3.64], chin: [0, 2.46, 3.1], saddle: [0, 2.86, 0.7] },
  gait: { tailSway: 6, jaw: 40, armSwing: 2 },
};

const dilophosaurus = {
  id: 'dilophosaurus',
  name: 'Dilophosaurus',
  vpm: 22,
  texels: 1,
  colours: { back: 0x4d5f33, stripe: 0xc9b85a, flank: 0x76864a, belly: 0xe6dfb2, crest: 0xd8632a, rim: 0xf0d9a0, throat: 0xc7523a, claw: 0x22201a, tooth: 0xf4eeda, mouth: 0x8a3038, eye: 0xf4e2a0, pupil: 0x111010 },
  spine: [
    [-3.28, 1.3, 0.025, 0.03],
    [-2.6, 1.34, 0.045, 0.06, 'tail4'],
    [-1.95, 1.38, 0.075, 0.1, 'tail3'],
    [-1.3, 1.42, 0.11, 0.145, 'tail2'],
    [-0.6, 1.46, 0.17, 0.21, 'tail1'],
    [0, 1.48, 0.22, 0.27],
    [0.6, 1.46, 0.24, 0.3, 'chest'],
    [1.05, 1.5, 0.21, 0.26],
    [1.4, 1.62, 0.15, 0.18, 'neck'],
    [1.64, 1.79, 0.115, 0.135, 'neck2'],
    [1.84, 1.94, 0.1, 0.115, 'head'],
  ],
  skin(info) {
    const base = shaded('belly', 'flank', 'back', -0.45, 0.35, 0.2)(info);
    if (base === 'belly') return base;
    // A pale stripe along each side under the back, and rings round the tail.
    if (Math.abs(info.v - 0.3) < 0.1 && info.f > 0.3) return 'stripe';
    if (info.f < 0.36 && Math.sin(info.s * 9) > 0.55) return 'stripe';
    if (base === 'flank' && hash(info.i, info.j, info.k, 4) < 0.1) return 'back';
    return base;
  },
  leg: legOf(1.36, 0.19, 0.84, { colour: legSkin('flank', 'back', 'belly') }),
  arms(sc, part) {
    arm(sc, part, 0.26, [1.3, 0.98], [1.07, 0.84], [0.96, 1.1], 0.05, 'flank', { claws: 3, clawLen: 1.8 });
  },
  head(sc) {
    this.joints.jaw = skull(sc, {
      z0: 1.74, z1: 2.72, line: 1.87, lineTip: 1.9, top: [2.0, 2.03, 1.99, 1.95], w: [0.1, 0.118, 0.088, 0.058], d: [0.09, 0.045],
      skin: (p, q) => (q.v + jit(q, 0.3) > 0.2 ? 'back' : 'flank'),
      jawSkin: (p, q) => (q.f < 0.45 ? 'throat' : 'belly'),
      eye: [1.97, 2.06], nostril: [1.95, 2.62],
    });
    // The notch behind the snout's tip.
    const V = 1 / sc.vpm;
    sc.box('head', [-0.2, 1.86, 2.5], [0.2, 1.9 + V * 0.6, 2.5 + V * 2], () => false);
    // The twin crests: two thin arched plates side by side along the top of the skull.
    for (const x of [0.06, -0.06 - V]) {
      sc.fill('head', [x, 1.98, 1.92], [x + V * 0.9, 2.22, 2.56], (p) => {
        const f = (p[2] - 1.92) / 0.64;
        if (f < 0 || f > 1) return;
        const top = 2.0 + 0.2 * Math.sin(Math.PI * Math.min(1, f * 1.15)) ** 0.7;
        if (p[1] > top) return;
        return p[1] > top - V * 0.9 ? 'rim' : 'crest';
      });
    }
  },
  joints: { jaw: null, armL: [0.26, 1.3, 0.98] },
  points: { mouth: [0, 1.88, 2.72], chin: [0, 1.77, 2.2], saddle: [0, 1.78, 0.45] },
  gait: { tailSway: 7, jaw: 34, neckBob: 5, armSwing: 6 },
};

const spinosaurus = {
  id: 'spinosaurus',
  name: 'Spinosaurus',
  vpm: 11,
  texels: 1,
  colours: { back: 0x47606a, band: 0x2c3c44, flank: 0x6f8a8a, belly: 0xe2dcc0, sail: 0xc8562c, sailLow: 0x8a6a4a, spot: 0x2a2f33, rim: 0xe8c070, claw: 0x1f1c1a, tooth: 0xf3ecd6, mouth: 0x7c2a30, eye: 0xf0b040, pupil: 0x111010 },
  spine: [
    [-7.2, 1.95, 0.05, 0.22],
    [-6.2, 2.02, 0.08, 0.38, 'tail4'],
    [-5.0, 2.15, 0.14, 0.5, 'tail3'],
    [-3.7, 2.3, 0.22, 0.56, 'tail2'],
    [-2.4, 2.42, 0.34, 0.6],
    [-1.3, 2.52, 0.48, 0.66, 'tail1'],
    [0, 2.58, 0.62, 0.76],
    [1.3, 2.52, 0.7, 0.86, 'chest'],
    [2.5, 2.5, 0.68, 0.84],
    [3.4, 2.7, 0.5, 0.62, 'neck'],
    [4.1, 3.05, 0.36, 0.42, 'neck2'],
    [4.7, 3.4, 0.3, 0.34, 'head'],
  ],
  skin(info) {
    const base = shaded('belly', 'flank', 'back', -0.4, 0.3, 0.22)(info);
    if (base === 'belly') return base;
    // Broad dark bands down the tail and back, like a crocodile's.
    if (info.v > -0.2 && Math.sin(info.s * 2.9 + 0.6) > 0.62 + jit(info, 0.4, 2) && info.f < 0.75) return 'band';
    return base;
  },
  leg: legOf(2.3, 0.62, 1.08, { colour: legSkin('flank', 'back', 'belly'), toes: { length: 0.9, radius: 0.15, spread: 30, claw: 0.2 } }),
  arms(sc, part) {
    arm(sc, part, 0.8, [2.05, 2.9], [1.5, 2.6], [1.22, 3.15], 0.15, 'flank', { claws: 3, clawLen: 2.2 });
  },
  head(sc) {
    this.joints.jaw = skull(sc, {
      z0: 4.46, z1: 6.66, line: 3.27, lineTip: 3.2, top: [3.6, 3.68, 3.5, 3.38], w: [0.28, 0.31, 0.18, 0.17], d: [0.22, 0.1], jawW: 0.82,
      skin: (p, q) => (q.v + jit(q, 0.3) > 0.1 ? 'back' : 'flank'),
      jawSkin: (p, q) => (q.v < 0.1 ? 'belly' : 'flank'),
      eye: [3.55, 4.95], nostril: [3.5, 5.75], every: 2, teethFrom: 0.36,
    });
    // A low crest before the eyes.
    sc.capsule('head', [0, 3.68, 5.05], [0, 3.6, 5.5], 0.1, 0.05, 'band');
  },
  extras(sc) {
    // The sail: tall spines under skin over the back, highest over the hips, in three pieces
    // that ride on the bones under them.
    const V = 1 / sc.vpm;
    for (const [part, z0, z1] of [['tail1', -2.3, -1.3], ['hips', -1.3, 1.3], ['chest', 1.3, 3.4], ['neck', 3.4, 3.7]]) {
      sc.fill(part, [-V, 2.9, z0], [V, 5.3, z1], (p, i, j, k) => {
        const f = (p[2] + 2.3) / 6.0;
        if (f < 0 || f > 1 || p[2] < z0 || p[2] >= z1) return;
        const top = 3.15 + 2.03 * Math.sin(Math.PI * f) ** 0.62 * (1 - 0.1 * Math.sin(f * 40) ** 2);
        if (p[1] > top || p[1] < 3.0) return;
        const h = (p[1] - 3.2) / (top - 3.2);
        if (p[1] > top - V * 1.5) return 'rim';
        if (h < 0.22 + jit({ i, j, k }, 0.2)) return 'back';
        // The spines show as dark bars; between them the skin runs from dull to bright.
        if (Math.abs(((p[2] * 2.2) % 1 + 1) % 1 - 0.5) < 0.1) return 'spot';
        return h > 0.5 + jit({ i, j, k }, 0.25) ? 'sail' : 'sailLow';
      });
    }
  },
  joints: { jaw: null, armL: [0.8, 2.05, 2.9] },
  points: { mouth: [0, 3.2, 6.66], chin: [0, 3.02, 5.4], saddle: [0, 3.2, 2.2] },
  gait: { tailSway: 8, jaw: 30, armSwing: 5, bow: { hips: 24, neck: 60, crouch: 0.2 } },
};

const parasaurolophus = {
  id: 'parasaurolophus',
  name: 'Parasaurolophus',
  vpm: 13,
  texels: 1,
  colours: { back: 0x5b6b3c, band: 0x39452a, flank: 0x9a9458, belly: 0xe7dfb4, crest: 0xb8402c, crestTip: 0xe9c56a, bill: 0x4a4335, hoof: 0x2a2620, claw: 0x2a2620, mouth: 0x8a4a48, eye: 0x241a12, pupil: 0x100e0c },
  spine: [
    [-4.98, 2.35, 0.05, 0.09],
    [-4.1, 2.45, 0.1, 0.2, 'tail4'],
    [-3.1, 2.56, 0.17, 0.32, 'tail3'],
    [-2.1, 2.66, 0.26, 0.44, 'tail2'],
    [-1.0, 2.72, 0.38, 0.56, 'tail1'],
    [0, 2.72, 0.52, 0.68],
    [1.0, 2.6, 0.6, 0.76, 'chest'],
    [1.9, 2.5, 0.56, 0.7],
    [2.6, 2.56, 0.36, 0.44, 'neck'],
    [3.08, 2.82, 0.25, 0.29, 'neck2'],
    [3.38, 3.1, 0.21, 0.23, 'head'],
  ],
  skin(info) {
    const base = shaded('belly', 'flank', 'back', -0.38, 0.4, 0.2)(info);
    if (base === 'belly') return base;
    // Dark saddles over the back that taper down the flanks.
    const wave = Math.sin(info.s * 3.3);
    if (wave > 0.35 && info.v > 0.75 - (wave - 0.35) * 1.5 + jit(info, 0.2, 2)) return 'band';
    return base;
  },
  leg: legOf(2.45, 0.5, 1.05, { colour: legSkin('flank', 'back', 'belly'), toes: { length: 0.6, radius: 0.17, spread: 30, claw: 0.3 } }),
  claw: 'hoof',
  arms(sc, part) {
    arm(sc, part, 0.58, [2.05, 2.1], [1.32, 1.95], [0.6, 2.25], 0.12, (info) => (info.v < -0.4 ? 'belly' : 'flank'), { claws: 2, clawLen: 1, claw: 'hoof' });
  },
  head(sc) {
    // A long, low skull ending in a broad flat bill; no teeth show.
    sc.loft('head', [
      { z: 3.2, y: [2.96, 3.34], w: 0.2 },
      { z: 3.6, y: [3.0, 3.36], w: 0.2 },
      { z: 4.05, y: [3.0, 3.24], w: 0.14 },
      { z: 4.3, y: [2.99, 3.14], w: 0.16 },
      { z: 4.46, y: [3.0, 3.1], w: 0.17 },
    ], (p, q) => (q.f > 0.78 ? 'bill' : q.v + jit(q, 0.3) > 0.2 ? 'back' : 'flank'), { power: 3 });
    sc.loft('jaw', [
      { z: 3.3, y: [2.82, 3.0], w: 0.17 },
      { z: 3.9, y: [2.86, 3.0], w: 0.13 },
      { z: 4.4, y: [2.92, 3.0], w: 0.14 },
    ], (p, q) => (q.f > 0.8 ? 'bill' : 'belly'), { power: 3 });
    tongue(sc);
    eyes(sc, 'head', 3.22, 3.62, [[0, 0, 'eye'], [-1, 0, 'eye']]);
    eyes(sc, 'head', 3.12, 4.2, [[0, 0, 'pupil']]);
    // The crest: a long hollow tube sweeping up and back from the snout over the neck.
    sc.tube('head', [
      { p: [0, 3.24, 3.9], r: [0.12, 0.11] },
      { p: [0, 3.4, 3.5], r: [0.13, 0.14] },
      { p: [0, 3.52, 3.05], r: [0.12, 0.13] },
      { p: [0, 3.62, 2.6], r: [0.1, 0.11] },
      { p: [0, 3.7, 2.2], r: [0.075, 0.085] },
    ], (info) => (info.s > 1.45 ? 'crestTip' : info.v < -0.35 ? 'band' : 'crest'), { power: 2.4 });
  },
  joints: { jaw: [0, 3.0, 3.34], armL: [0.58, 2.05, 2.1] },
  points: { mouth: [0, 3.0, 4.46], chin: [0, 2.84, 3.8], saddle: [0, 3.42, 0.6] },
  gait: { tailSway: 5, jaw: 16, armSwing: 14, neckBob: 4, rear: 10, roarNeck: 15, bow: { hips: 24, neck: 50, crouch: 0.12 } },
};

const compsognathus = {
  id: 'compsognathus',
  name: 'Compsognathus',
  vpm: 64,
  colours: { back: 0x5f6b2e, band: 0x333a1c, flank: 0xa3a84e, belly: 0xefe7b6, claw: 0x26221a, tooth: 0xf4eeda, mouth: 0x8a3038, eye: 0xf08a20, pupil: 0x111010 },
  spine: [
    [-0.68, 0.266, 0.009, 0.009],
    [-0.52, 0.272, 0.012, 0.013, 'tail4'],
    [-0.37, 0.278, 0.016, 0.018, 'tail3'],
    [-0.23, 0.284, 0.022, 0.026, 'tail2'],
    [-0.1, 0.29, 0.031, 0.037, 'tail1'],
    [0, 0.292, 0.04, 0.047],
    [0.09, 0.29, 0.043, 0.052, 'chest'],
    [0.16, 0.3, 0.038, 0.045],
    [0.21, 0.335, 0.027, 0.03, 'neck'],
    [0.243, 0.383, 0.02, 0.022, 'neck2'],
    [0.268, 0.428, 0.019, 0.02, 'head'],
  ],
  skin(info) {
    const base = shaded('belly', 'flank', 'back', -0.35, 0.45, 0.3)(info);
    if (base === 'belly') return base;
    // A dark line down the spine, bars on the tail, speckles on the sides.
    if (info.v > 0.82) return 'band';
    if (info.f < 0.45 && Math.sin(info.s * 70) > 0.5) return 'band';
    if (hash(info.i, info.j, info.k, 4) < 0.1) return 'band';
    return base;
  },
  leg: legOf(0.272, 0.04, 0.9, { colour: legSkin('flank', 'back', 'belly') }),
  arms(sc, part) {
    arm(sc, part, 0.052, [0.265, 0.165], [0.225, 0.14], [0.205, 0.185], 0.011, 'flank', { claws: 2, clawLen: 1.6 });
  },
  head(sc) {
    this.joints.jaw = skull(sc, {
      z0: 0.25, z1: 0.42, line: 0.424, lineTip: 0.43, top: [0.458, 0.468, 0.456, 0.444], w: [0.021, 0.025, 0.018, 0.012], d: [0.018, 0.01], teeth: false,
      skin: (p, q) => (q.v + jit(q, 0.3) > 0.2 ? 'back' : 'flank'),
      jawSkin: () => 'belly',
      eye: [0.447, 0.305], eyeCells: [[0, 0, 'eye'], [-1, 0, 'pupil']],
    });
  },
  joints: { jaw: null, armL: [0.05, 0.265, 0.165] },
  points: { mouth: [0, 0.424, 0.42], chin: [0, 0.405, 0.33], saddle: [0, 0.345, 0.05] },
  gait: { cycle: 1.5, walkCycles: 4, runCycles: 2, tailSway: 9, jaw: 30, neckBob: 7, armSwing: 8, idleSeconds: 3 },
};

const dodo = {
  id: 'dodo',
  name: 'Dodo',
  vpm: 44,
  colours: { back: 0x5f5b58, flank: 0x7d766e, belly: 0xa79f92, face: 0xcfc7b2, beak: 0xd9cc92, hook: 0x57523c, leg: 0xd9a23c, claw: 0x4a3a20, plume: 0xece7d6, wing: 0xddd5b8, mouth: 0x9a4a48, eye: 0xf2e6b0, pupil: 0x141210 },
  power: 2.1,
  spine: [
    [-0.34, 0.5, 0.035, 0.035],
    [-0.28, 0.48, 0.075, 0.085, 'tail1'],
    [-0.15, 0.44, 0.15, 0.165],
    [0, 0.42, 0.18, 0.195],
    [0.12, 0.42, 0.17, 0.185, 'chest'],
    [0.22, 0.47, 0.13, 0.14],
    [0.28, 0.56, 0.088, 0.092, 'neck'],
    [0.31, 0.66, 0.072, 0.074],
    [0.33, 0.74, 0.066, 0.066, 'head'],
  ],
  neckCap: 0.04,
  skin(info) {
    const v = info.v + jit(info, 0.35);
    // Soft grey-brown, paler underneath and on the breast, flecked like loose feathers.
    if (v < -0.3) return 'belly';
    if (v > 0.35) return hash(info.i, info.j, info.k, 3) < 0.2 ? 'flank' : 'back';
    return hash(info.i, info.j, info.k, 4) < 0.14 ? 'back' : 'flank';
  },
  leg: {
    x: 0.085,
    hip: [0.4, -0.02],
    knee: [0.29, 0.065],
    ankle: [0.155, -0.03],
    ball: [0.028, 0.025],
    thigh: [[0.055, 0.075], [0.045, 0.05]],
    shin: [[0.045, 0.052], [0.022, 0.025]],
    meta: [[0.022, 0.025], [0.024, 0.022]],
    toes: { length: 0.105, radius: 0.02, pad: 0.03, fan: [[-32, 0.85], [0, 1], [32, 0.85], [180, 0.4]], claw: 0.2 },
    colour: (bone, info) => (bone === 'thigh' ? 'flank' : bone === 'shin' && info.s < 0.06 ? 'flank' : 'leg'),
  },
  arms(sc, part) {
    // Small useless wings against the sides, their tips pale.
    sc.ellipsoid(part, [0.165, 0.46, 0.05], [0.04, 0.085, 0.13], (p, i, j, k) => (p[2] < -0.02 + (hash(i, j, 0, 2) - 0.5) * 0.04 ? 'wing' : hash(i, j, k, 5) < 0.2 ? 'flank' : 'back'));
  },
  head(sc) {
    sc.ellipsoid('head', [0, 0.795, 0.365], [0.078, 0.082, 0.095], (p, i, j, k) => (p[2] > 0.385 && p[1] < 0.84 ? 'face' : hash(i, j, k, 3) < 0.2 ? 'flank' : 'back'));
    // The beak: long and deep, bare, ending in a dark swollen hook that turns down over the tip.
    sc.loft('head', [
      { z: 0.42, y: [0.745, 0.835], w: 0.05 },
      { z: 0.5, y: [0.745, 0.812], w: 0.04 },
      { z: 0.59, y: [0.745, 0.806], w: 0.036 },
    ], (p, q) => (q.f < 0.2 ? 'face' : q.f > 0.62 + q.v * 0.12 ? 'hook' : 'beak'), { power: 2.6 });
    sc.ellipsoid('head', [0, 0.768, 0.592], [0.037, 0.045, 0.04], 'hook');
    sc.ellipsoid('head', [0, 0.728, 0.618], [0.022, 0.03, 0.022], 'hook');
    sc.loft('jaw', [
      { z: 0.4, y: [0.7, 0.748], w: 0.04 },
      { z: 0.5, y: [0.71, 0.748], w: 0.028 },
      { z: 0.585, y: [0.722, 0.748], w: 0.02 },
    ], (p, q) => (q.f > 0.7 ? 'hook' : 'beak'), { power: 2.6 });
    tongue(sc);
    eyes(sc, 'head', 0.805, 0.4, [[0, 0, 'pupil'], [0, 1, 'eye'], [-1, 0, 'eye'], [1, 0, 'eye'], [0, -1, 'eye']]);
    eyes(sc, 'head', 0.785, 0.53, [[0, 0, 'hook']]);
  },
  extras(sc) {
    // A tuft of loose curled plumes for a tail.
    for (const [c, r] of [[[0, 0.56, -0.33], [0.075, 0.07, 0.07]], [[0.04, 0.6, -0.36], [0.05, 0.05, 0.05]], [[-0.045, 0.52, -0.37], [0.05, 0.05, 0.05]]]) {
      sc.ellipsoid('tail1', c, r, (p, i, j, k) => (hash(i, j, k, 8) < 0.22 ? undefined : hash(i, j, k, 9) < 0.25 ? 'wing' : 'plume'));
    }
  },
  joints: { jaw: [0, 0.745, 0.41], armL: [0.16, 0.52, 0.13] },
  points: { mouth: [0, 0.7, 0.63], chin: [0, 0.69, 0.48], saddle: [0, 0.63, 0] },
  gait: {
    cycle: 1.5, walkCycles: 4, runCycles: 3, tailSway: 10, jaw: 26, neckBob: 9, armSwing: 6, armFlap: 40, rear: 4, roarNeck: 10, roarSeconds: 1.2, idleSeconds: 3,
    walk: { rock: 3, twist: 2.4, step: 0.14 }, run: { rock: 4, twist: 3, lean: 8, arms: -20, duty: 0.4 },
    bow: { hips: 34, neck: 44, head: 6, crouch: 0.2 }, sleepNeck: 50, sleepCurl: 70, sleepK: 0.5, sleepLevel: 0.6,
  },
};

export const SPECIES = [tyrannosaurus, utahraptor, carnotaurus, dilophosaurus, spinosaurus, parasaurolophus, compsognathus, dodo];
