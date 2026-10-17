/**
 * Blockilization's voxel shapes, built in code: the units (a squad of little soldiers for foot troops,
 * riders, siege engines, tanks, ships and planes), the cities' buildings (huts to tower blocks, a
 * palace, a temple, a wonder), the map's camps and ruins, and (pictures only) the leaders' busts and
 * the wonders. Each stands on its origin facing +z, a voxel a sixteenth of a block. `models.mjs`
 * writes the models as GLBs; `pictures.mjs` draws them (and the busts and wonders) as pictures.
 */
import { Palette, Voxels } from './voxel.mjs';

// ---------------------------------------------------------------------------------------------
// Colours

export const COLOURS = {
  skin: 0xd9a27a, skin2: 0xa8724e, hair: 0x3a2618, leather: 0x8a5a32, leatherDark: 0x5e3b20, wood: 0x9a6a3c, woodDark: 0x6a4424,
  bronze: 0xc8923a, iron: 0x9aa2aa, steel: 0x6e7782, black: 0x26282c, white: 0xeeeae0, cloth: 0xd8cfb8, red: 0xb83a2e, redDark: 0x7e2620,
  blue: 0x34589a, blueDark: 0x223c6a, green: 0x5a7a3a, khaki: 0x8e8458, olive: 0x5c6440, grey: 0x8a8e92, greyDark: 0x55595e, gold: 0xe8b84a,
  purple: 0x6a3a8a, straw: 0xd8be6a, mud: 0xa88a62, stone: 0xb8b2a4, stoneDark: 0x8a857a, roof: 0xb4553a, roofDark: 0x8a3f2c, brick: 0xa4503a,
  glass: 0x8ec8e8, concrete: 0xc8c8c4, horse: 0x7a4e2c, horseDark: 0x4e3018, elephant: 0x8c8a88, camel: 0xc8a06a, canvas: 0xf0e8d0, fire: 0xffa030,
  water: 0x3a7ac0, rope: 0xc8b07a, sail: 0xf4f0e2, hull: 0x7a5232, navy: 0x6a7480, deck: 0xb08a5a, tread: 0x3a3c3e, sash: 0xd8a830, flag: 0xe8e4d8,
  // The leaders' busts and the wonders.
  skin3: 0xe8b894, skin4: 0x8a5a3a, nemes: 0x2a5aa8, jade: 0x3aa874, feather: 0x2a9a5a, feather2: 0xd04030, feather3: 0x2a6ad0, purpleDark: 0x4a2466,
  ermine: 0xf6f4ee, hairWhite: 0xdedad2, hairGrey: 0x9a968e, crimson: 0x9a1a2a, teal: 0x2a8a8a, sand: 0xe0c890, sandDark: 0xc0a468, copper: 0x5aa890,
  marbleWhite: 0xf0ece4, slate: 0x4a5560, lattice: 0x6a5040, orange: 0xe07a2a,
  adobe: 0xc08a58, adobeDark: 0x9a6a40, rose: 0xc8806a, roseDark: 0xa0604e, roseLight: 0xdc9c82, ochre: 0xc0704a, cypress: 0x3a5a2e,
  neon: 0xff4fa0,
};
export const P = new Palette();
for (const [name, hex] of Object.entries(COLOURS)) P.add(name, hex, { rough: 0.85, metal: 0, glow: name === 'fire' || name === 'neon' ? 0.8 : 0, vary: 0 });

// ---------------------------------------------------------------------------------------------
// A model: voxels in one part, boxes and helpers

export class Model {
  constructor(id) {
    this.id = id;
    this.vox = new Voxels();
  }
  /** Cells [lo, hi) filled with a colour. */
  box(lo, hi, c) {
    for (let k = lo[2]; k < hi[2]; k++) for (let j = lo[1]; j < hi[1]; j++) for (let i = lo[0]; i < hi[0]; i++) this.vox.set('m', i, j, k, c);
    return this;
  }
  set(i, j, k, c) {
    this.vox.set('m', i, j, k, c);
    return this;
  }
  /** A filled cylinder along y: centre (x, z), radius, from y0 to y1. */
  disc(x, z, r, y0, y1, c) {
    for (let k = Math.floor(z - r); k <= Math.ceil(z + r); k++)
      for (let i = Math.floor(x - r); i <= Math.ceil(x + r); i++) if ((i + 0.5 - x) ** 2 + (k + 0.5 - z) ** 2 <= r * r) this.box([i, y0, k], [i + 1, y1, k + 1], c);
    return this;
  }
  /** A wheel: a disc on its side (along x), centre (y, z). */
  wheel(x0, x1, y, z, r, c, hub) {
    for (let j = Math.floor(y - r); j <= Math.ceil(y + r); j++)
      for (let k = Math.floor(z - r); k <= Math.ceil(z + r); k++) {
        const d = (j + 0.5 - y) ** 2 + (k + 0.5 - z) ** 2;
        if (d <= r * r) this.box([x0, j, k], [x1, j + 1, k + 1], d < 1.2 && hub ? hub : c);
      }
    return this;
  }
}

// ---------------------------------------------------------------------------------------------
// People

/**
 * A little person at (x, z), facing +z: 13 voxels tall. `o`: tunic, legs, helmet ('hair', 'bronze',
 * 'iron', 'greathelm', 'tricorn', 'shako', 'brodie', 'modern', 'hood', 'hat', 'turban'), weapon
 * ('club', 'spear', 'pike', 'sword', 'greatsword', 'bow', 'crossbow', 'musket', 'rifle', 'staff',
 * 'pick', 'shovel', 'book', 'flag', 'scroll'), shield (a colour), robe (a long one), sash, y (raised).
 */
