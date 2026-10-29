/**
 * Blockilization's resources as little voxel models, built in code: what a tile's resource is, seen
 * on the tile itself (each screen places them, `client/resources3d.ts`). Grazing beasts (cattle,
 * sheep, horses, deer, bison, an elephant for ivory, a fox for furs, a pig snuffling for truffles), crops
 * and trees (wheat, bananas, cotton, dyes, spices, mulberry and cocoons for silk, sugar cane, vines,
 * frankincense, citrus, cocoa), the ground's riches (boulders, ores in their rock, marble, salt, an
 * oil seep, bauxite, uranium glowing green), and the sea's (a school of fish, a whale's back, crabs
 * on a sandbar, oysters with their pearls). Each stands on its origin facing +z, a voxel a sixteenth
 * of a block (the screens scale them); the sea's have the water's surface at their origin.
 */
import { Model, P } from './shapes.mjs';

// ---------------------------------------------------------------------------------------------
// Colours

const COLOURS = {
  cowWhite: 0xf0ece4, cowBlack: 0x2c2a2a, cowBrown: 0x8a4e2a, muzzle: 0xe0a0a0, horn: 0xe8dcc0, wool: 0xf4f1e8, woolShade: 0xdcd6c8,
  sheepFace: 0x3a3430, chestnut: 0xa0603a, deer: 0xa86a3a, deerLight: 0xe0c8a0, antler: 0xd8c8a0,
  fox: 0xe0702a, foxWhite: 0xf4eee4, pig: 0xe8a4a0, pigDark: 0xc87a7a, soil: 0x5a3e26, truffle: 0x2e2420, elephantDark: 0x6e6c6a,
  fishBack: 0x23415e, fishSide: 0xa8bcc8, fishFin: 0x3a6688, whale: 0x3a4e62, whaleLight: 0x6a8094, crab: 0xe0482a, crabDark: 0xa83020,
  shell: 0x5a4a5e, nacre: 0xe8dcec, pearl: 0xfdfaf2, wheat: 0xd4b050, wheatHead: 0xecc664, leaf: 0x4aa83a, leafDark: 0x2e6e2e,
  leafOlive: 0x5e7e30, sage: 0x8a9a5a, bark: 0x6a4a2e, bananaTrunk: 0x8a9a4a, banana: 0xf6d83a, bud: 0x8a2a4a, rock: 0x9a9a98,
  rockLight: 0xbcbcb8, rockDark: 0x6a6a6c, rockBlue: 0x5c6472, rockBrown: 0x7e6c5c, rust: 0xb0502a, ironOre: 0x6e463a, coal: 0x222228,
  coalShine: 0x4a4c58, oil: 0x111116, oilSheen: 0x3a3060, oilSheen2: 0x2a5060, oilStain: 0x3e3224, bauxite: 0xb8643a, bauxiteDark: 0x8a4630,
  alu: 0xe4e8ee, pitch: 0x3a3e38, uranium: 0x52f22a, goldBright: 0xffd860, silverVein: 0xeef2f6, ruby: 0xe0304a, sapphire: 0x3ac8ff,
  emerald: 0x30c070, amethyst: 0xb060f0, vein: 0xa4a4b0, copperOre: 0xe0843a, salt: 0xfbf9f4, saltShade: 0xe2dad2, saltFlat: 0xe6ded2,
  dye: 0xb03ad8, indigo: 0x4a42c0, chili: 0xd82a1a, spice: 0xf0802a, mulberry: 0x3a1a3a, cocoon: 0xf8f4e6, cane: 0xb0c850,
  caneNode: 0x76863a, cotton: 0xfcfbf6, cottonShade: 0xe4e0d6, vine: 0x4a8a34, grape: 0x5a2470, resin: 0xf0a030, incenseBark: 0x8e7c62,
  citrus: 0xff9418, cocoaPod: 0xe8a820, cocoaRed: 0xb44a1a, bison: 0x6e4a2c, bisonDark: 0x3e2a1c, bisonShag: 0x2a1c14, bisonHorn: 0x2e2a28,
};
/** How much each colour glows (the rest don't). */
const GLOW = { uranium: 0.6, goldBright: 0.35, ruby: 0.3, sapphire: 0.3, emerald: 0.3, amethyst: 0.3, pearl: 0.25, resin: 0.2 };
/** Colours with a metal's sheen. */
const METAL = { alu: 0.6, silverVein: 0.5, goldBright: 0.4 };
for (const [name, hex] of Object.entries(COLOURS)) P.add(name, hex, { rough: METAL[name] ? 0.4 : 0.85, metal: METAL[name] ?? 0, glow: GLOW[name] ?? 0, vary: 0 });

// ---------------------------------------------------------------------------------------------
// Helpers

