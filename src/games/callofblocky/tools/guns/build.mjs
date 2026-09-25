#!/usr/bin/env node
/**
 * Call of Blocky: the weapon models (and the briefcase and the lethals), built as micro-voxel
 * models and written as binary glTF 2.0 (`.glb`) to `src/games/callofblocky/models/`.
 * Dependency-free (Node 22+): `node src/games/callofblocky/tools/guns/build.mjs [ids...]`. Each file
 * is parsed back and checked after it's written (chunks, accessors, winding, markers), and each
 * optic's window is checked open.
 *
 * Conventions (the game's code relies on these exactly):
 *
 * - Units: 1 glTF unit = 1 block = 16 pixels. The models are voxels 1.25 px on a side (5/64
 *   block): held at the platform's `HELD_SCALE` (0.52) that's about the fighters' voxel (1/24
 *   block), so a fighter and the gun in its fists read as one style. Voxel (i, j, k) spans
 *   [i, i+1] x [j, j+1] x [k, k+1] voxels from the grip; a part may sit half a voxel over (the
 *   katana's blade, the lethals, whose widths are odd).
 * - Orientation: the barrel runs along +z (the muzzle is the +z end), +y is up. The gun's right
 *   side (ejection port, bolt handle) is -x; its left side (the one the player sees in first
 *   person) is +x.
 * - Origin (0,0,0): the centre of the firing hand's fist around the pistol grip (= `grip`), the
 *   grips two voxels square round it.
 * - Sizes (overall length along z, px, within about 10% of the models these replaced): pistol 12,
 *   SMG 17, rifle 28, shotgun 29.5, sniper 33, katana 30.
 * - Marker nodes: empty nodes (no mesh), children of the root, their translation in blocks:
 *   - `grip`: the centre of the firing fist on the pistol grip (the origin).
 *   - `grip2`: where the support hand holds, under the handguard / pump / forend (the SMG: its
 *     hand strap; the pistol: below and in front of the grip, the cupping hand).
 *   - `muzzle`: the centre of the barrel's tip (flashes and tracers start here).
 *   - `sight`: the eye point when aiming down sights. On the pistol, SMG, rifle and shotgun it's
 *     the centre of the optic's open window (a red dot or holo) at the frame's rear face: the
 *     window (two voxels square) holds no voxel, and nothing stands in its line of sight, behind
 *     it to the eye or ahead of it (the body in front steps down below the window); the platform
 *     draws the reticle. On the sniper, the centre of the scope's rear lens.
 *   - `mag`: the centre of the magazine (reloads send the support hand there): the pistol's is its
 *     base plate below the grip; the shotgun's its loading port under the receiver. The katana
 *     has none; its `grip` is the rear hand on the handle and `grip2` the front hand, and its blade
 *     runs along +z with the edge facing +y (its flats face +-x).
 * - The briefcase (a pickup, not a weapon) has no markers: its origin is the centre of its bottom
 *   face, +y up, its front (latches, the lid ajar and glowing) toward +z; about 10 x 9 x 4 px.
 * - The lethals (thrown) have one marker, `grip`, and their origin is the middle of the body, +y
 *   up. The frag (The Pineapple) is about 5 x 6 x 4 px, its pull ring in front (+z), the spoon
 *   down its right side (-x); `grip` the origin. The molotov (The Mia, a soda bottle stuffed with
 *   a burning napkin) is about 4 x 13 x 4 px, the bottle from y -3.75, its label toward +z, the
 *   napkin flopped toward +x, the flame on top; `grip` 1.5 px below the origin.
 * - Look (tools/voxel.mjs): flat, clean voxels: a quad per visible voxel face (faces of a colour
 *   in a plane merged where nothing shades them), each on a tile of one palette atlas, soft
 *   occlusion in the concave corners baked into tile variants. One material: baseColorTexture,
 *   metallicRoughnessTexture (G roughness, B metalness; the factors 1) and emissiveTexture (what
 *   glows: lenses, the briefcase's gold, the molotov's flame), sampled LINEAR with mipmaps. One
 *   mesh; POSITION (with min/max) and NORMAL as floats, TEXCOORD_0 as normalized unsigned shorts,
 *   indices (core glTF: the platform's held-model pipeline transforms positions in place). Node
 *   tree: root (named after the model's id, extras.title its name) > [mesh node, marker nodes].
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Palette, Voxels, faces, atlas, quadCorners, png, writeGlb, readGlb, cellOf, cellKey, DIRS } from '../voxel.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../../models');
/** A voxel, in px. */
const V = 1.25;
const MAX_BYTES = 300 * 1024;