export function person(m, x, z, o = {}) {
  const y = o.y ?? 0;
  const tunic = o.tunic ?? 'cloth';
  const legs = o.legs ?? 'leatherDark';
  const skin = o.skin ?? 'skin';
  const b = (lo, hi, c) => m.box([lo[0] + x, lo[1] + y, lo[2] + z], [hi[0] + x, hi[1] + y, hi[2] + z], c);
  if (!o.seated) {
    if (o.robe) b([-3, 0, -2], [3, 5, 2], tunic);
    else {
      b([-3, 0, -1], [-1, 1, 1], 'black');
      b([1, 0, -1], [3, 1, 1], 'black');
      b([-3, 1, -1], [-1, 5, 1], legs);
      b([1, 1, -1], [3, 5, 1], legs);
    }
  }
  b([-3, 5, -2], [3, 10, 2], tunic);
  if (o.belt !== false && !o.robe) b([-3, 5, -2], [3, 6, 2], o.belt ?? 'leatherDark');
  if (o.sash) b([-1, 6, 1], [1, 10, 2], o.sash);
  // Arms, hands.
  b([-4, 6, -1], [-3, 10, 1], tunic);
  b([3, 6, -1], [4, 10, 1], tunic);
  b([-4, 5, -1], [-3, 6, 1], skin);
  b([3, 5, -1], [4, 6, 1], skin);
  // Head.
  b([-2, 10, -2], [2, 14, 2], skin);
  b([-1, 12, 1], [0, 13, 2], 'black');
  b([0, 12, 1], [1, 13, 2], 'black');
  const helm = o.helmet ?? 'hair';
  const top = (c, back = true) => {
    b([-2, 13, -2], [2, 15, 2], c);
    if (back) b([-2, 11, -2], [2, 13, -1], c);
  };
  if (helm === 'hair') top(o.hairColour ?? 'hair');
  else if (helm === 'bronze') (top('bronze'), b([-1, 15, -1], [1, 16, 1], 'red'));
  else if (helm === 'iron') top('iron');
  else if (helm === 'greathelm') (b([-2, 10, -2], [2, 15, 2], 'iron'), b([-2, 12, 1], [2, 13, 2], 'black'));
  else if (helm === 'tricorn') (b([-3, 14, -3], [3, 15, 3], 'black'), b([-2, 15, -2], [2, 16, 2], 'black'));
  else if (helm === 'shako') b([-2, 14, -2], [2, 17, 2], o.helmColour ?? 'blueDark');
  else if (helm === 'brodie') (b([-3, 14, -3], [3, 15, 3], 'olive'), b([-2, 15, -2], [2, 16, 2], 'olive'));
  else if (helm === 'modern') (top('greyDark', false), b([-2, 15, -2], [2, 16, 2], 'greyDark'));
  else if (helm === 'hood') (top(tunic), b([-2, 11, -2], [-1, 14, 2], tunic), b([1, 11, -2], [2, 14, 2], tunic));
  else if (helm === 'hat') (b([-3, 14, -3], [3, 15, 3], 'leather'), b([-2, 15, -2], [2, 17, 2], 'leather'));
  else if (helm === 'turban') (b([-2, 14, -2], [2, 16, 2], 'white'), b([-1, 16, -1], [1, 17, 1], 'white'));
  else if (helm === 'crown') (top('hair'), b([-2, 15, -2], [2, 16, 2], 'gold'));
  // The weapon in the right hand (x 4), the shield or bow on the left.
  const w = o.weapon;
  const R = (y0, y1, c, dz = 0) => b([4, y0, dz], [5, y1, dz + 1], c);
  if (w === 'club') (R(3, 9, 'wood'), R(9, 11, 'woodDark'));
  else if (w === 'spear') (R(2, 17, 'wood'), R(17, 19, 'bronze'));
  else if (w === 'pike') (R(1, 21, 'woodDark'), R(21, 24, 'iron'));
  else if (w === 'sword') (R(4, 6, 'leatherDark'), R(6, 12, 'iron'));
  else if (w === 'greatsword') (R(3, 6, 'leatherDark'), b([3, 6, 0], [6, 7, 1], 'iron'), R(7, 16, 'iron'));
  else if (w === 'musket' || w === 'rifle') (R(3, 8, w === 'musket' ? 'wood' : 'woodDark'), R(8, 16, 'steel'));
  else if (w === 'staff') R(0, 15, 'wood');
  else if (w === 'pick') (R(2, 10, 'wood'), b([3, 10, -1], [6, 11, 2], 'iron'));
  else if (w === 'shovel') (R(2, 9, 'wood'), b([4, 0, -1], [5, 2, 2], 'iron'));
  else if (w === 'book') b([1, 7, 2], [4, 9, 3], 'redDark');
  else if (w === 'scroll') b([2, 7, 2], [4, 8, 3], 'cloth');
  else if (w === 'flag') (R(0, 22, 'woodDark'), b([5, 16, 0], [11, 21, 1], o.flagColour ?? 'flag'));
  if (w === 'bow') (b([-5, 4, 0], [-4, 12, 1], 'wood'), b([-6, 3, 0], [-5, 4, 1], 'wood'), b([-6, 12, 0], [-5, 13, 1], 'wood'));
  if (w === 'crossbow') (b([-1, 7, 2], [1, 8, 6], 'wood'), b([-3, 7, 5], [3, 8, 6], 'woodDark'));
  if (o.shield) b([-5, 4, -2], [-4, 10, 2], o.shield);
  return m;
}

/** Three people in a triangle (a squad), each as `person`. */
function squad(id, o, n = 3) {
  const m = new Model(id);
  const at = n === 3 ? [[-6, 4], [6, 4], [0, -6]] : n === 2 ? [[-5, 0], [5, 0]] : [[0, 0]];
  for (const [x, z] of at) person(m, x, z, o);
  return m;
}

// ---------------------------------------------------------------------------------------------
// Animals and riders