/** A cell's own small random number, the same every time (`s` picks another). */
function hash(i, j, k, s = 0) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1440662683) + Math.imul(s, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A colour, or a colour for each cell (null: left empty). */
const paintOf = (c) => (typeof c === 'function' ? c : () => c);

/** Cells [lo, hi) filled with a colour, or a colour for each cell. */
function fill(m, lo, hi, colour) {
  const paint = paintOf(colour);
  for (let k = lo[2]; k < hi[2]; k++) for (let j = lo[1]; j < hi[1]; j++) for (let i = lo[0]; i < hi[0]; i++) m.set(i, j, k, paint(i, j, k));
  return m;
}

/** An ellipsoid's cells: middle (x, y, z), radii; only from `floor` up (a rock sits on the ground). */
function blob(m, x, y, z, rx, ry, rz, colour, floor = -Infinity) {
  const paint = paintOf(colour);
  for (let k = Math.floor(z - rz); k <= Math.ceil(z + rz); k++)
    for (let j = Math.max(floor, Math.floor(y - ry)); j <= Math.ceil(y + ry); j++)
      for (let i = Math.floor(x - rx); i <= Math.ceil(x + rx); i++) {
        const d = ((i + 0.5 - x) / rx) ** 2 + ((j + 0.5 - y) / ry) ** 2 + ((k + 0.5 - z) / rz) ** 2;
        if (d > 1) continue;
        const c = paint(i, j, k, d);
        if (c) m.set(i, j, k, c);
      }
  return m;
}

/** A rock's colour by its height (pale on top, dark at its foot), a few cells of `vein` (more where `rich` is higher). */
const rocky = (base, vein, rich = 0.22, top = 'rockLight', foot = 'rockDark') => (i, j, k) => {
  const h = hash(i, j, k);
  if (vein && h < rich) return typeof vein === 'function' ? vein(i, j, k) : vein;
  if (j <= 0) return foot;
  return hash(i, j, k, 1) < 0.18 ? top : base;
};

/** Crystals or nuggets: columns `w` across from the top of the rock (each [x, z, height, colour]), from height `y`. */
function spikes(m, list, y, w = 1) {
  for (const [x, z, h, c] of list) m.box([x, y, z], [x + w, y + h, z + w], c);
}

// ---------------------------------------------------------------------------------------------
// Beasts

/**
 * A four-legged beast along z, facing +z, standing on the origin: a body `w` wide, `h` high and `len`
 * long on legs `legs` high (`leg` voxels square, at its corners), coloured `coat` (a colour, or one
 * for each cell: patches), its legs `shank` with `hoof` at the foot. Returns where its body is.
 */
function body(m, { w, h, len, legs, leg = 1, coat, shank = coat, hoof = shank }) {
  const x0 = -Math.floor(w / 2);
  const z0 = -Math.floor(len / 2);
  const x1 = x0 + w;
  const z1 = z0 + len;
  for (const lx of [x0, x1 - leg])
    for (const lz of [z0 + (leg > 1 ? 0 : 1), z1 - leg - (leg > 1 ? 0 : 1)]) {
      m.box([lx, 0, lz], [lx + leg, 1, lz + leg], hoof);
      m.box([lx, 1, lz], [lx + leg, legs, lz + leg], shank);
    }
  const paint = paintOf(coat);
  for (let k = z0; k < z1; k++)
    for (let j = legs; j < legs + h; j++)
      for (let i = x0; i < x1; i++) {
        // (Its corners rounded off.)
        const edgeX = i === x0 || i === x1 - 1;
        const edgeY = j === legs || j === legs + h - 1;
        const edgeZ = k === z0 || k === z1 - 1;
        if ((edgeX && edgeY && edgeZ) || (edgeY && edgeZ && w > 4)) continue;
        m.set(i, j, k, paint(i, j, k));
      }
  return { x0, x1, z0, z1, top: legs + h };
}

/** A Holstein cow (or, `brown`, a brown and white one): patched, horned, its udder under it. */
function cow(id, brown = false) {
  const m = new Model(id);
  const patch = brown ? 'cowBrown' : 'cowBlack';
  const coat = (i, j, k) => (hash(Math.floor((i + 8) / 3), Math.floor(j / 3), Math.floor((k + 8) / 3), 5) < 0.42 ? patch : 'cowWhite');
  body(m, { w: 6, h: 5, len: 10, legs: 4, leg: 2, coat, shank: 'cowWhite', hoof: 'cowBlack' });
  m.box([-1, 3, -3], [1, 4, 0], 'muzzle');
  // The head (a little low, grazing), its muzzle, horns and ears; the tail.
  m.box([-2, 5, 5], [2, 9, 8], (brown ? 'cowWhite' : patch));
  m.box([-2, 7, 6], [2, 9, 8], 'cowWhite');
  m.box([-2, 4, 8], [2, 7, 9], 'muzzle');
  m.box([-3, 9, 6], [-2, 10, 7], 'horn').box([2, 9, 6], [3, 10, 7], 'horn');
  m.box([-4, 9, 6], [-3, 11, 7], 'horn').box([3, 9, 6], [4, 11, 7], 'horn');
  m.box([-3, 7, 6], [-2, 8, 7], patch).box([2, 7, 6], [3, 8, 7], patch);
  m.box([-1, 4, -6], [0, 9, -5], 'cowWhite').box([-1, 3, -6], [0, 4, -5], patch);
  return m;
}

/** A sheep: a fleece of wool on dark legs, its dark face. */
function sheep(id) {
  const m = new Model(id);
  for (const [x, z] of [[-2, -3], [1, -3], [-2, 2], [1, 2]]) m.box([x, 0, z], [x + 1, 4, z + 1], 'sheepFace');
  const fleece = (i, j, k) => (hash(i, j, k, 2) < 0.3 ? 'woolShade' : 'wool');
  blob(m, -0.0, 6, 0, 3.6, 3, 4.8, fleece, 3);
  // Tufts on its back.
  for (const [x, z] of [[-2, -2], [0, 1], [1, -3], [-1, 3]]) m.box([x, 9, z], [x + 1, 10, z + 1], 'wool');
  m.box([-1, 5, 4], [1, 8, 7], 'sheepFace');
  m.box([-1, 8, 4], [1, 9, 6], 'wool');
  m.box([-2, 7, 5], [-1, 8, 6], 'sheepFace').box([1, 7, 5], [2, 8, 6], 'sheepFace');
  return m;
}

/** A horse: its coat, and a darker mane, tail and hooves (a chestnut, or `dark`, a dark bay). */
function horse(id, dark = false) {
  const m = new Model(id);
  const coat = dark ? 'horseDark' : 'chestnut';
  const mane = dark ? 'black' : 'horseDark';
  body(m, { w: 4, h: 4, len: 12, legs: 6, coat, shank: coat, hoof: mane });
  // Neck up from its chest, the head forward, the mane down the neck, the tail.
  m.box([-1, 8, 5], [1, 13, 7], coat);
  m.box([-1, 11, 6], [1, 15, 8], coat);
  m.box([-1, 12, 8], [1, 15, 11], coat);
  m.box([-1, 12, 10], [1, 13, 12], mane);
  m.box([-1, 15, 7], [0, 16, 8], coat).box([0, 15, 7], [1, 16, 8], coat);
  m.box([-1, 10, 4], [1, 16, 5], mane).box([-1, 15, 5], [1, 16, 7], mane);
  m.box([-1, 5, -7], [1, 10, -6], mane).box([-1, 3, -8], [1, 6, -7], mane);
  return m;
}

/** A bison: a great shaggy hump and mane over its shoulders, a brown body behind, its bearded head low, short dark horns. */
function bison(id) {
  const m = new Model(id);
  body(m, { w: 6, h: 5, len: 11, legs: 4, leg: 2, coat: 'bison', shank: 'bisonDark', hoof: 'bisonHorn' });
  const shag = (i, j, k) => (hash(i, j, k, 40) < 0.35 ? 'bisonShag' : 'bisonDark');
  blob(m, 0, 9, 2.5, 3.4, 2.8, 3.2, shag, 8);
  fill(m, [-3, 4, 2], [3, 9, 6], shag);
  m.box([-2, 3, 6], [2, 8, 9], 'bisonDark');
  m.box([-1, 1, 7], [1, 3, 9], 'bisonShag');
  m.box([-3, 7, 6], [-2, 8, 8], 'bisonHorn').box([2, 7, 6], [3, 8, 8], 'bisonHorn');
  m.box([-3, 8, 7], [-2, 9, 8], 'bisonHorn').box([2, 8, 7], [3, 9, 8], 'bisonHorn');
  m.box([0, 6, -6], [1, 9, -5], 'bisonDark');
  return m;
}

/** A red deer: slender on long legs, a pale belly and rump, antlers. */
function deer(id) {
  const m = new Model(id);
  const coat = (i, j) => (j <= 6 ? 'deerLight' : 'deer');
  body(m, { w: 4, h: 4, len: 10, legs: 6, coat, shank: 'deer', hoof: 'woodDark' });
  m.box([-1, 8, 4], [1, 14, 6], 'deer');
  m.box([-1, 12, 5], [1, 15, 9], 'deer');
  m.box([-1, 12, 9], [1, 13, 10], 'black');
  m.box([-2, 14, 5], [-1, 15, 6], 'deer').box([1, 14, 5], [2, 15, 6], 'deer');
  // The antlers: a beam up from each side of the head, branching out and forward.
  for (const s of [-1, 1]) {
    const x = s < 0 ? -1 : 0;
    m.box([x, 15, 6], [x + 1, 18, 7], 'antler');
    m.box([x + s, 17, 6], [x + s + 1, 20, 7], 'antler');
    m.box([x + 2 * s, 19, 6], [x + 2 * s + 1, 21, 7], 'antler');
    m.box([x + s, 18, 7], [x + s + 1, 19, 8], 'antler');
    m.box([x + 2 * s, 20, 5], [x + 2 * s + 1, 21, 6], 'antler');
  }
  m.box([-1, 8, -6], [1, 10, -5], 'deerLight');
  return m;
}

/** An elephant: great ears, its trunk to the ground, white tusks. */
function elephant(id) {
  const m = new Model(id);
  const hide = (i, j, k) => (hash(i, j, k, 3) < 0.12 ? 'elephantDark' : 'elephant');
  body(m, { w: 8, h: 8, len: 14, legs: 7, leg: 3, coat: hide, shank: 'elephant', hoof: 'elephantDark' });
  fill(m, [-3, 9, 7], [3, 16, 11], hide);
  m.box([-7, 8, 8], [-3, 16, 9], 'elephantDark').box([3, 8, 8], [7, 16, 9], 'elephantDark');
  m.box([-1, 3, 10], [1, 10, 12], 'elephant');
  m.box([-1, 1, 11], [1, 4, 13], 'elephant');
  m.box([-3, 7, 11], [-2, 8, 15], 'white').box([2, 7, 11], [3, 8, 15], 'white');
  m.box([-3, 8, 14], [-2, 9, 15], 'white').box([2, 8, 14], [3, 9, 15], 'white');
  m.box([0, 9, -8], [1, 14, -7], 'elephantDark');
  return m;
}

/** A red fox: a white chest and muzzle, black legs and ear tips, a big bushy tail tipped white. */
function fox(id) {
  const m = new Model(id);
  const coat = (i, j, k) => (j === 3 && k > 1 ? 'foxWhite' : 'fox');
  body(m, { w: 4, h: 3, len: 8, legs: 3, coat, shank: 'black' });
  m.box([-2, 5, 4], [2, 8, 7], 'fox');
  m.box([-1, 5, 7], [1, 7, 9], 'foxWhite').box([-1, 7, 7], [1, 8, 8], 'fox');
  m.box([-1, 6, 9], [1, 7, 10], 'black');
  m.box([-2, 8, 5], [-1, 9, 6], 'fox').box([1, 8, 5], [2, 9, 6], 'fox');
  m.box([-2, 9, 5], [-1, 10, 6], 'black').box([1, 9, 5], [2, 10, 6], 'black');
  m.box([-1, 3, -9], [1, 6, -4], 'fox').box([-1, 4, -10], [1, 6, -9], 'fox');
  m.box([-1, 2, -11], [1, 5, -10], 'foxWhite');
  return m;
}

/** A pig rooting for truffles: its snout down in a patch of turned earth, the truffles by it. */
function pig(id) {
  const m = new Model(id);
  const coat = (i, j, k) => (hash(i, j, k, 4) < 0.1 ? 'pigDark' : 'pig');
  body(m, { w: 6, h: 5, len: 8, legs: 2, coat, shank: 'pig', hoof: 'pigDark' });
  m.box([-2, 2, 4], [2, 6, 7], 'pig');
  m.box([-1, 1, 7], [1, 3, 8], 'pigDark');
  m.box([-3, 4, 4], [-2, 6, 6], 'pigDark').box([2, 4, 4], [3, 6, 6], 'pigDark');
  m.box([0, 5, -5], [1, 7, -4], 'pig').box([1, 6, -6], [2, 7, -5], 'pig');
  // The earth it's turned, and the truffles.
  for (let k = 7; k < 13; k++) for (let i = -3; i < 4; i++) if (((i + 0.5) / 3.5) ** 2 + ((k - 9.5) / 3) ** 2 < 1 && hash(i, 0, k, 6) < 0.85) m.set(i, 0, k, 'soil');
  for (const [x, z] of [[-2, 9], [1, 10], [-1, 11]]) m.box([x, 1, z], [x + 2, 2, z + 1], 'truffle').set(x, 1, z + 1, 'truffle');
  return m;
}

// ---------------------------------------------------------------------------------------------
// The sea's

/** A school of fish circling just under the surface (the water's surface at the origin), their dark backs and fins at it. */
function fish(id) {
  const m = new Model(id);
  /** A fish at (x, z), heading along `dir` (+z, +x, -z, -x): pointed snout, a deep body, a forked tail. */
  const one = (x, z, dir, y = 0) => {
    const at = (a, b, c) => (dir === 0 ? [x + a, y + b, z + c] : dir === 1 ? [x + c, y + b, z - a] : dir === 2 ? [x - a, y + b, z - c] : [x - c, y + b, z + a]);
    const put = (a, b, c, col) => m.set(...at(a, b, c), col);
    // Across (a) and along (c): the body's outline, its back dark, its sides and belly silver.
    for (const [c, w] of [[3, 0], [2, 1], [1, 1], [0, 1], [-1, 0]])
      for (let a = -w; a <= w; a++) {
        put(a, 0, c, 'fishBack');
        put(a, -1, c, 'fishSide');
      }
    put(0, 1, 1, 'fishFin');
    put(0, 1, 0, 'fishFin');
    for (const [a, c] of [[-1, -2], [1, -2], [-2, -3], [2, -3]]) put(a, 0, c, 'fishFin');
  };
  // Round a ring, each heading round it (clockwise from above).
  one(-1, 8, 1);
  one(8, 1, 2, -1);
  one(1, -8, 3);
  one(-8, -1, 0, -1);
  one(5, 6, 1, -1);
  one(-5, -6, 3, -1);
  one(6, -5, 2);
  return m;
}

/** A whale's back breaking the surface (at the origin): its hump and blowhole, a small fin, the tail's flukes flat on the water. */
function whale(id) {
  const m = new Model(id);
  const skin = (i, j, k) => (hash(i, j, k, 7) < 0.1 ? 'whaleLight' : 'whale');
  blob(m, 0, -1, 1, 4.5, 3.5, 12, skin, -3);
  m.box([-1, 2, 7], [1, 3, 8], 'black');
  m.box([0, 3, -6], [1, 4, -3], 'whale').box([0, 4, -5], [1, 5, -4], 'whale');
  m.box([-1, -1, -15], [1, 1, -10], 'whale');
  for (let i = -7; i < 7; i++) {
    const w = Math.abs(i + 0.5);
    m.box([i, 0, -18 + Math.floor(w / 3)], [i + 1, 1, -15 + Math.floor(w / 4)], 'whale');
  }
  return m;
}

/** A crab, sideways on: red shell, claws up, eyes on stalks. */
function crab(id) {
  const m = new Model(id);
  const shell = (i, j, k) => (j === 2 && hash(i, j, k, 8) < 0.3 ? 'crabDark' : 'crab');
  for (let k = -1; k < 2; k++) for (let i = -2; i < 2; i++) for (let j = 1; j < 3; j++) m.set(i, j, k, shell(i, j, k));
  m.box([-2, 3, 1], [-1, 4, 2], 'black').box([0, 3, 1], [1, 4, 2], 'black');
  m.box([-4, 1, 2], [-2, 3, 4], 'crab').box([1, 1, 2], [3, 3, 4], 'crab');
  m.box([-4, 3, 3], [-3, 4, 4], 'crabDark').box([2, 3, 3], [3, 4, 4], 'crabDark');
  for (const z of [-1, 0]) m.box([-3, 0, z], [-2, 1, z + 1], 'crabDark').box([2, 0, z], [3, 1, z + 1], 'crabDark');
  m.box([-4, 0, -1], [-3, 1, 0], 'crabDark').box([3, 0, -1], [4, 1, 0], 'crabDark');
  return m;
}

/** A sandbar just out of the water (its surface at the origin), for crabs to stand on. */
function sandbar(id) {
  const m = new Model(id);
  const sand = (i, j, k) => (hash(i, j, k, 9) < 0.06 ? 'stone' : hash(i, j, k, 10) < 0.3 ? 'sandDark' : 'sand');
  for (let k = -8; k < 8; k++)
    for (let i = -11; i < 11; i++) {
      const d = ((i + 0.5) / 11) ** 2 + ((k + 0.5) / 7.5) ** 2 + (hash(i, 0, k, 11) - 0.5) * 0.25;
      if (d > 1) continue;
      for (let j = -3; j < (d < 0.55 ? 1 : 0); j++) m.set(i, j, k, sand(i, j, k));
    }
  return m;
}

/** Oysters open on a rocky shoal (its surface at the origin), a pearl in each. */
function pearls(id) {
  const m = new Model(id);
  blob(m, 0, -1, 0, 8, 2.2, 6.5, rocky('sandDark', null, 0, 'sand', 'rockDark'), -3);
  for (const [x, z] of [[-5, -2], [1, -3], [-2, 2], [3, 1]]) {
    m.box([x, 1, z], [x + 4, 2, z + 3], 'shell');
    m.box([x + 1, 2, z + 1], [x + 3, 3, z + 3], 'nacre');
    m.box([x, 2, z - 1], [x + 4, 5, z], 'shell');
    m.box([x + 1, 2, z], [x + 3, 4, z + 1], 'nacre');
    m.box([x + 1, 2, z + 1], [x + 3, 4, z + 3], 'pearl');
  }
  return m;
}

// ---------------------------------------------------------------------------------------------
// Crops and trees

/** Wheat: a stook of sheaves leant together, standing wheat round it. */
function wheat(id) {
  const m = new Model(id);
  for (let j = 0; j < 9; j++) {
    const r = j < 3 ? 3 : j < 6 ? 2.4 : 1.6;
    m.disc(0, 0, r, j, j + 1, j === 4 ? 'rope' : j >= 7 ? 'wheatHead' : 'wheat');
  }
  for (const [x, z] of [[-1, -1], [0, 0], [-1, 0], [0, -1], [1, 0], [-2, -1]]) m.set(x, 9, z, 'wheatHead');
  for (let k = -6; k < 7; k++)
    for (let i = -6; i < 7; i++) {
      const d = Math.hypot(i + 0.5, k + 0.5);
      if (d < 4.2 || d > 6.8 || hash(i, 0, k, 12) < 0.55) continue;
      const h = 5 + Math.floor(hash(i, 1, k, 12) * 3);
      m.box([i, 0, k], [i + 1, h, k + 1], 'wheat').box([i, h, k], [i + 1, h + 2, k + 1], 'wheatHead');
    }
  return m;
}

/** A banana plant: a green trunk, broad leaves arching out all round and drooping, a bunch of bananas and its purple bud. */
function bananas(id) {
  const m = new Model(id);
  m.box([-1, 0, -1], [1, 11, 1], 'bananaTrunk');
  // Eight leaves, two cells wide, each rising a little from the crown and then drooping to its tip.
  const droop = [1, 2, 2, 1, 1, 0, -1, -2];
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const diag = dx !== 0 && dz !== 0;
    const len = diag ? 6 : 8;
    for (let s = 1; s <= len; s++) {
      const y = 10 + droop[s - 1];
      const x = (dx < 0 ? -1 : 0) + dx * s;
      const z = (dz < 0 ? -1 : 0) + dz * s;
      const c = s === len ? 'leafOlive' : 'leaf';
      m.set(x, y, z, c);
      if (diag) m.set(x - dx, y, z, c);
      else if (dx) m.set(x, y, -1 - z, c);
      else m.set(-1 - x, y, z, c);
    }
  }
  m.box([-1, 11, -1], [0, 15, 0], 'leaf');
  m.box([0, 6, 1], [2, 10, 3], 'banana').box([-1, 7, 1], [0, 9, 2], 'banana');
  m.box([0, 4, 1], [1, 6, 2], 'bud');
  return m;
}