// ---------------------------------------------------------------------------------------------
// A model: voxel parts, colours, markers, an optic's window. Cell (i, j, k) is the voxel centred
// at (i, j, k) voxels from the origin (the model's `offset`, half a voxel on each axis, puts the
// grid's corners there), so widths are odd, centred on the gun's axis: a one-voxel barrel, a
// three-voxel receiver. Boxes are cell ranges [lo, hi).

class Gun {
  constructor(id, name, { offset = [-0.5, -0.5, -0.5] } = {}) {
    this.id = id;
    this.name = name;
    this.vox = new Voxels();
    this.P = new Palette();
    this.markers = {};
    /** An optic's open window: cells x [x0, x1), y [y0, y1), its frame the cells at z. */
    this.window = null;
    this.offset = offset;
  }
  /** Colours: name -> [hex, rough, metal, glow]. */
  colours(list) {
    for (const [name, [rgb, rough = 0.8, metal = 0, glow = 0]] of Object.entries(list)) this.P.add(name, rgb, { rough, metal, glow, vary: 0 });
    return this;
  }
  /** Fill the cells [lo, hi); `c` a colour or `(i, j, k) => colour | false | undefined`. */
  box(lo, hi, c) {
    const f = typeof c === 'function' ? c : () => c;
    this.vox.paint('body', lo, hi, f);
    return this;
  }
  /** Recolour the filled cells in [lo, hi) that `pick(i, j, k, c)` names a colour for. */
  paint(lo, hi, pick) {
    this.vox.recolour('body', (i, j, k, c) => (i >= lo[0] && i < hi[0] && j >= lo[1] && j < hi[1] && k >= lo[2] && k < hi[2] ? pick(i, j, k, c) : undefined));
    return this;
  }
  /** A grip raked back: rows y1-1 down to y0, `z0..z1` moved back a voxel every `every` rows down. */
  raked([x0, x1], [y0, y1], [z0, z1], every, c) {
    for (let j = y1 - 1; j >= y0; j--) {
      const back = Math.floor((y1 - 1 - j) / every);
      this.box([x0, j, z0 - back], [x1, j + 1, z1 - back], c);
    }
    return this;
  }
  /** A point at a cell's centre (cells, can be fractional), in px. */
  at(i, j, k) {
    return [i * V, j * V, k * V];
  }
  mark(name, p) {
    this.markers[name] = p;
    return this;
  }
}

/** Not the corner cells of a box's x-y section (its edges along z rounded off). */
const cut = (x0, x1, y0, y1) => (i, j) => (i === x0 || i === x1 - 1) && (j === y0 || j === y1 - 1);

/**
 * An open reflex sight: a frame one voxel deep round a window three voxels wide and `h` tall
 * (cells x -1..1, y wy..), its frame the cells at z; the body under the window, `len` voxels on
 * ahead of the frame and never above the window's sill. Returns the `sight` point: the window's
 * centre at the frame's rear face.
 */
function reflex(g, { wy, z, len, h = 2, frame, body = 'anod', base = 1 }) {
  g.box([-2, wy - base, z], [3, wy, z + len], body);
  for (const x of [-2, 2]) g.box([x, wy, z], [x + 1, wy + h, z + 1], frame);
  g.box([-2, wy + h, z], [3, wy + h + 1, z + 1], (i) => (i === -2 || i === 2 ? false : frame));
  g.box([-2, wy + h - 1, z], [3, wy + h, z + 1], (i) => (i === -2 || i === 2 ? frame : undefined));
  g.window = { x0: -1, x1: 2, y0: wy, y1: wy + h, z };
  return g.at(0, wy + (h - 1) / 2, z - 0.5);
}

// ---------------------------------------------------------------------------------------------
// The guns: chunky, clean forms, flat runs of voxels, steps only where a shape turns.