/** A four-legged beast along z, facing +z; returns the height of its back. */
function beast(m, x, z, kind, colour) {
  const big = kind === 'elephant';
  const camel = kind === 'camel';
  const w = big ? 4 : 2;
  const legH = big ? 7 : camel ? 7 : 6;
  const len = big ? 8 : 7;
  const c = colour ?? (big ? 'elephant' : camel ? 'camel' : 'horse');
  const dark = big ? 'greyDark' : camel ? 'leather' : 'horseDark';
  for (const [lx, lz] of [[-w, -len + 1], [w - 1, -len + 1], [-w, len - 2], [w - 1, len - 2]]) m.box([x + lx, 0, z + lz], [x + lx + 1, legH, z + lz + 1], dark);
  const bodyH = big ? 7 : 4;
  m.box([x - w, legH, z - len], [x + w, legH + bodyH, z + len], c);
  if (camel) m.box([x - 1, legH + bodyH, z - 2], [x + 1, legH + bodyH + 2, z + 1], c);
  // Neck and head.
  if (big) {
    m.box([x - 3, legH + 2, z + len], [x + 3, legH + 9, z + len + 4], c);
    m.box([x - 1, 2, z + len + 3], [x + 1, legH + 2, z + len + 5], c); // trunk
    m.box([x - 3, legH + 2, z + len + 3], [x - 2, legH + 3, z + len + 6], 'white');
    m.box([x + 2, legH + 2, z + len + 3], [x + 3, legH + 3, z + len + 6], 'white');
    m.box([x - 5, legH + 4, z + len], [x - 3, legH + 9, z + len + 2], c);
    m.box([x + 3, legH + 4, z + len], [x + 5, legH + 9, z + len + 2], c);
  } else {
    const neckTop = legH + bodyH + (camel ? 6 : 5);
    m.box([x - 1, legH + 2, z + len - 1], [x + 1, neckTop, z + len + 1], c);
    m.box([x - 1, neckTop - 2, z + len + 1], [x + 1, neckTop, z + len + 4], c);
    if (!camel) m.box([x - 1, legH + 3, z + len - 2], [x + 1, neckTop + 1, z + len - 1], dark); // mane
    m.box([x - 1, legH + 1, z - len - 1], [x + 1, legH + 4, z - len], dark); // tail
  }
  return legH + bodyH;
}

/** A rider on a beast: legs astride, the person from the waist up. */
function rider(m, x, z, back, o) {
  person(m, x, z, { ...o, seated: true, y: back - 5 });
  m.box([x - 3, back - 2, z - 1], [x - 2, back + 1, z + 1], o.legs ?? 'leatherDark');
  m.box([x + 2, back - 2, z - 1], [x + 3, back + 1, z + 1], o.legs ?? 'leatherDark');
}

function mounted(id, o, kind = 'horse', two = true, colour) {
  const m = new Model(id);
  const at = two ? [[-7, 0], [7, -3]] : [[0, 0]];
  for (const [x, z] of at) {
    const back = beast(m, x, z, kind, colour);
    if (o.barding) m.box([x - 3, back - 4, z - 6], [x + 3, back, z + 6], o.barding);
    rider(m, x, z - 1, back, o);
  }
  return m;
}

// ---------------------------------------------------------------------------------------------
// Machines

function catapult(id, trebuchet) {
  const m = new Model(id);
  m.box([-6, 2, -8], [-4, 4, 8], 'wood').box([4, 2, -8], [6, 4, 8], 'wood');
  m.wheel(-7, -6, 3, -5, 3, 'woodDark').wheel(-7, -6, 3, 5, 3, 'woodDark').wheel(6, 7, 3, -5, 3, 'woodDark').wheel(6, 7, 3, 5, 3, 'woodDark');
  m.box([-4, 3, -6], [4, 4, 6], 'wood');
  if (trebuchet) {
    m.box([-5, 4, -1], [-4, 20, 1], 'wood').box([4, 4, -1], [5, 20, 1], 'wood').box([-4, 19, -1], [4, 20, 1], 'woodDark');
    m.box([-1, 8, -12], [1, 10, 14], 'woodDark').box([-2, 5, -14], [2, 9, -10], 'stoneDark');
  } else {
    m.box([-4, 4, 0], [4, 10, 1], 'wood');
    m.box([-1, 4, -8], [1, 6, 4], 'woodDark').box([-2, 6, -9], [2, 7, -5], 'rope').box([-1, 7, -8], [1, 8, -6], 'stone');
  }
  person(m, -10, -10, { tunic: 'leather', helmet: 'hair' });
  return m;
}

function cannon(id, kind) {
  const m = new Model(id);
  const long = kind === 'artillery';
  const rocket = kind === 'rocket';
  if (rocket) {
    m.box([-6, 3, -12], [6, 8, 10], 'olive').box([-5, 8, 4], [5, 13, 10], 'olive').box([-4, 10, 9], [4, 12, 11], 'glass');
    for (const x of [-6, 6]) for (const z of [-9, -1, 7]) m.wheel(x < 0 ? -8 : 6, x < 0 ? -6 : 8, 3, z, 3, 'tread', 'greyDark');
    m.box([-5, 8, -12], [5, 14, 2], 'greyDark');
    for (let i = -4; i < 5; i += 2) for (let j = 9; j < 14; j += 2) m.box([i, j, 2], [i + 1, j + 1, 3], 'black');
    return m;
  }
  const c = long ? 'olive' : 'black';
  m.wheel(-6, -4, 5, 0, 5, 'woodDark', 'iron').wheel(4, 6, 5, 0, 5, 'woodDark', 'iron');
  m.box([-4, 4, -12], [4, 6, 2], long ? 'olive' : 'wood');
  m.box([-2, 6, -4], [2, 9, long ? 22 : 14], c);
  m.box([-1, 7, long ? 22 : 14], [1, 8, long ? 23 : 15], 'black');
  if (long) m.box([-6, 6, -2], [6, 13, -1], 'olive');
  person(m, -10, -8, long ? { tunic: 'khaki', legs: 'khaki', helmet: 'brodie' } : { tunic: 'blue', legs: 'white', helmet: 'tricorn' });
  person(m, 10, -8, long ? { tunic: 'khaki', legs: 'khaki', helmet: 'brodie' } : { tunic: 'blue', legs: 'white', helmet: 'tricorn' });
  return m;
}