/** A bush (`leaves`) with fruit or flowers dotted over it: `dots` (each cell's colour or null). */
function bush(m, x, y, z, r, h, leaves, dots) {
  return blob(m, x, y, z, r, h, r, (i, j, k, d) => (d > 0.55 && dots(i, j, k)) || leaves, 0);
}

/** A little tree: a trunk `trunk` high, a round crown (`crown`, radius `r`) with `dots` over it. */
function tree(m, trunk, r, crown, dots = () => null, bark = 'bark') {
  m.box([-1, 0, -1], [1, trunk, 1], bark);
  return blob(m, 0, trunk + r * 0.6, 0, r, r * 0.8, r, (i, j, k, d) => (d > 0.5 && dots(i, j, k)) || crown);
}

function cotton(id) {
  const m = new Model(id);
  bush(m, 0, 2, 0, 4, 3.6, 'leafOlive', () => null);
  for (const [x, y, z] of [[-3, 4, -1], [1, 5, -2], [-1, 5, 2], [2, 3, 2], [-3, 2, 2], [3, 2, -2], [0, 6, 0]]) m.box([x, y, z], [x + 2, y + 2, z + 2], 'cotton').set(x, y, z, 'cottonShade');
  return m;
}

function dyes(id) {
  const m = new Model(id);
  bush(m, 0, 2, 0, 4, 3, 'leafDark', (i, j, k) => (hash(i, j, k, 13) < 0.35 ? (hash(i, j, k, 14) < 0.5 ? 'dye' : 'indigo') : null));
  // Flower spikes standing out of it.
  for (const [x, z, h] of [[-2, -1, 3], [1, 1, 4], [2, -2, 3], [-1, 2, 3], [0, -3, 2]]) m.box([x, 5, z], [x + 1, 5 + h, z + 1], h > 3 ? 'indigo' : 'dye');
  return m;
}