/** Lucky 45: a 1911, a nickel slide on a blued frame, pearl grips, gold touches, a mini red dot. */
function pistol() {
  const g = new Gun('pistol', 'Lucky 45').colours({
    nickel: [0xe4e0d8, 0.18, 1], nickelDark: [0xb4b0a8, 0.25, 1], blued: [0x39424f, 0.35, 0.7], pearl: [0xf4efe6, 0.35], pearlShade: [0xe2d8e0, 0.35],
    gold: [0xf2c055, 0.22, 1], anod: [0x2a2c31, 0.45, 0.4], port: [0x1a1a1a, 0.5, 0.5],
  });
  // Slide (nickel, serrated at the back, the port on the right), frame (blued) under it.
  g.box([-1, 3, -3], [2, 5, 7], (i, j, k) => (k < -1 && (k + j) % 2 === 0 ? 'nickelDark' : 'nickel'));
  g.box([-1, 4, 2], [0, 5, 4], 'port');
  g.box([-1, 2, -3], [2, 3, 6], 'blued');
  g.box([0, 5, -3], [1, 6, -2], 'gold');
  // Grip: pearl panels raked back, gold screws; a gold base plate.
  g.raked([-1, 2], [-2, 2], [-1, 2], 2, (i, j, k) => (j === 0 && k === 0 && i !== 0 ? 'gold' : 'pearl'));
  g.box([-1, -3, -2], [2, -2, 1], 'gold');
  // Trigger guard, trigger.
  g.box([-1, 0, 2], [2, 1, 5], 'blued');
  g.box([-1, 1, 4], [2, 2, 5], 'blued');
  g.box([0, 1, 2], [1, 2, 3], 'gold');
  // The mini red dot, gold framed, on the back of the slide.
  const sight = reflex(g, { wy: 6, z: -2, len: 4, frame: 'gold' });
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, -2, 2]).mark('muzzle', g.at(0, 4, 6.5)).mark('sight', sight).mark('mag', g.at(0, -3, -0.5));
}

/** Mac-10: black parkerized steel, gold furniture, a hot-pink strap and a pink-hooded holo. */
function smg() {
  const g = new Gun('smg', 'Mac-10').colours({
    parker: [0x3b3d38, 0.7, 0.3], parkerDark: [0x2c2d30, 0.7, 0.3], gold: [0xf2c055, 0.22, 1], goldDark: [0xc4922c, 0.3, 1], polymer: [0x28292d, 0.65], pink: [0xff3d97, 0.25], steel: [0xa4a8ae, 0.3, 1], anod: [0x2a2c31, 0.45, 0.4],
  });
  // The receiver: a tall box, the rear cap darker; the gold barrel protector ahead, knurled.
  g.box([-1, 2, -3], [2, 6, 5], 'parker');
  g.box([-1, 2, -4], [2, 6, -3], 'parkerDark');
  g.box([0, 4, 5], [1, 5, 8], (i, j, k) => (k % 2 ? 'goldDark' : 'gold'));
  g.box([0, 6, 2], [1, 7, 3], 'gold');
  // Grip (polymer) with the magazine below it, a gold base.
  g.box([-1, -3, -1], [2, 2, 2], 'polymer');
  g.box([-1, -6, -1], [2, -3, 2], 'parker');
  g.box([-1, -7, -2], [2, -6, 3], 'gold');
  // Trigger guard, trigger.
  g.box([-1, 0, 2], [2, 1, 5], 'parker');
  g.box([-1, 1, 4], [2, 2, 5], 'parker');
  g.box([0, 1, 2], [1, 2, 3], 'gold');
  // The hot-pink hand strap under the front.
  g.box([-1, -1, 5], [2, 2, 6], 'pink');
  g.box([-1, -1, 5], [2, 0, 8], 'pink');
  g.box([-1, -1, 7], [2, 2, 8], 'pink');
  // The wire stock, retracted: rods down the sides, the butt behind.
  for (const x of [-2, 2]) g.box([x, 2, -6], [x + 1, 3, 4], 'steel');
  g.box([-2, 1, -7], [3, 5, -6], (i, j) => (cut(-2, 3, 1, 5)(i, j) ? false : 'parkerDark'));
  const sight = reflex(g, { wy: 7, z: -3, len: 4, frame: 'pink' });
  return g.mark('grip', [0, 0, 0]).mark('grip2', g.at(0, -0.5, 6.5)).mark('muzzle', g.at(0, 4, 7.5)).mark('sight', sight).mark('mag', g.at(0, -4.5, 0.5));
}