function gatling(id) {
  const m = new Model(id);
  m.wheel(-5, -4, 4, 0, 4, 'woodDark', 'iron').wheel(4, 5, 4, 0, 4, 'woodDark', 'iron');
  m.box([-4, 4, -8], [4, 5, 2], 'wood');
  m.box([-2, 5, -3], [2, 9, 12], 'steel');
  for (const [i, j] of [[-1, 6], [0, 6], [-1, 7], [0, 7]]) m.box([i, j, 12], [i + 1, j + 1, 13], 'black');
  person(m, -9, -6, { tunic: 'khaki', legs: 'khaki', helmet: 'brodie' });
  person(m, 9, -6, { tunic: 'khaki', legs: 'khaki', helmet: 'brodie' });
  return m;
}

function tank(id, kind) {
  const m = new Model(id);
  const old = kind === 'landship';
  const modern = kind === 'modern';
  const c = modern ? 'khaki' : 'olive';
  // Tracks.
  m.box([-9, 0, -14], [-5, 6, 14], 'tread').box([5, 0, -14], [9, 6, 14], 'tread');
  m.box([-5, 2, -13], [5, 9, 13], c);
  if (old) {
    m.box([-9, 6, -10], [-5, 10, 10], c).box([5, 6, -10], [9, 10, 10], c);
    m.box([-11, 6, -2], [-9, 9, 3], 'steel').box([9, 6, -2], [11, 9, 3], 'steel');
    m.box([-3, 9, -6], [3, 13, 6], c);
    return m;
  }
  m.box([-5, 9, -7], [5, 14, 6], c);
  m.box([-1, 10, 6], [1, 12, 26], c);
  if (modern) m.box([-5, 14, -7], [-3, 15, -5], 'black');
  else m.disc(0, -2, 2, 14, 16, c);
  return m;
}

function robot(id) {
  const m = new Model(id);
  for (const x of [-7, 4]) (m.box([x, 0, -3], [x + 4, 3, 4], 'greyDark'), m.box([x + 1, 3, -2], [x + 3, 14, 2], 'steel'));
  m.box([-8, 14, -5], [8, 26, 5], 'grey');
  m.box([-3, 26, -3], [3, 31, 3], 'grey').box([-2, 28, 3], [2, 29, 4], 'red');
  for (const x of [-12, 8]) (m.box([x, 16, -3], [x + 4, 26, 3], 'steel'), m.box([x + 1, 14, 3], [x + 3, 17, 14], 'greyDark'));
  return m;
}

function heli(id) {
  const m = new Model(id);
  const y = 14;
  m.box([-4, y, -6], [4, y + 7, 8], 'olive').box([-3, y + 2, 8], [3, y + 6, 11], 'glass');
  m.box([-1, y + 3, -22], [1, y + 6, -6], 'olive').box([-1, y + 6, -22], [1, y + 10, -19], 'olive');
  m.box([-1, y + 7, -1], [1, y + 9, 1], 'black').box([-16, y + 9, -1], [16, y + 10, 1], 'black').box([-1, y + 9, -16], [1, y + 10, 16], 'black');
  m.box([-6, y - 2, -4], [-5, y, 6], 'black').box([5, y - 2, -4], [6, y, 6], 'black');
  return m;
}

function plane(id, kind) {
  const m = new Model(id);
  const y = 18;
  const old = kind === 'triplane' || kind === 'oldbomber';
  const big = kind === 'bomber' || kind === 'oldbomber' || kind === 'stealth';
  const c = kind === 'stealth' ? 'black' : old ? 'leather' : 'grey';
  if (kind === 'stealth') {
    for (let k = 0; k < 14; k++) m.box([-2 - k * 2, y, 10 - k], [2 + k * 2, y + 2, 11 - k], 'black');
    m.box([-3, y + 2, -2], [3, y + 4, 8], 'greyDark');
    return m;
  }
  if (kind === 'missile' || kind === 'nuke') {
    const c2 = kind === 'nuke' ? 'gold' : 'white';
    m.box([-2, y, -14], [2, y + 4, 12], c2).box([-1, y + 1, 12], [1, y + 3, 15], 'red');
    m.box([-5, y + 1, -14], [5, y + 3, -10], c2).box([-1, y + 3, -14], [1, y + 7, -10], c2);
    return m;
  }
  const len = big ? 16 : 11;
  m.box([-2, y, -len], [2, y + 4, len], c);
  m.box([-1, y + 1, len], [1, y + 3, len + 1], 'black');
  const span = big ? 22 : 14;
  if (old) {
    for (const wy of kind === 'triplane' ? [y - 1, y + 3, y + 7] : [y - 1, y + 5]) m.box([-span, wy, 2], [span, wy + 1, 7], 'cloth');
    m.box([-1, y - 1, 4], [1, y + 7, 5], 'woodDark');
    m.box([-6, y + 4, len + 1], [6, y + 5, len + 2], 'woodDark');
  } else {
    for (let k = 0; k < 8; k++) m.box([-span + k, y + 1, 4 - k], [span - k, y + 2, 5 - k], c);
    m.box([-1, y + 3, 2], [1, y + 5, 6], 'glass');
  }
  m.box([-6, y + 1, -len], [6, y + 2, -len + 3], c).box([-1, y + 2, -len], [1, y + 7, -len + 3], c);
  if (big) for (const x of [-10, 10]) m.box([x - 1, y - 1, 2], [x + 2, y + 2, 9], 'greyDark');
  return m;
}