function spices(id) {
  const m = new Model(id);
  bush(m, 0, 2, 0, 4, 3, 'leafDark', (i, j, k) => (hash(i, j, k, 15) < 0.4 ? (hash(i, j, k, 16) < 0.6 ? 'chili' : 'spice') : null));
  for (const [x, z] of [[-4, 0], [3, 1], [0, 3], [1, -4]]) m.box([x, 1, z], [x + 1, 3, z + 1], 'chili');
  return m;
}

/** Silk: a mulberry tree dotted with its berries, silkworms' cocoons hanging from it. */
function silk(id) {
  const m = new Model(id);
  tree(m, 6, 4.5, 'leaf', (i, j, k) => (hash(i, j, k, 17) < 0.12 ? 'mulberry' : null));
  for (const [x, z] of [[-5, -1], [3, -3], [-1, 3], [3, 2], [-3, -4]]) m.box([x, 3, z], [x + 2, 6, z + 2], 'cocoon').set(x, 6, z, 'woodDark');
  return m;
}

/** Sugar cane: a clump of tall jointed stalks, leaves arching from their tops. */
function sugar(id) {
  const m = new Model(id);
  const stalks = [[0, 0, 13], [-2, 1, 11], [2, -1, 12], [-1, -3, 10], [1, 3, 11], [3, 2, 9], [-3, -1, 10], [2, -3, 11], [-2, 3, 9]];
  for (const [x, z, h] of stalks) {
    for (let j = 0; j < h; j++) m.set(x, j, z, j % 3 === 2 ? 'caneNode' : 'cane');
    const dx = x >= 0 ? 1 : -1;
    m.set(x + dx, h, z, 'leaf').set(x + 2 * dx, h - 1, z, 'leaf').set(x, h, z + (z >= 0 ? 1 : -1), 'leaf');
  }
  return m;
}