/** Big Kahuna: an AKM in blued steel, koa wood, a plum bakelite magazine and a yellow holo. */
function rifle() {
  const g = new Gun('rifle', 'Big Kahuna').colours({
    blued: [0x39424f, 0.35, 0.7], bluedDark: [0x2c323c, 0.4, 0.7], steel: [0xa4a8ae, 0.3, 1], darksteel: [0x575c64, 0.35, 0.8],
    koa: [0xb8642a, 0.45], koaLight: [0xd4813e, 0.45], plum: [0x7a2a44, 0.3], plumDark: [0x5c1e32, 0.35], yellow: [0xffcc1a, 0.22], anod: [0x2a2c31, 0.45, 0.4],
  });
  // Receiver, its dust cover, the rail.
  g.box([-1, 2, -1], [2, 5, 7], 'blued');
  g.box([-1, 5, -1], [2, 6, 6], (i, j, k) => (k < 2 && k % 2 === 0 ? 'bluedDark' : 'blued'));
  g.box([0, 6, 0], [1, 7, 5], 'darksteel');
  // The stock: koa, its top straight on, its underside stepping down to a steel butt plate.
  for (let k = -7; k < -1; k++) g.box([-1, k < -5 ? 0 : k < -3 ? 1 : 2, k], [2, 5, k + 1], (i, j) => (j === 4 ? 'koaLight' : 'koa'));
  g.box([-1, 0, -8], [2, 5, -7], 'darksteel');
  // Pistol grip (koa), guard, trigger.
  g.raked([-1, 2], [-2, 2], [-1, 2], 2, 'koa');
  g.box([-1, 0, 2], [2, 1, 4], 'blued');
  g.box([-1, 1, 3], [2, 2, 4], 'blued');
  g.box([0, 1, 2], [1, 2, 3], 'steel');
  // The magazine, plum bakelite, curving forward, a darker floor plate.
  for (const [j, z] of [[1, 4], [0, 4], [-1, 5], [-2, 5], [-3, 6]]) g.box([-1, j, z], [2, j + 1, z + 2], 'plum');
  g.box([-1, -4, 6], [2, -3, 8], 'plumDark');
  // Handguards (koa, grooved), the retainer; the barrel, gas tube, front sight, brake.
  g.box([-1, 2, 7], [2, 5, 11], (i, j, k) => (j === 4 ? 'koaLight' : j === 2 && k % 2 ? 'koaLight' : 'koa'));
  g.box([-1, 2, 11], [2, 5, 12], 'steel');
  g.box([0, 3, 12], [1, 4, 15], 'bluedDark');
  g.box([0, 4, 12], [1, 5, 14], 'blued');
  g.box([0, 4, 13], [1, 6, 14], 'blued');
  g.box([0, 3, 15], [1, 4, 16], 'darksteel');
  const sight = reflex(g, { wy: 8, z: 0, len: 4, h: 3, frame: 'yellow', base: 1 });
  g.box([-1, 7, 0], [2, 7, 4], 'anod');
  return g.mark('grip', [0, 0, 0]).mark('grip2', g.at(0, 1.5, 9)).mark('muzzle', g.at(0, 3, 15.5)).mark('sight', sight).mark('mag', g.at(0, -1, 5.5));
}

/** Zed's Pump: an 870 in blued steel, a walnut pistol-grip stock, a cherry pump and holo, red shells on the side. */
function shotgun() {
  const g = new Gun('shotgun', "Zed's Pump").colours({
    blued: [0x39424f, 0.35, 0.7], bluedDark: [0x2c323c, 0.4, 0.7], steel: [0xa4a8ae, 0.3, 1], walnut: [0x6e4329, 0.45], walnutLight: [0x8f6240, 0.45],
    cherry: [0xd01830, 0.22], cherryDark: [0xa40f24, 0.25], shell: [0xc81c1c, 0.4], brass: [0xd8aa55, 0.3, 1], rubber: [0x1e1e1e, 0.9], spacer: [0xe8e2d4, 0.5], anod: [0x2a2c31, 0.45, 0.4],
  });
  // Receiver; the barrel on the magazine tube, clamped at the front.
  g.box([-1, 1, -1], [2, 4, 6], 'blued');
  g.box([-1, 3, 6], [2, 4, 16], 'bluedDark');
  g.box([0, 1, 6], [1, 2, 14], 'blued');
  g.box([-1, 1, 14], [2, 3, 15], 'steel');
  // The cherry pump, ribbed like a corn cob.
  g.box([-2, 0, 8], [3, 3, 13], (i, j, k) => (cut(-2, 3, 0, 3)(i, j) ? false : k % 2 ? 'cherryDark' : 'cherry'));
  // Shells in the side saddle (the left, +x).
  g.box([2, 1, 0], [3, 2, 5], 'brass');
  g.box([2, 2, 0], [3, 3, 5], (i, j, k) => (k % 2 ? 'shell' : 'shell'));
  // Pistol grip, the stock (walnut) to a recoil pad behind a white spacer.
  g.raked([-1, 2], [-2, 1], [-1, 2], 2, 'walnut');
  g.box([-1, 1, -3], [2, 4, -1], 'walnut');
  for (let k = -8; k < -3; k++) g.box([-1, k < -5 ? -1 : 0, k], [2, 4, k + 1], (i, j) => (j === 3 ? 'walnutLight' : 'walnut'));
  g.box([-1, -1, -10], [2, 4, -9], 'rubber');
  g.box([-1, -1, -9], [2, 4, -8], 'spacer');
  // Trigger guard, trigger.
  g.box([-1, -1, 2], [2, 0, 4], 'blued');
  g.box([-1, 0, 3], [2, 1, 4], 'blued');
  g.box([0, 0, 2], [1, 1, 3], 'steel');
  const sight = reflex(g, { wy: 6, z: 2, len: 4, frame: 'cherry', base: 2 });
  return g.mark('grip', [0, 0, 0]).mark('grip2', g.at(0, 0, 10.5)).mark('muzzle', g.at(0, 3, 15.5)).mark('sight', sight).mark('mag', g.at(0, 0.5, 4));
}