// ---------------------------------------------------------------------------------------------
// Ships

/** A hull along z: half-width w, length l (each end), from y0 to y1; its deck colour. */
function hull(m, w, l, y0, y1, c, deck = 'deck') {
  for (let k = -l; k < l; k++) {
    const t = Math.abs(k + 0.5) / l;
    const half = Math.max(1, Math.round(w * Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, t - 0.25) / 0.75, 2)))));
    m.box([-half, y0, k], [half, y1, k + 1], c);
    m.box([-half + 1, y1 - 1, k], [half - 1, y1, k + 1], deck);
  }
}
function mast(m, z, h, sail, w = 7) {
  m.box([0, 4, z], [1, h, z + 1], 'woodDark');
  if (sail) m.box([-w, h - 9, z + 1], [w + 1, h - 1, z + 2], sail);
}

function ship(id, kind) {
  const m = new Model(id);
  if (kind === 'galley') {
    hull(m, 5, 18, 0, 5, 'hull');
    mast(m, 0, 20, 'sail');
    for (let z = -12; z <= 10; z += 4) (m.box([-9, 2, z], [-5, 3, z + 1], 'wood'), m.box([5, 2, z], [9, 3, z + 1], 'wood'));
    m.box([-1, 3, 18], [1, 5, 21], 'bronze');
  } else if (kind === 'sail') {
    hull(m, 6, 20, 0, 7, 'hull');
    m.box([-5, 7, -18], [5, 10, -12], 'hull');
    mast(m, -5, 28, 'sail', 8);
    mast(m, 7, 25, 'sail', 7);
    m.box([0, 6, 20], [1, 8, 25], 'woodDark');
  } else if (kind === 'ironclad') {
    hull(m, 6, 18, 0, 5, 'greyDark', 'grey');
    m.box([-4, 5, -6], [4, 9, 6], 'greyDark');
    m.disc(0, -8, 2, 5, 13, 'black');
  } else if (kind === 'warship') {
    hull(m, 6, 24, 0, 5, 'navy', 'grey');
    m.box([-3, 5, -6], [3, 12, 4], 'navy').box([-1, 12, -2], [1, 18, 0], 'greyDark');
    for (const z of [10, -14]) (m.box([-3, 5, z], [3, 8, z + 5], 'greyDark'), m.box([-1, 6, z + (z > 0 ? 5 : -6)], [1, 7, z + (z > 0 ? 11 : 0)], 'black'));
  } else if (kind === 'sub') {
    hull(m, 3, 20, 0, 4, 'black', 'black');
    m.box([-1, 4, -2], [1, 9, 5], 'black').box([-4, 6, 0], [4, 7, 3], 'black');
  } else if (kind === 'carrier') {
    hull(m, 6, 24, 0, 5, 'navy', 'navy');
    m.box([-8, 5, -22], [8, 6, 24], 'greyDark');
    m.box([5, 6, -6], [8, 13, 4], 'navy');
    for (let z = -18; z < 22; z += 6) m.box([-1, 6, z], [0, 6.0 + 1, z + 3], 'white');
  } else if (kind === 'cargo') {
    hull(m, 6, 20, 0, 6, 'redDark', 'grey');
    for (const [z, c] of [[-4, 'blue'], [2, 'green'], [8, 'red']]) m.box([-4, 6, z], [4, 10, z + 5], c);
    m.box([-4, 6, -16], [4, 13, -10], 'white');
  } else if (kind === 'boat') {
    hull(m, 4, 9, 0, 4, 'hull');
    m.box([0, 4, 0], [1, 13, 1], 'woodDark');
    m.box([1, 8, 0], [7, 12, 1], 'sail');
    person(m, -1, -5, { tunic: 'blue', helmet: 'hat', y: 3 });
  } else if (kind === 'turtle') {
    hull(m, 6, 18, 0, 5, 'hull');
    for (let k = -14; k < 15; k++) m.box([-5, 5, k], [5, 8, k + 1], k % 3 === 0 ? 'greyDark' : 'steel');
    m.box([-1, 4, 18], [1, 8, 21], 'redDark');
  }
  return m;
}

// ---------------------------------------------------------------------------------------------
// Civilians

/** The boat an embarked land unit rides in (the unit stands on its deck, 3 voxels up): a low open hull, oars out, a small square sail. */
function transport(id) {
  const m = new Model(id);
  hull(m, 7, 16, 0, 3, 'hull');
  for (let z = -10; z <= 8; z += 6) (m.box([-11, 1, z], [-7, 2, z + 1], 'wood'), m.box([7, 1, z], [11, 2, z + 1], 'wood'));
  m.box([0, 3, -14], [1, 16, -13], 'woodDark').box([-6, 9, -13], [7, 15, -12], 'sail');
  return m;
}

function settler(id) {
  const m = new Model(id);
  // A covered wagon and an ox.
  m.box([-5, 4, -10], [5, 6, 6], 'wood');
  m.wheel(-6, -5, 4, -7, 4, 'woodDark').wheel(-6, -5, 4, 3, 4, 'woodDark').wheel(5, 6, 4, -7, 4, 'woodDark').wheel(5, 6, 4, 3, 4, 'woodDark');
  for (let k = -9; k < 6; k++) (m.box([-5, 6, k], [-4, 12, k + 1], 'canvas'), m.box([4, 6, k], [5, 12, k + 1], 'canvas'), m.box([-4, 12, k], [4, 14, k + 1], 'canvas'));
  m.box([-4, 7, -10], [4, 11, -9], 'leather');
  beast(m, 0, 15, 'horse', 'leather');
  person(m, -10, 0, { tunic: 'cloth', helmet: 'hat', weapon: 'staff' });
  return m;
}