/** Wine: a row of vines on posts and a wire, bunches of grapes hanging. */
function wine(id) {
  const m = new Model(id);
  m.box([-7, 0, 0], [-6, 9, 1], 'woodDark').box([6, 0, 0], [7, 9, 1], 'woodDark');
  m.box([-7, 8, 0], [7, 9, 1], 'woodDark');
  for (const x of [-3, 2]) m.box([x, 0, 0], [x + 1, 6, 1], 'bark');
  for (let i = -6; i < 6; i++) for (let k = -1; k < 2; k++) for (let j = 6; j < 9; j++) if (hash(i, j, k, 18) < 0.8) m.set(i, j, k, 'vine');
  for (const x of [-5, -1, 3]) m.box([x, 3, -1], [x + 2, 6, 1], 'grape').set(x, 2, 0, 'grape');
  return m;
}

/** Frankincense: a gnarled pale tree, branching wide, dark tufts of leaves, beads of amber resin. */
function incense(id) {
  const m = new Model(id);
  m.box([-1, 0, -1], [1, 5, 1], 'incenseBark');
  // Three branches, each up and out a step at a time to its tuft.
  for (const [dx, dz, h] of [[1, 0, 10], [-1, 1, 9], [0, -1, 11]]) {
    for (let s = 1; s <= 3; s++) m.box([dx * s, 4 + s, dz * s], [dx * s + 1, 6 + s, dz * s + 1], 'incenseBark');
    blob(m, dx * 4 + 0.5, h, dz * 4 + 0.5, 2.6, 1.4, 2.6, (i, j, k) => (hash(i, j, k, 30) < 0.25 ? 'sage' : 'leafOlive'));
  }
  for (const [x, y, z] of [[1, 2, 0], [-2, 1, 0], [0, 3, -2], [1, 7, 0], [-1, 6, 1], [0, 4, 1]]) m.set(x, y, z, 'resin');
  return m;
}