/** Honey Bunny: a bolt-action rifle in honey maple and blued steel, a big scope with brass trim and a red glint. */
function sniper() {
  const g = new Gun('sniper', 'Honey Bunny').colours({
    blued: [0x39424f, 0.35, 0.7], bluedDark: [0x2c323c, 0.4, 0.7], steel: [0xa4a8ae, 0.3, 1], honey: [0xd8963a, 0.35], honeyLight: [0xeeb558, 0.35],
    scope: [0x222328, 0.35, 0.4], brass: [0xd8aa55, 0.28, 1], lens: [0x10161a, 0.05, 0.3], glint: [0xd01c28, 0.08, 0.2, 0.6], rubber: [0x1e1e1e, 0.9],
  });
  // The action, the barrel and its brake; the bolt handle out on the right.
  g.box([-1, 2, -1], [2, 5, 7], 'blued');
  g.box([0, 3, 7], [1, 4, 17], 'bluedDark');
  g.box([-1, 2, 17], [2, 5, 18], (i, j) => (cut(-1, 2, 2, 5)(i, j) ? false : 'steel'));
  g.box([-2, 4, 1], [-1, 5, 2], 'steel');
  g.box([-3, 3, 1], [-2, 5, 2], 'steel');
  // The honey maple stock: the forend, under the action, the grip, a butt with a raised comb.
  g.box([-1, 0, 7], [2, 3, 14], (i, j) => (j === 2 ? 'honeyLight' : 'honey'));
  g.box([-1, 0, -1], [2, 2, 7], 'honey');
  g.raked([-1, 2], [-2, 1], [-1, 2], 3, 'honey');
  g.box([-1, 1, -3], [2, 5, -1], 'honey');
  g.box([-1, -1, -10], [2, 5, -3], (i, j) => (j === 4 ? 'honeyLight' : 'honey'));
  g.box([-1, -1, -11], [2, 5, -10], 'rubber');
  // Trigger guard and trigger, the magazine, the bipod folded under the forend.
  g.box([-1, -1, 2], [2, 0, 4], 'blued');
  g.box([0, -1, 5], [1, 0, 7], 'bluedDark');
  g.box([-1, -1, 10], [2, 0, 15], (i, j, k) => (k === 14 ? 'rubber' : i === 0 ? false : 'steel'));
  // The scope on its rings: a tube, bells at both ends rimmed in brass, the rear lens, a red glint ahead.
  g.box([-1, 6, -3], [2, 9, 8], (i, j, k) => (cut(-1, 2, 6, 9)(i, j) ? false : k === 0 || k === 5 ? 'steel' : 'scope'));
  g.box([0, 5, 0], [1, 6, 1], 'steel');
  g.box([0, 5, 5], [1, 6, 6], 'steel');
  const bell = (z0, z1, face, glass) =>
    g.box([-2, 5, z0], [3, 10, z1], (i, j, k) => {
      if (cut(-2, 3, 5, 10)(i, j)) return false;
      if (k === face) return i >= -1 && i < 2 && j >= 6 && j < 9 ? glass : 'brass';
      return 'scope';
    });
  bell(-5, -3, -5, 'lens');
  bell(8, 11, 10, 'glint');
  g.box([0, 9, 2], [1, 10, 3], 'brass');
  g.box([2, 7, 2], [3, 8, 3], 'brass');
  return g.mark('grip', [0, 0, 0]).mark('grip2', g.at(0, 0, 10)).mark('muzzle', g.at(0, 3, 18.5)).mark('sight', g.at(0, 7, -5.5)).mark('mag', g.at(0, -1, 6));
}