function caravan(id) {
  const m = new Model(id);
  for (const z of [8, -10]) {
    const back = beast(m, 0, z, 'camel');
    m.box([-4, back - 3, z - 3], [-2, back + 1, z + 2], 'red').box([2, back - 3, z - 3], [4, back + 1, z + 2], 'blue');
  }
  person(m, -9, 14, { tunic: 'white', helmet: 'turban', robe: true, weapon: 'staff' });
  return m;
}

// ---------------------------------------------------------------------------------------------
// The cities' buildings and the map's sites

function hut(id) {
  const m = new Model(id);
  m.disc(0, 0, 5, 0, 6, 'mud');
  for (let j = 0; j < 6; j++) m.disc(0, 0, 6 - j, 6 + j, 7 + j, 'straw');
  m.box([-1, 0, 4], [1, 4, 6], 'woodDark');
  return m;
}

/** A gabled house: footprint w x d, walls h high, then the roof. */
function house(id, w, d, h, wall, roof, o = {}) {
  const m = new Model(id);
  const hw = w / 2;
  const hd = d / 2;
  m.box([-hw, 0, -hd], [hw, h, hd], wall);
  for (let j = 0; j <= hw; j++) m.box([-hw - 1 + j, h + j, -hd - 1], [hw + 1 - j, h + j + 1, hd + 1], j === hw ? (o.ridge ?? roof) : roof);
  m.box([-1, 0, hd], [1, 4, hd + 1], 'woodDark');
  // Windows set in the walls (not standing out of them: flat walls mesh into a few faces).
  for (let y = 4; y < h - 1; y += 4)
    for (let x = -hw + 2; x < hw - 1; x += 4) (m.box([x, y, hd - 1], [x + 1, y + 2, hd], o.window ?? 'woodDark'), m.box([x, y, -hd], [x + 1, y + 2, -hd + 1], o.window ?? 'woodDark'));
  if (o.chimney) m.box([hw - 3, h, -2], [hw - 1, h + hw + 4, 0], o.chimney);
  return m;
}

function tower(id, wall = 'stone') {
  const m = new Model(id);
  m.box([-4, 0, -4], [4, 22, 4], wall);
  m.box([-5, 22, -5], [5, 24, 5], wall);
  for (const [x, z] of [[-5, -5], [-1, -5], [3, -5], [-5, 3], [-1, 3], [3, 3], [-5, -1], [3, -1]]) m.box([x, 24, z], [x + 2, 26, z + 2], wall);
  m.box([-1, 0, 4], [1, 5, 5], 'woodDark');
  m.box([-1, 12, 4], [1, 15, 5], 'black');
  return m;
}

/**
 * A block of flats or a tower: floors of `wall` with a band of windows (`win`) round each, set in
 * between the corners (bands, not a window apiece: a tower of them meshes into a few hundred faces,
 * not thousands).
 */
function block(id, w, h, wall, win) {
  const m = new Model(id);
  m.box([-w, 0, -w], [w, h, w], wall);
  for (let y = 3; y < h - 1; y += 3) {
    m.box([-w + 1, y, w - 1], [w - 1, y + 2, w], win).box([-w + 1, y, -w], [w - 1, y + 2, -w + 1], win);
    m.box([w - 1, y, -w + 1], [w, y + 2, w - 1], win).box([-w, y, -w + 1], [-w + 1, y + 2, w - 1], win);
  }
  m.box([-w + 1, h, -w + 1], [w - 1, h + 1, w - 1], 'greyDark');
  return m;
}

function palace(id) {
  const m = new Model(id);
  m.box([-10, 0, -8], [10, 3, 8], 'stoneDark');
  m.box([-9, 3, -7], [9, 12, 7], 'stone');
  for (let x = -8; x <= 8; x += 4) m.box([x, 3, 7], [x + 1, 12, 8], 'white');
  m.box([-10, 12, -8], [10, 14, 8], 'stone');
  for (let j = 0; j < 6; j++) m.disc(0, 0, 6 - j, 14 + j, 15 + j, 'gold');
  m.box([0, 20, 0], [1, 25, 1], 'woodDark').box([1, 22, 0], [5, 25, 1], 'red');
  return m;
}

function temple(id) {
  const m = new Model(id);
  m.box([-7, 0, -9], [7, 2, 9], 'stone');
  for (let x = -6; x <= 5; x += 3) for (const z of [-8, 7]) m.box([x, 2, z], [x + 1, 10, z + 1], 'white');
  m.box([-5, 2, -6], [5, 10, 6], 'stoneDark');
  m.box([-7, 10, -9], [7, 11, 9], 'white');
  for (let j = 0; j < 4; j++) m.box([-7 + j * 2, 11 + j, -9], [7 - j * 2, 12 + j, 9], 'roof');
  return m;
}

function wonder(id) {
  const m = new Model(id);
  // A stepped ziggurat with a golden top.
  for (let j = 0; j < 6; j++) m.box([-10 + j * 2, j * 3, -10 + j * 2], [10 - j * 2, j * 3 + 3, 10 - j * 2], j % 2 ? 'stone' : 'straw');
  m.box([-1, 18, -1], [1, 24, 1], 'gold');
  return m;
}

function factory(id) {
  const m = house(id, 14, 10, 8, 'brick', 'greyDark', { window: 'glass' });
  m.box([3, 0, -3], [6, 24, 0], 'brick').box([3, 24, -3], [6, 25, 0], 'black');
  return m;
}

/**
 * A city's wall: a straight stretch 20 voxels long (along x, its middle on the origin), `h` high and
 * `t` thick, crenellated on top unless `flat` (a modern one: concrete, plain).
 */