function citrus(id) {
  const m = new Model(id);
  return tree(m, 4, 4.4, 'leafDark', (i, j, k) => (hash(i, j, k, 19) < 0.22 ? 'citrus' : null));
}

/** Cocoa: a tree with its great pods growing straight from the trunk. */
function cocoa(id) {
  const m = new Model(id);
  tree(m, 8, 4.2, 'leaf');
  m.box([1, 3, -1], [3, 6, 1], 'cocoaPod');
  m.box([-3, 4, 0], [-1, 7, 2], 'cocoaRed');
  m.box([-1, 2, 1], [1, 4, 3], 'cocoaPod');
  m.box([0, 6, -3], [2, 8, -1], 'cocoaRed');
  return m;
}

// ---------------------------------------------------------------------------------------------
// The ground's

function stone(id) {
  const m = new Model(id);
  blob(m, 0, 1, 0, 4.5, 4, 4, rocky('rock'), 0);
  blob(m, 5.5, 0.5, -3, 2.6, 2.4, 2.6, rocky('rock'), 0);
  blob(m, -4.5, 0.5, 3.5, 2.2, 2, 2.2, rocky('rock'), 0);
  return m;
}

/** An outcrop of rock (`base`) veined with an ore, chunks of it broken off at its foot. */
function outcrop(id, base, vein, rich, chunk = vein) {
  const m = new Model(id);
  blob(m, 0, 1, 0, 5, 4.5, 4.2, rocky(base, vein, rich), 0);
  blob(m, 5, 0.5, 2.5, 2.4, 2.4, 2.2, rocky(base, vein, rich), 0);
  for (const [x, z] of [[-5, 1], [1, 4], [-2, -4]]) m.box([x, 0, z], [x + 2, 1, z + 1], chunk).set(x, 1, z, chunk);
  return m;
}