/** Hattori Hanzo: a katana, a mirror blade with its hamon, a gold-rimmed iron tsuba, a yellow and black silk wrap. */
function katana() {
  const g = new Gun('katana', 'Katana').colours({
    ito: [0xffc81f, 0.7], itoDark: [0x181717, 0.7], lacquer: [0x161517, 0.15], gold: [0xf2c055, 0.22, 1], iron: [0x34343a, 0.45, 0.8],
    blade: [0xc8ced4, 0.12, 1], hamon: [0xf4f7fa, 0.14, 1],
  });
  // The handle: round-ish (its corners off), the silk wrap crossed in black diamonds; the pommel.
  g.box([-1, -1, -2], [2, 2, 3], (i, j, k) => (cut(-1, 2, -1, 2)(i, j) ? false : (k + (i === 0 ? j : i)) % 2 === 0 && !(i === 0 && j === 0) ? 'itoDark' : 'ito'));
  g.box([-1, -1, -3], [2, 2, -2], (i, j) => (cut(-1, 2, -1, 2)(i, j) ? false : 'lacquer'));
  // The tsuba: an iron plate rimmed in gold; the habaki.
  g.box([-2, -2, 3], [3, 3, 4], (i, j) => (cut(-2, 3, -2, 3)(i, j) ? false : i === -2 || i === 2 || j === -2 || j === 2 ? 'gold' : 'iron'));
  g.box([0, -1, 4], [1, 2, 5], 'gold');
  // The blade, a voxel thick: its spine and edge (+y, the hamon), curving down toward the tip.
  const drop = (k) => Math.floor(((k - 5) / 16) ** 2 * 2.2);
  for (let k = 5; k < 22; k++) {
    const y = -drop(k);
    if (k < 21) g.box([0, y - 1, k], [1, y, k + 1], 'blade');
    g.box([0, y, k], [1, y + 1, k + 1], 'hamon');
  }
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, 0, 3]).mark('muzzle', g.at(0, -drop(21), 21.5));
}

/** The briefcase: black leather, brass corners and latches, the lid ajar and gold light spilling from it. */
function briefcase() {
  const g = new Gun('briefcase', 'The Briefcase', { offset: [0, 0, -0.5] }).colours({ leather: [0x26211f, 0.55], leatherDark: [0x1a1717, 0.6], brass: [0xd8aa55, 0.3, 1], steel: [0xa4a8ae, 0.3, 1], glow: [0xffcc55, 0.3, 0.4, 1] });
  g.box([-4, 0, -2], [4, 6, 0], 'leather');
  g.box([-4, 0, 0], [4, 4, 1], (i, j) => (j === 3 ? 'steel' : 'leather'));
  g.box([-4, 0, 1], [4, 4, 2], 'leather');
  g.box([-4, 4, 2], [4, 6, 3], 'leather');
  g.box([-3, 4, 0], [3, 6, 2], 'glow');
  g.box([-4, 4, 0], [-3, 6, 2], 'leatherDark');
  g.box([3, 4, 0], [4, 6, 2], 'leatherDark');
  for (const i of [-4, 3]) {
    for (const k of [-2, 1]) g.box([i, 0, k], [i + 1, 1, k + 1], 'brass');
    for (const k of [-2, 2]) g.box([i, 5, k], [i + 1, 6, k + 1], 'brass');
  }
  for (const i of [-3, 2]) g.box([i, 4, 3], [i + 1, 5, 4], 'brass');
  for (const i of [-2, 1]) g.box([i, 6, -1], [i + 1, 7, 1], 'brass');
  g.box([-2, 7, -1], [2, 8, 1], 'leatherDark');
  return g;
}