function wall(id, c, h, t, flat = false) {
  const m = new Model(id);
  const z0 = -Math.floor(t / 2);
  const z1 = z0 + t;
  m.box([-10, 0, z0], [10, h, z1], c);
  if (!flat) for (let x = -10; x < 10; x += 2) m.box([x, h, z0], [x + 1, h + 2, z1], c);
  else m.box([-10, h, z0 - 1], [10, h + 1, z1 + 1], 'greyDark');
  return m;
}

/** A wall's tower, at each corner of a city's walls: `w` across, `h` high, crenellated (or flat-roofed). */
function wallTower(id, c, w, h, flat = false) {
  const m = new Model(id);
  m.box([-w / 2, 0, -w / 2], [w / 2, h, w / 2], c);
  if (flat) return m.box([-w / 2 - 1, h, -w / 2 - 1], [w / 2 + 1, h + 1, w / 2 + 1], 'greyDark');
  m.box([-w / 2 - 1, h, -w / 2 - 1], [w / 2 + 1, h + 1, w / 2 + 1], c);
  for (let x = -w / 2 - 1; x < w / 2 + 1; x += 2) for (const z of [-w / 2 - 1, w / 2]) m.box([x, h + 1, z], [x + 1, h + 3, z + 1], c);
  for (let z = -w / 2 + 1; z < w / 2; z += 2) for (const x of [-w / 2 - 1, w / 2]) m.box([x, h + 1, z], [x + 1, h + 3, z + 1], c);
  return m;
}

/** What ranged attacks throw, flying along +z: a volley of three arrows, a catapult's boulder, a cannon's shell. */
function arrows(id) {
  const m = new Model(id);
  for (const [x, y, z] of [[-3, 0, 0], [3, 1, -2], [0, 3, 1]]) {
    m.box([x, y, z - 6], [x + 1, y + 1, z + 5], 'wood');
    m.box([x, y, z + 5], [x + 1, y + 1, z + 7], 'iron');
    m.box([x - 1, y, z - 7], [x + 2, y + 1, z - 5], 'white');
  }
  return m;
}
function boulder(id, c, r) {
  const m = new Model(id);
  for (let j = -r; j <= r; j++) m.disc(0, 0, Math.sqrt(Math.max(0, r * r - j * j)) + 0.3, j, j + 1, c);
  return m;
}

function camp(id) {
  const m = new Model(id);
  for (const [x, z, c] of [[-7, -4, 'leather'], [6, -6, 'redDark'], [0, 8, 'leather']]) for (let j = 0; j < 7; j++) m.disc(x, z, 5 - j * 0.7, j, j + 1, c);
  m.disc(0, -1, 1.5, 0, 1, 'black').box([0, 1, -1], [1, 3, 0], 'fire');
  person(m, 9, 6, { tunic: 'leather', helmet: 'hair', weapon: 'club', skin: 'skin2' });
  return m;
}

/** A bird for the flocks over the woods: a body and two wings, spread (`up`: raised at a wingbeat's top). */
function bird(id, up) {
  const m = new Model(id);
  m.box([0, 0, -2], [1, 1, 2], 'black').set(0, 0, 2, 'gold');
  for (const side of [-1, 1])
    for (let i = 1; i <= 4; i++) {
      const x = side < 0 ? -i : i;
      const lift = up ? Math.min(i, 2) : i > 2 ? -1 : 0;
      m.set(x, lift, 0, 'black').set(x, lift, -1, i < 3 ? 'black' : 'greyDark');
    }
  return m;
}

/** The spaceship at its launch (the science victory): a rocket of white and black bands, red fins, its nose cone. */
function spaceship(id) {
  const m = new Model(id);
  m.box([-3, 0, -3], [3, 34, 3], 'white');
  for (let y = 6; y < 34; y += 9) m.box([-3, y, -3], [3, y + 1, 3], 'black');
  for (let j = 0; j < 6; j++) {
    const k = Math.floor(j / 2);
    m.box([-3 + k, 34 + j, -3 + k], [3 - k, 35 + j, 3 - k], j > 3 ? 'red' : 'white');
  }
  for (const [x, z, w, d] of [[-6, -1, 3, 2], [3, -1, 3, 2], [-1, -6, 2, 3], [-1, 3, 2, 3]]) m.box([x, 0, z], [x + w, 8, z + d], 'red');
  m.box([-2, -2, -2], [2, 0, 2], 'black');
  return m;
}

function ruin(id) {
  const m = new Model(id);
  m.box([-8, 0, -8], [8, 1, 8], 'stoneDark');
  for (const [x, z, h] of [[-6, -6, 10], [5, -6, 6], [-6, 5, 4], [5, 5, 12]]) m.box([x, 1, z], [x + 2, h, z + 2], 'stone');
  m.box([-6, 10, -6], [7, 11, -4], 'stone');
  m.box([-2, 1, -1], [3, 3, 2], 'gold');
  return m;
}

// ---------------------------------------------------------------------------------------------
// The models