function coal(id) {
  const m = new Model(id);
  const lumps = (i, j, k) => (hash(i, j, k, 20) < 0.22 ? 'coalShine' : 'coal');
  blob(m, 0, 0.5, 0, 5.5, 4, 4.5, (i, j, k) => (j <= 0 && hash(i, j, k, 21) < 0.5 ? 'rockDark' : lumps(i, j, k)), 0);
  blob(m, -4.5, 0, 2.5, 2.8, 2.6, 2.6, lumps, 0);
  blob(m, 4, 0, -2, 2.4, 2.2, 2.4, lumps, 0);
  return m;
}

/** Oil seeping up: a black pool with a sheen on it, the ground stained round it, bubbles. */
function oil(id) {
  const m = new Model(id);
  for (let k = -7; k < 7; k++)
    for (let i = -8; i < 8; i++) {
      const d = ((i + 0.5) / 7.5) ** 2 + ((k + 0.5) / 6.2) ** 2 + (hash(i, 0, k, 22) - 0.5) * 0.3;
      if (d > 1.15) continue;
      const sheen = hash(i, 1, k, 23);
      m.set(i, 0, k, d > 0.85 ? 'oilStain' : sheen < 0.12 ? 'oilSheen' : sheen < 0.2 ? 'oilSheen2' : 'oil');
    }
  for (const [x, z] of [[-2, 1], [3, -2], [0, -3]]) m.set(x, 1, z, 'oil');
  m.box([1, 1, 2], [3, 2, 4], 'oil');
  return m;
}

function aluminum(id) {
  const m = new Model(id);
  blob(m, 0, 1, 0, 5, 4.2, 4.2, rocky('bauxite', 'bauxiteDark', 0.25, 'bauxite', 'bauxiteDark'), 0);
  blob(m, -5, 0.5, -2.5, 2.4, 2.2, 2.4, rocky('bauxite', 'bauxiteDark', 0.25, 'bauxite', 'bauxiteDark'), 0);
  spikes(m, [[-2, -1, 2, 'alu'], [1, 1, 3, 'alu'], [2, -3, 2, 'alu'], [-6, -3, 2, 'alu']], 4, 2);
  m.box([4, 0, 3], [6, 2, 5], 'alu');
  return m;
}