/** The Pineapple: a frag, olive segments, a yellow band, the fuse, the spoon down its right, the ring in front. */
function frag() {
  const g = new Gun('frag', 'The Pineapple', { offset: [-0.5, -0.5, -0.5] }).colours({ olive: [0x5a6830, 0.35], oliveDark: [0x414b24, 0.4], yellow: [0xd8b520, 0.35], fuse: [0x4e504c, 0.5, 0.6], steel: [0xa8acb2, 0.3, 1] });
  g.box([-1, -2, -1], [2, 2, 2], (i, j, k) => {
    if (i !== 0 && k !== 0 && (j === -2 || j === 1)) return false;
    if (j === 1) return 'yellow';
    return (i + j + k) % 2 ? 'oliveDark' : 'olive';
  });
  g.box([0, 2, 0], [1, 3, 1], 'fuse');
  g.box([-2, 0, 0], [-1, 3, 1], 'steel');
  g.box([-1, 3, 0], [1, 4, 1], 'steel');
  g.box([0, 2, 1], [1, 3, 2], 'steel');
  g.box([0, 1, 2], [1, 2, 3], 'steel');
  return g.mark('grip', [0, 0, 0]);
}

/** The Mia: a red soda bottle, its label to the front, a napkin stuffed in its neck, burning. */
function molotov() {
  const g = new Gun('molotov', 'The Mia', { offset: [-0.5, 0, -0.5] }).colours({
    glass: [0xc01830, 0.08], glassDark: [0x8e1024, 0.1], label: [0xf4f1ea, 0.7], labelRed: [0xd21e3c, 0.7], napkin: [0xf6f3ec, 0.9], check: [0xd8283c, 0.9],
    flame: [0xff8a1f, 0.9, 0, 1], flameTip: [0xffd24a, 0.9, 0, 1],
  });
  g.box([-1, -3, -1], [2, 3, 2], (i, j, k) => {
    if (i !== 0 && k !== 0 && (j === -3 || j === 2)) return false;
    if (k === 1 && (j === -1 || j === 0)) return i === 0 && j === 0 ? 'labelRed' : 'label';
    return j === -3 ? 'glassDark' : 'glass';
  });
  g.box([0, 3, 0], [1, 5, 1], 'glass');
  g.box([0, 5, 0], [1, 6, 1], 'napkin');
  g.box([1, 5, 0], [2, 6, 1], 'check');
  g.box([1, 4, 0], [2, 5, 1], 'napkin');
  g.box([0, 6, 0], [1, 7, 1], 'flame');
  g.box([0, 7, 0], [1, 8, 1], 'flameTip');
  return g.mark('grip', [0, -1.5, 0]);
}

// ---------------------------------------------------------------------------------------------
// Writing and checking