export const MODELS = [
  // Foot.
  squad('u_warrior', { tunic: 'leather', legs: 'leatherDark', helmet: 'hair', weapon: 'club' }),
  squad('u_spear', { tunic: 'red', legs: 'leatherDark', helmet: 'bronze', weapon: 'spear', shield: 'bronze' }),
  squad('u_pike', { tunic: 'blue', legs: 'blueDark', helmet: 'iron', weapon: 'pike' }),
  squad('u_sword', { tunic: 'red', legs: 'leatherDark', helmet: 'iron', weapon: 'sword', shield: 'redDark' }),
  squad('u_longsword', { tunic: 'iron', legs: 'steel', helmet: 'greathelm', weapon: 'greatsword', belt: 'red' }),
  squad('u_bow', { tunic: 'green', legs: 'leatherDark', helmet: 'hood', weapon: 'bow' }),
  squad('u_crossbow', { tunic: 'redDark', legs: 'leatherDark', helmet: 'iron', weapon: 'crossbow' }),
  squad('u_musket', { tunic: 'red', legs: 'white', helmet: 'tricorn', weapon: 'musket', belt: 'white' }),
  squad('u_rifle', { tunic: 'blue', legs: 'blueDark', helmet: 'shako', weapon: 'rifle' }),
  squad('u_infantry', { tunic: 'khaki', legs: 'khaki', helmet: 'brodie', weapon: 'rifle' }),
  squad('u_mech', { tunic: 'olive', legs: 'olive', helmet: 'modern', weapon: 'rifle', belt: 'black' }),
  squad('u_scout', { tunic: 'leather', legs: 'leatherDark', helmet: 'hat', weapon: 'staff' }, 1),
  squad('u_worker', { tunic: 'cloth', legs: 'leather', helmet: 'hat', weapon: 'pick' }, 2),
  squad('u_missionary', { tunic: 'white', helmet: 'hood', robe: true, weapon: 'book' }, 1),
  squad('u_inquisitor', { tunic: 'redDark', helmet: 'hood', robe: true, weapon: 'book' }, 1),
  squad('u_prophet', { tunic: 'white', helmet: 'hair', hairColour: 'white', robe: true, weapon: 'staff', sash: 'gold' }, 1),
  squad('u_great', { tunic: 'purple', helmet: 'hair', robe: true, weapon: 'scroll', sash: 'gold' }, 1),
  // Riders.
  mounted('u_horse', { tunic: 'leather', helmet: 'hair', weapon: 'spear' }),
  mounted('u_knight', { tunic: 'iron', helmet: 'greathelm', weapon: 'pike', barding: 'red', shield: 'blue' }),
  mounted('u_cavalry', { tunic: 'blue', legs: 'blueDark', helmet: 'shako', weapon: 'sword' }),
  mounted('u_elephant', { tunic: 'red', helmet: 'turban', weapon: 'spear' }, 'elephant', false),
  mounted('u_camel', { tunic: 'white', helmet: 'turban', weapon: 'bow' }, 'camel'),
  mounted('u_general', { tunic: 'blue', helmet: 'crown', weapon: 'flag', flagColour: 'gold', barding: 'gold' }, 'horse', false, 'white'),
  (() => {
    const m = new Model('u_chariot');
    beast(m, -4, 14, 'horse');
    beast(m, 4, 14, 'horse');
    m.box([-5, 3, -6], [5, 5, 4], 'wood').box([-5, 5, -6], [5, 9, -5], 'wood').box([-5, 5, -6], [-4, 9, 4], 'wood').box([4, 5, -6], [5, 9, 4], 'wood');
    m.wheel(-7, -5, 4, -1, 4, 'woodDark', 'bronze').wheel(5, 7, 4, -1, 4, 'woodDark', 'bronze');
    person(m, 0, -2, { tunic: 'red', helmet: 'bronze', weapon: 'bow', y: 2 });
    return m;
  })(),
  // Machines.
  catapult('u_catapult', false),
  catapult('u_trebuchet', true),
  cannon('u_cannon', 'cannon'),
  cannon('u_artillery', 'artillery'),
  cannon('u_rocket', 'rocket'),
  gatling('u_gatling'),
  tank('u_landship', 'landship'),
  tank('u_tank', 'tank'),
  tank('u_armor', 'modern'),
  robot('u_robot'),
  heli('u_heli'),
  plane('u_triplane', 'triplane'),
  plane('u_oldbomber', 'oldbomber'),
  plane('u_fighter', 'fighter'),
  plane('u_bomber', 'bomber'),
  plane('u_stealth', 'stealth'),
  plane('u_missile', 'missile'),
  plane('u_nuke', 'nuke'),
  // Ships.
  ship('u_galley', 'galley'),
  ship('u_turtle', 'turtle'),
  ship('u_sail', 'sail'),
  ship('u_ironclad', 'ironclad'),
  ship('u_warship', 'warship'),
  ship('u_sub', 'sub'),
  ship('u_carrier', 'carrier'),
  ship('u_cargo', 'cargo'),
  ship('u_boat', 'boat'),
  transport('u_transport'),
  // Civilians.
  settler('u_settler'),
  caravan('u_caravan'),
  // Cities.
  hut('c_hut'),
  house('c_house', 10, 8, 6, 'mud', 'roof'),
  house('c_stone', 10, 10, 8, 'stone', 'roofDark'),
  house('c_brick', 10, 10, 14, 'brick', 'greyDark', { window: 'glass', chimney: 'brick' }),
  block('c_block', 5, 30, 'concrete', 'glass'),
  block('c_tower', 6, 46, 'glass', 'blueDark'),
  tower('c_keep'),
  palace('c_palace'),
  temple('c_temple'),
  wonder('c_wonder'),
  factory('c_factory'),
  // Walls: stone walls, a castle's, and an arsenal's or military base's concrete.
  wall('c_wall1', 'stone', 6, 3),
  wallTower('c_tower1', 'stone', 6, 8),
  wall('c_wall2', 'stoneDark', 9, 4),
  wallTower('c_tower2', 'stoneDark', 8, 13),
  wall('c_wall3', 'concrete', 5, 3, true),
  wallTower('c_tower3', 'concrete', 6, 7, true),
  // What ranged attacks throw.
  arrows('p_arrows'),
  boulder('p_stone', 'stoneDark', 3),
  boulder('p_shell', 'black', 2),
  // The map.
  camp('m_camp'),
  ruin('m_ruin'),
  bird('m_bird', false),
  bird('m_bird2', true),
  spaceship('m_ship'),
];