function uranium(id) {
  const m = new Model(id);
  blob(m, 0, 1, 0, 5, 4.2, 4.4, rocky('pitch', 'uranium', 0.08, 'rockDark', 'pitch'), 0);
  spikes(m, [[-2, -1, 4, 'uranium'], [1, 1, 3, 'uranium'], [2, -2, 5, 'uranium'], [-3, 2, 2, 'uranium'], [3, 3, 2, 'uranium']], 4);
  spikes(m, [[5, -1, 3, 'uranium'], [-5, 0, 2, 'uranium']], 0);
  return m;
}

function gold(id) {
  const m = outcrop(id, 'rock', 'gold', 0.2, 'goldBright');
  spikes(m, [[-1, -1, 1, 'goldBright'], [1, 1, 1, 'goldBright']], 5, 2);
  return m;
}

function gems(id) {
  const m = new Model(id);
  blob(m, 0, 1, 0, 5, 4.2, 4.2, rocky('rockDark', null, 0, 'rock', 'rockDark'), 0);
  spikes(m, [[-2, -1, 4, 'sapphire'], [1, 1, 3, 'ruby'], [2, -2, 3, 'emerald'], [-3, 2, 2, 'amethyst'], [0, -3, 2, 'ruby'], [3, 2, 2, 'sapphire']], 4);
  spikes(m, [[5, 0, 2, 'emerald'], [-5, -1, 3, 'amethyst']], 0, 2);
  return m;
}

/** Marble: pale blocks of it standing out of the ground, grey-veined. */
function marble(id) {
  const m = new Model(id);
  const veined = (i, j, k) => ((i + j * 2 + k) % 7 === 0 && hash(i, j, k, 24) < 0.8 ? 'vein' : 'marbleWhite');
  const slab = (lo, hi) => {
    for (let k = lo[2]; k < hi[2]; k++) for (let j = lo[1]; j < hi[1]; j++) for (let i = lo[0]; i < hi[0]; i++) m.set(i, j, k, veined(i, j, k));
  };
  slab([-6, 0, -3], [0, 5, 3]);
  slab([0, 0, -4], [5, 3, 2]);
  slab([-4, 5, -2], [-1, 7, 2]);
  slab([1, 0, 2], [4, 4, 5]);
  slab([-5, 0, 3], [-2, 2, 6]);
  return m;
}

/** Salt: a white crust on the ground, heaps of it raked up. */
function salt(id) {
  const m = new Model(id);
  for (let k = -7; k < 7; k++)
    for (let i = -8; i < 8; i++) if (((i + 0.5) / 8) ** 2 + ((k + 0.5) / 7) ** 2 + (hash(i, 0, k, 25) - 0.5) * 0.3 < 1) m.set(i, 0, k, hash(i, 0, k, 26) < 0.3 ? 'saltShade' : 'saltFlat');
  for (const [x, z, r, h] of [[-2, -1, 3.2, 5], [3.5, 2, 2.4, 4], [-4, 4, 2, 3]])
    for (let j = 1; j <= h; j++) m.disc(x, z, r * (1 - (j - 1) / h) + 0.4, j, j + 1, hash(j, 0, x, 27) < 0.25 ? 'saltShade' : 'salt');
  return m;
}

// ---------------------------------------------------------------------------------------------
// The models

export const RESOURCE_MODELS = [
  cow('r_cattle'),
  cow('r_cattle2', true),
  sheep('r_sheep'),
  horse('r_horses'),
  horse('r_horses2', true),
  deer('r_deer'),
  bison('r_bison'),
  elephant('r_ivory'),
  fox('r_furs'),
  pig('r_truffles'),
  fish('r_fish'),
  whale('r_whales'),
  crab('r_crab'),
  sandbar('r_sandbar'),
  pearls('r_pearls'),
  wheat('r_wheat'),
  bananas('r_bananas'),
  cotton('r_cotton'),
  dyes('r_dyes'),
  spices('r_spices'),
  silk('r_silk'),
  sugar('r_sugar'),
  wine('r_wine'),
  incense('r_incense'),
  citrus('r_citrus'),
  cocoa('r_cocoa'),
  stone('r_stone'),
  outcrop('r_iron', 'rockDark', (i, j, k) => (hash(i, j, k, 28) < 0.6 ? 'rust' : 'ironOre'), 0.3, 'rust'),
  coal('r_coal'),
  oil('r_oil'),
  aluminum('r_aluminum'),
  uranium('r_uranium'),
  gold('r_gold_ore'),
  outcrop('r_silver', 'rockBlue', 'silverVein', 0.26),
  gems('r_gems'),
  marble('r_marble'),
  outcrop('r_copper', 'rockBrown', (i, j, k) => (hash(i, j, k, 29) < 0.6 ? 'copperOre' : 'copper'), 0.28, 'copperOre'),
  salt('r_salt'),
];