function glb(g) {
  const { faces: list, before } = faces(g.vox, g.P, { merge: true });
  const A = atlas(list, g.P);
  const pos = [], nor = [], uv = [], idx = [];
  list.forEach((f, fi) => {
    const base = pos.length / 3;
    const off = g.offset;
    const n = DIRS[f.dir].n;
    quadCorners(f).forEach((c, ci) => {
      pos.push(...c.map((v, a) => ((v + off[a]) * V) / 16));
      nor.push(...n);
      uv.push(Math.round(A.uvs[fi][ci][0] * 65535), Math.round(A.uvs[fi][ci][1] * 65535));
    });
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const markerNames = Object.keys(g.markers);
  const nodes = [
    { name: g.id, children: [1, ...markerNames.map((_, k) => k + 2)], extras: { title: g.name } },
    { name: `${g.id}_body` },
    ...markerNames.map((m) => ({ name: m, translation: g.markers[m].map((v) => Math.round((v / 16) * 1e6) / 1e6) })),
  ];
  const glows = [...g.P.colours.values()].some((c) => c.glow > 0);
  const bytes = writeGlb({
    generator: 'Call of Blocky src/games/callofblocky/tools/guns/build.mjs',
    nodes,
    sceneName: g.id,
    meshName: `${g.id}_body`,
    meshNode: 1,
    attributes: {
      POSITION: { values: pos, componentType: 5126, type: 'VEC3', minmax: true },
      NORMAL: { values: nor, componentType: 5126, type: 'VEC3' },
      TEXCOORD_0: { values: uv, componentType: 5123, type: 'VEC2', normalized: true },
    },
    indices: idx,
    material: { name: `${g.id}_atlas`, albedo: png(A.albedo), mr: png(A.mr), glow: glows ? png(A.glow, { grey: true }) : null },
  });
  return { bytes, stats: { voxels: g.vox.count, faces: before, quads: list.length, tiles: A.tiles, atlas: `${A.width}x${A.height}` }, pos };
}

/** Each model's size before (px), to keep the first-person holds tuned. */
const SIZES = { pistol: [4, 12.77, 12], smg: [5, 20.5, 17], rifle: [6, 19.5, 28], shotgun: [6, 14.9, 29.5], sniper: [5.5, 12.84, 33], katana: [4, 5, 29.91], briefcase: [10.5, 10, 5.09], frag: [4.06, 6.1, 3.93], molotov: [3.84, 12.16, 3.84] };

function validate(buf, g) {
  const fail = (m) => {
    throw new Error(`${g.id}.glb: ${m}`);
  };
  const { json, read } = readGlb(buf);
  if (json.nodes[json.scenes[0].nodes[0]].name !== g.id) fail('root not named after the model');
  if (json.meshes.length !== 1 || json.meshes[0].primitives.length !== 1 || json.materials.length !== 1) fail('not one mesh, one primitive, one material');
  for (const [name, p] of Object.entries(g.markers)) {
    const n = json.nodes.find((x) => x.name === name);
    if (!n || n.mesh !== undefined || n.children || n.translation.some((v, a) => Math.abs(v * 16 - p[a]) > 1e-4)) fail(`marker ${name}`);
  }
  if (g.markers.grip && g.markers.grip.some((v) => v !== 0) && g.id !== 'molotov') fail('grip not at the origin');
  const prim = json.meshes[0].primitives[0];
  const P = read(json.accessors[prim.attributes.POSITION]), N = read(json.accessors[prim.attributes.NORMAL]), I = read(json.accessors[prim.indices]);
  const count = json.accessors[prim.attributes.POSITION].count;
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
    if (a >= count || b >= count || c >= count) fail('index out of range');
    const e1 = [0, 1, 2].map((k) => P[b * 3 + k] - P[a * 3 + k]), e2 = [0, 1, 2].map((k) => P[c * 3 + k] - P[a * 3 + k]);
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (cr[0] * N[a * 3] + cr[1] * N[a * 3 + 1] + cr[2] * N[a * 3 + 2] <= 0) fail('triangle winding');
  }
  if (buf.length > MAX_BYTES) fail(`${buf.length} bytes (budget ${MAX_BYTES})`);
  // The optic's window: no voxel in it, nor in its line of sight behind (to the eye, 9 voxels
  // back) or ahead of its frame.
  const w = g.window;
  if (w)
    for (const [part, cells] of g.vox.parts)
      for (const key of cells.keys()) {
        const [i, j, k] = cellOf(key);
        if (i >= w.x0 && i < w.x1 && j >= w.y0 && j < w.y1 && k >= w.z - 9) fail(`the optic's window isn't clear: ${part} voxel at ${i}, ${j}, ${k}`);
        if (i >= w.x0 - 1 && i < w.x1 + 1 && j >= w.y0 - 1 && j < w.y1 + 1 && k === w.z && !(i >= w.x0 && i < w.x1 && j >= w.y0 && j < w.y1) && j >= w.y0 && !cells.has(key)) fail('the frame');
      }
  return { tris: I.length / 3 };
}

const MODELS = { pistol, smg, rifle, shotgun, sniper, katana, briefcase, frag, molotov };
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
mkdirSync(OUT, { recursive: true });
for (const [id, make] of Object.entries(MODELS)) {
  if (only.length && !only.includes(id)) continue;
  const g = make();
  const { bytes, stats, pos } = glb(g);
  const file = join(OUT, `${g.id}.glb`);
  writeFileSync(file, bytes);
  const v = validate(readFileSync(file), g);
  const lo = [0, 1, 2].map((k) => Math.min(...pos.filter((_, m) => m % 3 === k)) * 16);
  const hi = [0, 1, 2].map((k) => Math.max(...pos.filter((_, m) => m % 3 === k)) * 16);
  const size = hi.map((x, k) => +(x - lo[k]).toFixed(2));
  const was = SIZES[id];
  const fmt = (p) => `(${p.map((x) => +x.toFixed(2)).join(', ')})`;
  console.log(`${g.id}.glb  ${g.name}: ${stats.voxels} voxels, ${stats.faces} faces as ${stats.quads} quads, ${v.tris} tris, ${stats.tiles} tiles in ${stats.atlas}, ${(bytes.length / 1024).toFixed(1)} KB`);
  console.log(`  size (px) x ${size[0]}  y ${size[1]}  z ${size[2]}  (${size.map((x, k) => `${x >= was[k] ? '+' : ''}${Math.round((x / was[k] - 1) * 100)}%`).join(' ')})   markers ${Object.entries(g.markers).map(([k, p]) => `${k} ${fmt(p)}`).join('  ')}${g.window ? `   window clear` : ''}`);
}
void cellKey;
