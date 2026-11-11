import { PLAIN_LOOK, type CharacterLook, type TopStyle } from './look';
import { DIRS, Palette, Voxels, bake, cellKey, cellOf, quadMesh, type Colouring } from './voxels';

/**
 * The platform's characters, built from a look (`CharacterLook`) as micro-voxel figures on the
 * humanoid rig: the people of Call of Blocky and Blockfront II (their build tools, `fighters/` and
 * `troopers/build.mjs`, which this follows), made on each screen from a player's avatar or a
 * game's description instead of a file.
 *
 * - Voxels: 52 a metre (`SUB` to each design unit of 1/26 m, the size the fighters are drawn
 *   at), so a figure is about 96 voxels tall, with lean, stylized proportions: a big head (a
 *   quarter of the height), a neck, long legs, round arms that taper to the wrist, small fists
 *   with a thumb and finger creases, trim shoes. One voxel part per joint of the rig
 *   (docs/HUMANOID.md), painted in code in design units: shapes (rounded boxes, tapered limbs,
 *   balls) filled voxel by voxel, coloured by region (collars, sleeves, belts, stripes, prints),
 *   details half a unit thick placed voxel by voxel (faces, ties, buttons, laces). Every part is
 *   a closed surface; where two meet, one reaches into the other, so bends open no gaps.
 * - Rig: joints hips > spine > chest > neck > head; chest > upperArmL > lowerArmL > handL > gripL
 *   (and the R mirror); hips > upperLegL > lowerLegL > footL (and R), where the proportions put
 *   them; standing straight, the arms hanging. `gripR` / `gripL` are at the middle of each fist,
 *   turned (`GRIPS`) as the hands close on a gun: the right forearm behind the grip, the left
 *   hand under the handguard.
 * - Mesh: every vertex wholly on its part's joint (rigid skinning), one mesh and one material;
 *   faces merged into quads whatever their colours, each drawn into an atlas (`bake`).
 */

// ---------------------------------------------------------------------------------------------
// The rig

export const JOINT_PARENT = {
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
} as const;
export type CharacterJoint = keyof typeof JOINT_PARENT;
export const JOINTS = Object.keys(JOINT_PARENT) as CharacterJoint[];
/** The joints that are bones (the grips are empties). */
export const BONES = JOINTS.filter((j) => j !== 'gripL' && j !== 'gripR');
const SIDES = [['L', 1], ['R', -1]] as const;

/** Metres a design unit: the builder's measures (heights, widths, the joints) are in these. */
export const VOXEL = 1 / 26;
/** Voxels a design unit, each way: the figure's micro-voxels are half a design unit, 52 a metre. */
export const SUB = 2;
/** Metres a voxel. */
export const CELL = VOXEL / SUB;

// ---------------------------------------------------------------------------------------------
// Shapes (design units). The figure's voxels are cells of half a design unit: shapes are filled
// cell by cell (a cell's centre is ((i + 0.5) / SUB, …)), so their curves are as fine as the
// voxels; details are placed by design cell (`Blocks.set`: a block of SUB x SUB x SUB voxels, or
// the layer of them on one of its faces), or voxel by voxel (`Blocks.cells`).

type P3 = [number, number, number];
type Paintable = string | ((i: number, j: number, k: number) => Colouring);
/** The layer of a design cell's voxels on one of its faces: something half a unit thick. */
type Layer = '-x' | '+x' | '-y' | '+y' | '-z' | '+z';

/** A design cell's centre. */
const C = (i: number) => i + 0.5;
/** A voxel's centre (design units). */
const fc = (i: number) => (i + 0.5) / SUB;
const down = (i: number) => Math.floor(i / SUB);
const lerp = (a: number, b: number, t: number) => a + (b - a) * (t < 0 ? 0 : t > 1 ? 1 : t);
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * A figure's voxels, reached by design cell: each design cell is a block of SUB x SUB x SUB voxels
 * (`cells`: the voxels themselves, a part per joint).
 */
class Blocks {
  readonly cells = new Voxels();
  get parts() {
    return this.cells.parts;
  }
  part(name: string) {
    return this.cells.part(name);
  }
  /** Colour a design cell: all of it, or only the `layer` of voxels on one of its faces. */
  set(part: string, i: number, j: number, k: number, colour: string, layer?: Layer) {
    const span = (axis: string) => (layer?.[1] !== axis ? [0, SUB] : layer[0] === '-' ? [0, 1] : [SUB - 1, SUB]);
    const [a0, a1] = span('x');
    const [b0, b1] = span('y');
    const [c0, c1] = span('z');
    for (let c = c0; c < c1; c++) for (let b = b0; b < b1; b++) for (let a = a0; a < a1; a++) this.cells.set(part, i * SUB + a, j * SUB + b, k * SUB + c, colour);
  }
  /** A design cell's colour (its first voxel's that has one). */
  get(part: string, i: number, j: number, k: number): string | undefined {
    for (let c = 0; c < SUB; c++)
      for (let b = 0; b < SUB; b++)
        for (let a = 0; a < SUB; a++) {
          const v = this.cells.get(part, i * SUB + a, j * SUB + b, k * SUB + c);
          if (v) return v;
        }
    return undefined;
  }
  del(part: string, i: number, j: number, k: number) {
    for (let c = 0; c < SUB; c++) for (let b = 0; b < SUB; b++) for (let a = 0; a < SUB; a++) this.cells.del(part, i * SUB + a, j * SUB + b, k * SUB + c);
  }
  /** Has a design cell any voxel of this part (or, without one, of any)? `whole`: is all of it filled? */
  filled(i: number, j: number, k: number, part?: string, whole = false): boolean {
    for (let c = 0; c < SUB; c++)
      for (let b = 0; b < SUB; b++)
        for (let a = 0; a < SUB; a++) {
          const f = this.cells.filled(i * SUB + a, j * SUB + b, k * SUB + c, part);
          if (f !== whole) return f;
        }
    return whole;
  }
  /** Recolour a part's voxels by the design cell each is in. */
  recolour(part: string, fn: (i: number, j: number, k: number, colour: string) => Colouring) {
    this.cells.recolour(part, (i, j, k, c) => fn(down(i), down(j), down(k), c));
  }
}

/** Inside a box (faces lo..hi) rounded by r (a number or one per axis) on its edges. */
function inRound(p: number[], lo: number[], hi: number[], r: number | number[]): boolean {
  let d2 = 0;
  for (let a = 0; a < 3; a++) {
    const ra = Array.isArray(r) ? r[a] : r;
    if (p[a] < lo[a] || p[a] > hi[a]) return false;
    if (ra <= 0) continue;
    const q = Math.max(lo[a] + ra - p[a], 0, p[a] - (hi[a] - ra));
    d2 += (q / ra) ** 2;
  }
  return d2 <= 1.0001;
}
const inEllipsoid = (p: number[], c: number[], r: number[]) => ((p[0] - c[0]) / r[0]) ** 2 + ((p[1] - c[1]) / r[1]) ** 2 + ((p[2] - c[2]) / r[2]) ** 2 <= 1;
const inBall = (p: number[], c: number[], r: number) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2 <= r * r;
/** Inside a limb's section at height: a circle squared off a little (a superellipse) of radius r about (cx, cz). */
const inLimb = (p: number[], cx: number, cz: number, r: number, n = 2.8) => r > 0 && Math.abs((p[0] - cx) / r) ** n + Math.abs((p[2] - cz) / r) ** n <= 1;

/**
 * Fill a part: the voxels whose centres lie in lo..hi (design units) and that `inside` accepts,
 * coloured `colour` (or by a function of the design cell each is in).
 */
function fill(vox: Blocks, part: string, lo: number[], hi: number[], colour: Paintable, inside: ((p: number[]) => boolean) | null = null) {
  const f = typeof colour === 'function' ? colour : () => colour;
  vox.cells.paint(part, lo.map((v) => Math.floor(v * SUB)), hi.map((v) => Math.ceil(v * SUB)), (i, j, k) => {
    const p = [fc(i), fc(j), fc(k)];
    if (p[0] < lo[0] || p[0] > hi[0] || p[1] < lo[1] || p[1] > hi[1] || p[2] < lo[2] || p[2] > hi[2]) return;
    if (inside && !inside(p)) return;
    return f(down(i), down(j), down(k));
  });
}

/** Each voxel whose centre lies in lo..hi (design units): `fn(p, i, j, k)`, its centre and its cell. */
function each(lo: number[], hi: number[], fn: (p: number[], i: number, j: number, k: number) => void) {
  for (let k = Math.floor(lo[2] * SUB); k < Math.ceil(hi[2] * SUB); k++)
    for (let j = Math.floor(lo[1] * SUB); j < Math.ceil(hi[1] * SUB); j++)
      for (let i = Math.floor(lo[0] * SUB); i < Math.ceil(hi[0] * SUB); i++) {
        const p = [fc(i), fc(j), fc(k)];
        if (p[0] < lo[0] || p[0] > hi[0] || p[1] < lo[1] || p[1] > hi[1] || p[2] < lo[2] || p[2] > hi[2]) continue;
        fn(p, i, j, k);
      }
}

/**
 * Cloth (or a plate) over a part: the empty voxels across a face from its surface whose centres
 * `where` accepts, a voxel proud. `axes`: the ways it grows ('xz': out to the sides, front and
 * back only, its top and bottom edges flush).
 */
function coat(vox: Blocks, part: string, colour: string, where: (p: number[]) => boolean, axes = 'xyz') {
  const cells = vox.parts.get(part)!;
  const add = new Map<number, P3>();
  for (const key of cells.keys()) {
    const [i, j, k] = cellOf(key);
    for (const { n: d } of DIRS) {
      if (!axes.includes('xyz'[d[0] ? 0 : d[1] ? 1 : 2])) continue;
      const q: P3 = [i + d[0], j + d[1], k + d[2]];
      const qk = cellKey(q[0], q[1], q[2]);
      if (cells.has(qk) || add.has(qk) || !where(q.map(fc))) continue;
      add.set(qk, q);
    }
  }
  for (const q of add.values()) vox.cells.set(part, q[0], q[1], q[2], colour);
}

/** A part's frontmost (+z) design cell at column (i, j), or null; `backOf` its rearmost. */
function frontOf(vox: Blocks, part: string, i: number, j: number): number | null {
  for (let k = 40; k > -40; k--) if (vox.filled(i, j, k, part)) return k;
  return null;
}
function backOf(vox: Blocks, part: string, i: number, j: number): number | null {
  for (let k = -40; k < 40; k++) if (vox.filled(i, j, k, part)) return k;
  return null;
}
/** A deterministic hash of a cell, 0..1. */
function hash(i: number, j: number, k: number, salt = 0): number {
  let h = Math.imul(i * 73856093 ^ j * 19349663 ^ k * 83492791 ^ Math.imul(salt, 2654435761), 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------------------------
// Builds: widths in design units (the heights are everyone's). The arms hang beside the chest
// (`sh` its half-width), the legs from under the pelvis a voxel either side of the middle. Curvy
// builds have a bust and a waist a voxel in, on the same limbs.

interface Build {
  sh: number;
  waist: number;
  hip: number;
  arm: number;
  leg: number;
  belly: number;
  bust: number;
}
const BUILDS: Record<string, Build> = {
  slim: { sh: 6, waist: 5, hip: 5, arm: 4, leg: 4, belly: 0, bust: 0 },
  broad: { sh: 7, waist: 6, hip: 6, arm: 4, leg: 5, belly: 0, bust: 0 },
  heavy: { sh: 7, waist: 7, hip: 6, arm: 5, leg: 5, belly: 2, bust: 0 },
  slimCurvy: { sh: 6, waist: 4, hip: 5, arm: 4, leg: 4, belly: 0, bust: 1 },
  broadCurvy: { sh: 7, waist: 5, hip: 6, arm: 4, leg: 5, belly: 0, bust: 1 },
  heavyCurvy: { sh: 7, waist: 6, hip: 6, arm: 5, leg: 5, belly: 1, bust: 1 },
};

/**
 * Heights (design units, from the soles): shoes to 3, shins to 11, thighs to 20 (under the pelvis
 * from 17), the pelvis to 22 (its top row the belt), the belly to 26, the chest to 34 (the
 * shoulders' pivots at 32), two rows of neck, the head from 36 to 48; the arms reach mid-thigh.
 * Below `split` a skirt hangs from the thighs.
 */
const Y = { ankle: 3, knee: 11, pelvis: 17, split: 18, hipJoint: 19.5, hips: 20, belt: 21, spine: 22, chest: 26, shoulder: 32, chestTop: 34, neck: 34, head: 36, crown: 48, elbow: 25.5, wrist: 19 };
/** The torso's front row of cells (k), and the head's face row (in its own space). */
const F = 3;
const FACE = 4;

/** Where a build's limbs are (design units, the figure's left; the right mirrors). */
function limbs(b: Build) {
  const ax = b.sh + b.arm / 2;
  const lx0 = 1;
  const lx1 = 1 + b.leg;
  const lz0 = b.leg % 2 ? -2 : -3;
  const lz1 = lz0 + b.leg;
  return { ax, lx0, lx1, lx: (lx0 + lx1) / 2, lz0, lz1, lz: (lz0 + lz1) / 2 };
}

/** The joints (design units, the figure's space: +x its left, +z ahead). */
function joints(b: Build): Record<CharacterJoint, P3> {
  const L = limbs(b);
  const J: Partial<Record<CharacterJoint, P3>> = {
    hips: [0, Y.hips, 0],
    spine: [0, Y.spine, 0],
    chest: [0, Y.chest, 0],
    neck: [0, Y.neck, -1],
    head: [0, Y.head, -1],
    upperArmL: [L.ax, Y.shoulder, 0],
    lowerArmL: [L.ax, Y.elbow, 0],
    handL: [L.ax, Y.wrist, 0],
    upperLegL: [L.lx, Y.hipJoint, L.lz],
    lowerLegL: [L.lx, Y.knee, L.lz],
    footL: [L.lx, Y.ankle, L.lz],
  };
  for (const k of Object.keys(J) as CharacterJoint[]) if (k.endsWith('L')) J[(k.slice(0, -1) + 'R') as CharacterJoint] = [-J[k]![0], J[k]![1], J[k]![2]];
  J.gripR = [-L.ax, Y.wrist - 2.5, 0];
  J.gripL = [L.ax, Y.wrist - 2.5, 0];
  return J as Record<CharacterJoint, P3>;
}

/**
 * How the fists take a gun (each grip's turn in its hand, which hangs below the wrist closed round
 * a hold that runs fore and aft through it). The right takes a pistol grip with the forearm behind
 * the gun, nearly in line with the barrel, the wrist cocked a little; the left cups the handguard
 * from underneath, its wrist below the gun and out to the left. (Anything else is held across the
 * hand, its handle through the fist: the figures kit's `across`.)
 */
const GRIPS: { gripL: P3; gripR: P3 } = { gripR: [1.2, 0, 0], gripL: [0, 0, 2.5] };

// ---------------------------------------------------------------------------------------------
// What a top is: how its sleeves and collar go, what's on it.

interface TopKit {
  sleeves: 'long' | 'short' | 'elbow' | 'rolled' | 'none';
  collar: 'crew' | 'open' | 'shirt' | 'camp' | 'track' | 'scoop' | 'none';
  /** Tucked in (a belt shows), or hanging over the waistband. */
  tucked?: boolean;
  /** A suit's or jacket's lapels and skirt, the shirt inside (`open`: worn open, a tee under it). */
  jacket?: boolean;
  open?: boolean;
  tie?: boolean;
  /** Ribbed cuffs and hem. */
  rib?: boolean;
  buttons?: boolean;
  hood?: boolean;
  zip?: boolean;
  stripes?: boolean;
  panels?: boolean;
  flowers?: boolean;
  knit?: boolean;
  tunic?: boolean;
  apron?: boolean;
  /** Its cloth shines (leather). */
  shine?: boolean;
  /** No shirt at all: a skeleton's ribs. */
  ribs?: boolean;
}
const TOPS: Record<TopStyle, TopKit> = {
  tee: { sleeves: 'short', collar: 'crew' },
  shirt: { sleeves: 'long', collar: 'open', tucked: true, buttons: true, rib: true },
  hoodie: { sleeves: 'long', collar: 'none', rib: true, hood: true },
  sweater: { sleeves: 'long', collar: 'crew', rib: true, knit: true },
  suit: { sleeves: 'long', collar: 'shirt', jacket: true, tie: true, tucked: true },
  jacket: { sleeves: 'long', collar: 'crew', jacket: true, open: true, tucked: true, shine: true },
  track: { sleeves: 'long', collar: 'track', zip: true, stripes: true, rib: true },
  camp: { sleeves: 'short', collar: 'camp', panels: true, buttons: true },
  aloha: { sleeves: 'short', collar: 'camp', flowers: true },
  tank: { sleeves: 'none', collar: 'scoop' },
  tunic: { sleeves: 'elbow', collar: 'crew', tunic: true },
  apron: { sleeves: 'rolled', collar: 'open', tucked: true, apron: true },
  ribs: { sleeves: 'none', collar: 'none', ribs: true },
};

interface Spec {
  b: Build;
  look: Required<CharacterLook>;
  top: TopKit;
}

// ---------------------------------------------------------------------------------------------
// The body: every part a closed voxel volume on its joint, in its base colour ('pants' the pelvis
// and legs, 'top' the belly, chest and arms, 'skin' the neck and fists, 'shoes' on a 'sole').

function body(vox: Blocks, s: Spec) {
  const { b } = s;
  const L = limbs(b);
  const sh = b.sh;
  const W = b.waist;
  const H = b.hip;
  // Pelvis (hips): the seat, its top row the belt.
  fill(vox, 'hips', [-H, Y.pelvis, -4], [H, Y.spine, 4], 'pants', (p) => inRound(p, [-H, Y.pelvis - 2, -4], [H, Y.spine, 4], [1.7, 0, 1.7]));
  // Belly (spine): the waist; into the pelvis and the chest.
  const bz = 4 + b.belly;
  fill(vox, 'spine', [-W, Y.spine, -4], [W, Y.chest, bz], 'top', (p) => inRound(p, [-W, Y.spine - 2, -4], [W, Y.chest + 2, bz], [1.7, 0, 1.6 + b.belly * 0.8]));
  fill(vox, 'spine', [-W + 1, Y.spine - 2, -3], [W - 1, Y.spine, 3], 'top');
  fill(vox, 'spine', [-W + 1, Y.chest, -3], [W - 1, Y.chest + 2, 3], 'top');
  // Chest: widening from the waist to squared shoulders rounded over the top, a bust on the curvy builds.
  const half = (y: number) => lerp(Math.max(W, sh - 1), sh, ease((y - Y.chest) / 3));
  fill(vox, 'chest', [-sh, Y.chest, -4], [sh, Y.chestTop, 4 + b.bust], 'top', (p) => {
    const w = half(p[1]);
    if (inRound(p, [-w, Y.chest - 4, -4], [w, Y.chestTop, 4], [2.2, 2.4, 1.7])) return true;
    return !!b.bust && inRound(p, [-sh + 1, Y.chest + 1, 0], [sh - 1, Y.chest + 5, 4 + b.bust], [1.4, 1.4, 1.2]);
  });
  // Neck: round, into the chest below and the head above.
  fill(vox, 'neck', [-2, Y.chestTop - 1, -3], [2, Y.head + 1, 1], 'skin', (p) => inLimb(p, 0, -1, 2, 2.4));
  head(vox, s);
  // Arms, round and tapering: the upper arm (a dome over the shoulder, narrowing to the elbow),
  // the forearm (a ball at the elbow, inside the upper arm until it bends; narrowing to the
  // wrist), the hand.
  for (const [side, m] of SIDES) {
    const cx = m * L.ax;
    const r = b.arm / 2;
    fill(vox, `upperArm${side}`, [cx - r, Y.elbow, -r], [cx + r, Y.chestTop, r], 'top', (p) => {
      let rr = lerp(r * 0.84, r, (p[1] - Y.elbow) / (Y.shoulder - 1 - Y.elbow));
      if (p[1] > Y.shoulder) rr *= Math.sqrt(Math.max(0, 1 - ((p[1] - Y.shoulder) / (Y.chestTop - Y.shoulder + 0.3)) ** 2));
      return inLimb(p, cx, 0, rr);
    });
    fill(vox, `lowerArm${side}`, [cx - r, Y.wrist, -r], [cx + r, Y.elbow + r, r], 'top', (p) => {
      if (p[1] > Y.elbow) return inBall(p, [cx, Y.elbow, 0], r * 0.8);
      return inLimb(p, cx, 0, lerp(r * 0.68, r * 0.82, (p[1] - Y.wrist) / (Y.elbow - Y.wrist)));
    });
    hand(vox, side, cx, r);
  }
  // Legs, tapering: the thigh (up into the pelvis), the shin (a ball at the knee, inside the thigh
  // until it bends), the shoe (into the shin).
  for (const [side, m] of SIDES) {
    const [x0, x1] = m > 0 ? [L.lx0, L.lx1] : [-L.lx1, -L.lx0];
    const { lz0: z0, lz1: z1 } = L;
    const cx = m * L.lx;
    const cz = L.lz;
    const r = b.leg / 2;
    fill(vox, `upperLeg${side}`, [x0, Y.knee, z0], [x1, Y.hipJoint + 1, z1], 'pants', (p) => {
      if (p[1] > Y.pelvis) return inLimb(p, cx, cz, r - 0.75, 4);
      return inLimb(p, cx, cz, lerp(r * 0.9, r, (p[1] - Y.knee) / (Y.pelvis - Y.knee)), 3.4);
    });
    fill(vox, `lowerLeg${side}`, [x0, Y.ankle, z0], [x1, Y.knee + r, z1], 'pants', (p) => {
      if (p[1] > Y.knee) return inBall(p, [cx, Y.knee, cz], r * 0.84);
      return inLimb(p, cx, cz, lerp(r * 0.76, r * 0.88, (p[1] - Y.ankle) / (Y.knee - Y.ankle)), 3.4);
    });
    shoe(vox, s, side, [x0, x1], [z0, z1]);
  }
}

/**
 * A hand below its wrist, closed round a grip that runs fore and aft through it: a narrow wrist
 * (into the cuff), a rounded fist of three fingers curled under (the creases between them down
 * its outside and underneath), the thumb across its front.
 */
function hand(vox: Blocks, side: 'L' | 'R', cx: number, r: number) {
  const part = `hand${side}`;
  const m = side === 'L' ? 1 : -1;
  const hx = Math.max(1.5, r * 0.74);
  const hz = 1.75;
  const y0 = Y.wrist - 4.5;
  const y1 = Y.wrist - 0.5;
  fill(vox, part, [cx - hx, y0, -hz], [cx + hx, Y.wrist + 0.5, hz], 'skin', (p) => (p[1] > y1 ? inLimb(p, cx, 0, r * 0.6) : inRound(p, [cx - hx, y0, -hz], [cx + hx, y1 + 0.6, hz], [0.9, 1.1, 0.9])));
  fill(vox, part, [cx - 1, Y.wrist - 2.5, hz], [cx + 1, Y.wrist - 1.5, hz + 0.5], 'skin');
  const cells = vox.parts.get(part)!;
  vox.cells.recolour(part, (i, j, k) => {
    if ((k !== -2 && k !== 1) || fc(j) > Y.wrist - 2.2) return;
    return !cells.has(cellKey(i + m, j, k)) || !cells.has(cellKey(i, j - 1, k)) ? 'skinCrease' : undefined;
  });
}

/** A shoe: its toe reaching forward, the sole a row underneath (boots higher, flats lower). */
function shoe(vox: Blocks, s: Spec, side: 'L' | 'R', [lx0, lx1]: number[], [z0, z1]: number[]) {
  const part = `foot${side}`;
  const st = s.look.shoes;
  // A voxel wider than the leg, on the outside.
  const [x0, x1] = side === 'L' ? [lx0, lx1 + 1] : [lx0 - 1, lx1];
  const top = st === 'boots' ? Y.ankle + 2 : Y.ankle;
  const toe = z1 + (st === 'flats' ? 1 : 2);
  const toeTop = 2;
  fill(vox, part, [x0, 0, z0 - 1], [x1, top, z1], 'shoes', (p) => inRound(p, [x0, -2, z0 - 1], [x1, top, z1 + 1], [0.9, 0, 0.9]));
  fill(vox, part, [x0, 0, z0], [x1, toeTop, toe], 'shoes', (p) => inRound(p, [x0, -2, z0 - 1], [x1, toeTop, toe], [1.2, 1.3, 1.8]));
  fill(vox, part, [lx0 + 1, top, z0 + 1], [lx1 - 1, top + 2, z1 - 1], 'shoes');
  vox.recolour(part, (_i, j) => (j === 0 ? 'sole' : st === 'boots' && j === top - 1 ? 'shoesShade' : undefined));
  // Sneakers: laces up the front.
  const mid = side === 'L' ? Math.floor((lx0 + lx1) / 2) : Math.ceil((lx0 + lx1) / 2) - 1;
  if (st === 'sneakers') vox.recolour(part, (i, j, k) => (((j === 2 && k === z1 - 1) || (j === 1 && k === z1)) && i === mid ? 'lace' : undefined));
}

// ---------------------------------------------------------------------------------------------
// The head, in its own space: the skull 12 x 12 x 11, x -6..5, rows 0..11 (the chin's row 0, the
// crown's top at 12), z -6..4 (the face the front row, k = FACE); set on the neck at the head's row.

const HAIR = new Set(['hair', 'hairDark', 'hairTie']);

function head(vox: Blocks, s: Spec) {
  const { look } = s;
  const hv = new Blocks();
  hv.part('head');
  skull(hv);
  face(hv, look);
  hair(hv, look.hair);
  if (look.facialHair === 'beard') beard(hv);
  details(hv, look);
  if (look.hat !== 'none') headwear(hv, look.hat);
  // Under a hat: the hair cut close to the head above the brim's line.
  if (look.hatHair)
    hv.cells.recolour('head', (i, j, k, c) => {
      if (!HAIR.has(c)) return;
      const p = [fc(i), fc(j), fc(k)];
      if (p[1] >= 13) return false;
      if (p[1] >= 8 && !inRound(p, [-7, 0, -7], [7, 13, 6], [2.7, 2.9, 2.7])) return false;
    });
  for (const [key, c] of hv.parts.get('head')!) {
    const [i, j, k] = cellOf(key);
    vox.cells.set('head', i, j + Y.head * SUB, k, c);
  }
}

/** The skull: well rounded, the jaw narrowing to the chin. */
function skull(hv: Blocks) {
  const lo = [-6, 0, -6];
  const hi = [6, 12, 5];
  fill(hv, 'head', lo, hi, 'skin', (p) => {
    if (!inRound(p, lo, hi, [3, 3, 3])) return false;
    const x = Math.abs(p[0]);
    if (p[1] < 1 && (x > 4.2 || p[2] < -3)) return false;
    if (p[1] < 2 && x > 5.2) return false;
    return true;
  });
}

/**
 * A face on the skull, voxel by voxel: thin ears, a small nose, eyes set in a voxel under thin
 * brows (a lid over each, the pupil in the middle of the white with a glint), a line of a mouth;
 * lashes (finer brows, a lash at each eye's outer corner), lips, facial hair.
 */
function face(hv: Blocks, look: Required<CharacterLook>) {
  const set = (i: number, j: number, k: number, c: string, layer?: Layer) => hv.set('head', i, j, k, c, layer);
  /** One voxel (the face's front layer of them is `K`). */
  const dot = (i: number, j: number, k: number, c: string) => hv.cells.set('head', i, j, k, c);
  const K = FACE * SUB + SUB - 1;
  const P = FACE + 1;
  const lashes = look.face === 'lashes' || look.face === 'lipstick';
  const lips = look.face === 'lipstick';
  if (look.face === 'skull') return skullFace(hv);
  for (const i of [6, -7]) for (const j of [4, 5]) for (const k of [-2, -1]) set(i, j, k, j === 4 && k === -1 ? 'skinShade' : 'skin', i > 0 ? '-x' : '+x');
  // The nose: a bridge, wider at the nostrils, shaded underneath.
  for (const i of [-1, 0]) {
    for (const j of [8, 9]) dot(i, j, K + 1, 'skin');
    dot(i, 6, K + 1, 'skinShade');
  }
  for (const i of [-2, -1, 0, 1]) dot(i, 7, K + 1, 'skin');
  for (const m of [1, -1]) {
    // Each eye two design cells square (x 2..4, y 5..7): `at(n)` its nth voxel out from the nose.
    const at = (n: number) => (m > 0 ? 4 + n : -5 - n);
    for (let n = 0; n < 4; n++)
      for (let j = 10; j < 14; j++) {
        hv.cells.del('head', at(n), j, K);
        dot(at(n), j, K - 1, j === 13 ? (lashes ? 'lash' : 'lid') : n === 1 || n === 2 ? 'eye' : 'white');
      }
    dot(m > 0 ? at(1) : at(2), 12, K - 1, 'white');
    for (let n = lashes ? 0 : -1; n < 5; n++) dot(at(n), n === 4 ? 14 : 15, K + 1, lashes ? 'lash' : 'brow');
    if (lashes) for (const j of [12, 13]) dot(at(4), j, K, 'lash');
  }
  for (let i = -3; i < 3; i++) dot(i, 3, K, lips ? 'lips' : 'mouth');
  if (lips) for (let i = -2; i < 2; i++) dot(i, 2, K, 'lips');
  const fh = look.facialHair;
  if (fh === 'moustache' || fh === 'goatee') {
    // Over the mouth, a voxel proud, its ends turned down.
    for (let i = -3; i < 3; i++) set(i, 2, P, 'beard', '-z');
    for (const i of [-3, 2]) set(i, 1, P, 'beard', '-z');
  }
  if (fh === 'goatee') {
    for (const [i, j] of [[-2, 0], [-1, 0], [0, 0], [1, 0], [-1, -1], [0, -1]]) set(i, j, P, 'beard', '-z');
    for (const i of [-1, 0]) set(i, 0, FACE, 'beard');
  }
  if (fh === 'stubble') hv.cells.recolour('head', (i, j, k, c) => (c === 'skin' && fc(j) < 3 && k >= 0 && ((i + j + k) & 1) === 0 ? 'stubble' : undefined));
}

/** A skull's face: no ears, eyes glowing deep in dark sockets, a hollow for a nose, teeth. */
function skullFace(hv: Blocks) {
  const set = (i: number, j: number, k: number, c: string) => hv.set('head', i, j, k, c);
  for (const m of [1, -1]) {
    const inner = m > 0 ? 2 : -3;
    const outer = m > 0 ? 3 : -4;
    for (const i of [inner, outer])
      for (const j of [5, 6]) {
        hv.del('head', i, j, FACE);
        set(i, j, FACE - 1, 'eye');
      }
    for (const i of [inner - m, outer + m]) for (const j of [5, 6]) set(i, j, FACE, 'socket');
    for (let i = Math.min(inner, outer) - 1; i <= Math.max(inner, outer) + 1; i++) {
      set(i, 7, FACE, 'socket');
      set(i, 4, FACE, i === inner - m ? 'skin' : 'socket');
    }
    for (const i of [m > 0 ? 4 : -5, m > 0 ? 5 : -6]) set(i, 3, FACE, 'skinShade');
  }
  for (const [i, j] of [[-1, 3], [0, 3], [-1, 4], [0, 4]]) set(i, j, FACE, 'socket');
  for (let i = -3; i < 3; i++) {
    set(i, 2, FACE, i === -3 || i === 2 ? 'socket' : 'teeth');
    set(i, 1, FACE, (i & 1) === 0 ? 'teeth' : 'socket');
  }
}

/** A crown (gold, points round its rim, a gem in front), a fedora or a cap, over the hair (what's under the brim goes). */
function headwear(hv: Blocks, hat: Required<CharacterLook>['hat']) {
  const set = (i: number, j: number, k: number, c: string, layer?: Layer) => hv.set('head', i, j, k, c, layer);
  if (hat === 'crown') {
    for (let i = -8; i < 8; i++)
      for (let j = 11; j < 15; j++)
        for (let k = -8; k < 8; k++) {
          const x = C(i);
          const z = C(k);
          const rim = Math.abs(x) < 6.9 && z > -6.9 && z < 5.9 && !(Math.abs(x) < 5.4 && z > -5.4 && z < 4.4);
          if (!rim) continue;
          const point = (i + k + 40) % 3 === 0;
          if (j === 13 && !point) continue;
          if (j === 14 && !(point && (i + k + 40) % 6 === 0)) continue;
          set(i, j, k, 'gold');
        }
    for (const i of [-1, 0]) set(i, 12, 6, 'gem');
    for (const k of [-1, 0]) {
      set(-7, 12, k, 'gem');
      set(6, 12, k, 'gem');
    }
    return;
  }
  const y0 = hat === 'cap' ? 8 : 10;
  hv.recolour('head', (_i, j, _k, c) => (HAIR.has(c) && j >= y0 ? false : undefined));
  const head = hv.part('head');
  if (hat === 'fedora') {
    // A wide thin brim (turned down a little in front), a pinched crown with a band.
    each([-10, y0 - 0.5, -11], [10, y0 + 0.5, 10], (p, i, j, k) => {
      if (inEllipsoid([p[0], 0, p[2]], [0, 0, -0.5], [9.6, 1, 9.8]) && p[1] > y0 === p[2] <= 6.5) head.set(cellKey(i, j, k), 'hat');
    });
    each([-7, y0, -8], [7, y0 + 6, 7], (p, i, j, k) => {
      if (!inRound(p, [-6.5, y0, -7.5], [6.5, y0 + 6, 5.5], [2.6, 1.8, 2.6])) return;
      if (p[1] > y0 + 5.2 && Math.abs(p[0]) < 1.4) return;
      head.set(cellKey(i, j, k), p[1] < y0 + 2 ? 'hatBand' : 'hat');
    });
  } else {
    // A cap: a rounded crown over the head, a thin bill round in front, a button on top.
    each([-8, y0, -8], [8, 15, 8], (p, i, j, k) => {
      const at = head.get(cellKey(i, j, k));
      if (at !== undefined && !HAIR.has(at)) return;
      if (inRound(p, [-6.9, y0, -6.9], [6.9, 13.6, 5.9], [3.4, 3, 3.4])) head.set(cellKey(i, j, k), 'hat');
    });
    each([-5.5, y0, 4], [5.5, y0 + 0.5, 10], (p, i, j, k) => {
      if (!head.has(cellKey(i, j, k)) && inRound([p[0], 0, p[2]], [-5.5, -1, 0], [5.5, 1, 10], [3, 0, 3])) head.set(cellKey(i, j, k), 'hatBand');
    });
    for (const i of [-1, 0]) for (const k of [-1, 0]) set(i, 14, k, 'hatBand', '-y');
  }
}

/** Blush and freckles on the cheeks; sunglasses or specs over the eyes. */
function details(hv: Blocks, look: Required<CharacterLook>) {
  const set = (i: number, j: number, k: number, c: string, layer?: Layer) => hv.set('head', i, j, k, c, layer);
  const P = FACE + 1;
  if (look.face === 'lipstick') for (const i of [-5, -4, 3, 4]) set(i, 3, FACE, 'blush');
  if (look.face === 'freckles') for (const [i, j, k] of [[-5, 3, FACE], [-4, 4, FACE], [-3, 3, FACE], [2, 3, FACE], [3, 4, FACE], [4, 3, FACE], [0, 4, P]]) if (hv.get('head', i, j, k)) hv.cells.set('head', i * SUB + ((i + j) & 1), j * SUB + (i & 1), k * SUB + (k === P ? 0 : SUB - 1), 'freckle');
  if (look.face === 'shades') {
    // A band across the eyes a voxel proud, a bridge, arms back over the ears.
    for (let i = -6; i < 6; i++) for (const j of [5, 6]) if (!(j === 5 && (i === -1 || i === 0))) set(i, j, P, i === -1 || i === 0 || i === -6 || i === 5 ? 'frame' : 'glass', '-z');
    for (const i of [6, -7]) for (let k = -2; k < P; k++) set(i, 6, k, 'frame', i > 0 ? '-x' : '+x');
  }
  if (look.face === 'specs') {
    // A rim round each eye a voxel proud (over the brows' inner ends), a bridge, arms back over the ears.
    for (const m of [1, -1]) {
      const [a, c] = m > 0 ? [1, 4] : [-5, -2];
      // (Thin wire: the rim's top and bottom the voxels next to the lens, its sides likewise.)
      for (let i = a; i <= c; i++) {
        for (let d = 0; d < SUB; d++) {
          hv.cells.set('head', i * SUB + d, 4 * SUB + SUB - 1, P * SUB, 'frame');
          hv.cells.set('head', i * SUB + d, 7 * SUB, P * SUB, 'frame');
        }
      }
      for (let j = 4 * SUB + SUB - 1; j <= 7 * SUB; j++) {
        hv.cells.set('head', a * SUB + SUB - 1, j, P * SUB, 'frame');
        hv.cells.set('head', c * SUB, j, P * SUB, 'frame');
      }
    }
    for (const i of [-1, 0]) hv.cells.set('head', i, 6 * SUB, P * SUB, 'frame');
    for (const i of [5, -6]) set(i, 6, P, 'frame', '-z');
    for (const i of [6, -7]) for (let k = -2; k < P; k++) set(i, 6, k, 'frame', i > 0 ? '-x' : '+x');
  }
}

/** Hair: a shell a voxel over the skull where the style says, and its own shapes. */
function hair(hv: Blocks, style: Required<CharacterLook>['hair']) {
  const head = hv.part('head');
  // Hair goes where the skull isn't (a design cell the skull only partly fills takes it in the rest).
  const set = (i: number, j: number, k: number, c = 'hair') => {
    for (let dk = 0; dk < SUB; dk++)
      for (let dj = 0; dj < SUB; dj++)
        for (let di = 0; di < SUB; di++) {
          const key = cellKey(i * SUB + di, j * SUB + dj, k * SUB + dk);
          const at = head.get(key);
          if (at === undefined || HAIR.has(at)) head.set(key, c);
        }
  };
  const skullAt = (i: number, j: number, k: number) => hv.filled(i, j, k, 'head', true);
  const shell = (where: (p: number[]) => boolean, grow = 1) => {
    each([-9, 0, -9], [9, 15, 8], (p, i, j, k) => {
      if (head.has(cellKey(i, j, k))) return;
      if (!inRound(p, [-6 - grow, 0, -6 - grow], [6 + grow, 12 + grow, 5 + grow], [3 + grow * 0.6, 3 + grow * 0.6, 3 + grow * 0.6])) return;
      if (where(p)) head.set(cellKey(i, j, k), 'hair');
    });
  };
  const top = (p: number[]) => p[1] > 10.5;
  const back = (p: number[]) => p[2] < 1;
  const sides = (p: number[]) => p[1] > 7 && p[2] < 3.5;
  switch (style) {
    case 'buzz':
      shell((p) => top(p) || (back(p) && p[1] > 3.5) || sides(p) || p[1] > 9.5);
      break;
    case 'crew':
      // Short at the sides, a flat top, a little brush up in front.
      shell((p) => top(p) || (back(p) && p[1] > 3) || sides(p));
      for (let i = -5; i < 5; i++) for (let k = -4; k < 4; k++) set(i, 13, k);
      for (let i = -4; i < 4; i++) set(i, 12, 5);
      break;
    case 'short':
      shell((p) => top(p) || (back(p) && p[1] > 2.5) || sides(p) || p[1] > 9.5);
      for (let i = -5; i < 5; i++) if ((i + 7) % 3 !== 0) set(i, 9, 6);
      break;
    case 'slick':
    case 'long':
      shell((p) => top(p) || (back(p) && p[1] > (style === 'long' ? 1 : 3)) || sides(p) || p[1] > 9.5);
      // Swept back from a ridge over the forehead.
      for (let i = -6; i < 6; i++) set(i, 12, 5);
      for (let i = -5; i < 5; i++) set(i, 11, 6);
      if (style === 'long') {
        // Down to the collar behind and over the ears at the sides, parted in the middle.
        for (let i = -7; i < 7; i++) for (let j = -1; j < 6; j++) for (let k = -8; k < 0; k++) if (!skullAt(i, j, k) && inRound([C(i), C(j), C(k)], [-7, -1, -8], [7, 8, 0], [1.6, 1, 1.6])) set(i, j, k);
        for (const i of [-8, -7, 6, 7]) for (let j = 1; j < 9; j++) for (let k = -2; k < 2; k++) if (!skullAt(i, j, k) && (Math.abs(C(i)) < 7.5 || (j > 2 && k < 1))) set(i, j, k);
        for (let k = -2; k < 7; k++) for (const i of [-1, 0]) if (hv.get('head', i, 12, k) === 'hair') set(i, 12, k, 'hairDark');
      }
      break;
    case 'swept':
      // Fuller, a side parting over the left eye, the fringe swept across to the right, over the ears.
      shell((p) => top(p) || (back(p) && p[1] > 2.5) || (p[1] > 4.5 && p[2] < 2.5) || p[1] > 9.5);
      hv.recolour('head', (i, j, k, c) => (c === 'hair' && k < -5 && (i + 20) % 3 === 0 && j > 3 && j < 11 ? 'hairDark' : c === 'hair' && k < -5 && j === 3 && (i + 20) % 2 ? false : undefined));
      for (let i = -6; i < 6; i++) {
        set(i, 12, 4);
        if (i < 3) set(i, 10, 6, i < -3 ? 'hair' : 'hairDark');
        if (i < 2) set(i, 11, 6);
        set(i, 12, 5);
      }
      for (let k = -5; k < 6; k++) set(2, 13, k, 'hairDark');
      for (const i of [-8, -7, 6, 7]) for (let j = 4; j < 9; j++) for (let k = -3; k < 2; k++) if (!skullAt(i, j, k) && Math.abs(C(i)) < 7.5) set(i, j, k);
      break;
    case 'pomp':
      // A quiff rolled up and forward over the forehead; sideburns.
      shell((p) => top(p) || (back(p) && p[1] > 3) || sides(p) || p[1] > 9.5);
      for (let i = -6; i < 6; i++) for (let j = 9; j < 16; j++) for (let k = 0; k < 8; k++) if (inEllipsoid([C(i), C(j), C(k)], [0, 12.2, 3.6], [5.6, 2.8, 3.6])) set(i, j, k);
      for (const i of [6, -7]) for (let j = 2; j < 6; j++) set(i, j, 1);
      break;
    case 'bob':
      // To the jaw at the sides and back, blunt bangs across the brow.
      shell((p) => top(p) || back(p) || p[1] > 7.5);
      for (let i = -8; i < 8; i++) for (let j = 1; j < 9; j++) for (let k = -8; k < 3; k++) if (!skullAt(i, j, k) && inRound([C(i), C(j), C(k)], [-7.5, 1, -8], [7.5, 11, 3], [2, 0.8, 2])) set(i, j, k);
      for (let i = -6; i < 6; i++) for (const j of [8, 9, 10]) set(i, j, FACE + 1);
      break;
    case 'pony': {
      // A high ponytail behind, tied, falling to the shoulders; a parted fringe.
      shell((p) => top(p) || (back(p) && p[1] > 3) || sides(p) || p[1] > 9.5);
      for (let i = -5; i < 5; i++) if (i < -1 || i > 0) set(i, 9, FACE + 2);
      const tie = 8;
      for (let j = -3; j < tie + 2; j++)
        for (let i = -3; i < 3; i++)
          for (let k = -12; k < -6; k++) {
            const w = j > tie ? 1.9 : 1.4 + (tie - j) * 0.04;
            if (inEllipsoid([C(i), C(j), C(k)], [0, j + 0.5, -8.2 - (tie - j) * 0.14], [w, 1, 1.6])) set(i, j, k);
          }
      for (let i = -2; i < 2; i++) for (const k of [-9, -8, -7]) set(i, tie, k, 'hairTie');
      break;
    }
    case 'bun':
      // Pulled back to a bun at the back of the crown, parted down the middle.
      shell((p) => top(p) || (back(p) && p[1] > 2.5) || sides(p) || p[1] > 9.5);
      for (let k = -3; k < 6; k++) for (const i of [-1, 0]) if (hv.get('head', i, 12, k) === 'hair') set(i, 12, k, 'hairDark');
      for (let i = -4; i < 4; i++)
        for (let j = 5; j < 14; j++)
          for (let k = -13; k < -6; k++) if (!skullAt(i, j, k) && inEllipsoid([C(i), C(j), C(k)], [0, 9.4, -9.2], [3, 2.8, 2.6])) set(i, j, k, k === -8 ? 'hairTie' : 'hair');
      break;
    case 'afro':
      // A big round cloud of curls, open round the face and the ears.
      for (let i = -11; i < 11; i++)
        for (let j = 2; j < 19; j++)
          for (let k = -12; k < 9; k++) {
            const p = [C(i), C(j), C(k)];
            if (skullAt(i, j, k) || !inEllipsoid(p, [0, 9.6, -1.2], [9.8, 8.2, 9.2])) continue;
            if (p[2] > 2.2 && p[1] < 9.6) continue;
            if (p[1] < 4.5 && p[2] > -3) continue;
            const h = hash(i >> 1, j >> 1, k >> 1, 5);
            if (j > 2 && h < 0.08 && !inEllipsoid(p, [0, 9.6, -1.2], [8.8, 7.2, 8.2])) continue;
            set(i, j, k, h < 0.3 ? 'hairDark' : 'hair');
          }
      break;
    case 'mohawk':
      // Shaved sides, a crest two wide from the brow over the crown and down to the nape.
      for (let i = -1; i < 1; i++)
        for (let j = 3; j < 18; j++)
          for (let k = -9; k < 7; k++) {
            const y = C(j);
            const z = C(k);
            if (skullAt(i, j, k) || ((z + 0.5) / 7.8) ** 2 + ((y - 5.5) / 10.5) ** 2 > 1) continue;
            if (z > 4 && y < 10) continue;
            set(i, j, k, (j + k) % 3 === 0 ? 'hairDark' : 'hair');
          }
      break;
    case 'bald':
      break;
  }
}

/** A full beard and moustache, a voxel proud of the jaw, cheeks and chin; the mouth left open. */
function beard(hv: Blocks) {
  const head = hv.part('head');
  each([-7, -2, -3], [7, 5, 6], (p, i, j, k) => {
    if (head.has(cellKey(i, j, k))) return;
    if (!inRound(p, [-7, -2, -3], [7, 5, 6], [3, 2.6, 3])) return;
    if (p[2] < -1.5 && p[1] > 1) return;
    if (Math.abs(p[0]) > 6.4 && p[1] > 3) return;
    head.set(cellKey(i, j, k), 'beard');
  });
  for (let i = -3; i < 3; i++) hv.set('head', i, 2, FACE + 1, 'beardDark');
  for (const i of [-2, -1, 0, 1]) {
    hv.del('head', i, 1, FACE + 1);
    hv.set('head', i, 1, FACE, 'mouth');
  }
}

// ---------------------------------------------------------------------------------------------
// The clothes: the body's parts recoloured by region, and what's worn over them.

function dress(vox: Blocks, s: Spec) {
  const { b, top: t, look } = s;
  const L = limbs(b);
  const bz = F + b.belly;
  const frontRow = (part: string) => (part === 'spine' ? bz : F);
  const torso = (j: number) => (j < Y.chest ? 'spine' : 'chest');
  // Sleeves: long (a cuff at the wrist: the shirt's under a jacket, a rib), short (a hem above
  // the elbow, bare forearms), to the elbow, rolled to the elbow, or none (bare arms).
  for (const [side] of SIDES) {
    vox.recolour(`upperArm${side}`, (_i, j) => (t.sleeves === 'none' || (t.sleeves === 'short' && j < Y.elbow + 2) ? 'skin' : t.sleeves === 'short' && j === Math.floor(Y.elbow) + 2 ? (t.panels ? 'accent' : 'topShade') : undefined));
    vox.recolour(`lowerArm${side}`, (_i, j) => {
      if (t.sleeves === 'long') return j === Math.floor(Y.wrist) ? (t.jacket ? 'under' : t.rib ? 'topShade' : undefined) : undefined;
      if (t.sleeves === 'rolled' && j >= Y.elbow - 1) return 'topShade';
      return 'skin';
    });
  }
  // A suit's or jacket's front: open in a V from the collar to its button (all the way down, worn
  // open), the shirt inside; lapels a voxel proud beside it.
  if (t.jacket) {
    const button = t.open ? Y.pelvis : Y.spine + 1;
    const vHalf = (j: number) => (t.open ? 2 + ((j - button) / (Y.chestTop - button)) * 1.5 : 0.3 + ((j - button) / (Y.chestTop - button)) * 2.8);
    for (const part of ['chest', 'spine'])
      vox.recolour(part, (i, j, k) => {
        if (k < frontRow(part) || j < button) return;
        const x = Math.abs(C(i));
        const v = vHalf(j);
        if (x < v) return 'under';
        if (t.open && x < v + 1) return 'topDark';
      });
    if (!t.open)
      for (let j = button + 1; j < Y.chestTop; j++) {
        const v = vHalf(j);
        for (const m of [1, -1]) for (let x = Math.ceil(v - 0.5); x < v + 1.5; x++) vox.set(torso(j), m > 0 ? x : -x - 1, j, frontRow(torso(j)) + 1, 'lapel', '-z');
      }
    if (!t.open) for (const i of [-1, 0]) vox.set('spine', i, Y.spine, bz + 1, 'button', '-z');
    // The jacket's skirt over the seat (split in front).
    if (!t.open) vox.recolour('hips', (i, j, k) => (j >= Y.pelvis + 2 && !(k >= 3 && Math.abs(C(i)) < 1 + (Y.belt - j) * 0.6) ? 'top' : undefined));
  }
  // A tie down the middle, a knot under the collar.
  if (t.tie) {
    for (let j = Y.spine; j < Y.chestTop - 1; j++) for (const i of j === Y.spine ? [0] : [-1, 0]) vox.set(torso(j), i, j, frontRow(torso(j)) + 1, 'accent', '-z');
    for (const i of [-1, 0]) vox.set('chest', i, Y.chestTop - 1, F + 1, 'accentShade');
  }
  // Buttons down a shirt's front.
  if (t.buttons) for (let j = Y.spine + 1; j < Y.chestTop - 3; j += 2) vox.cells.set(torso(j), -1, j * SUB, (frontRow(torso(j)) + 1) * SUB, t.panels ? 'button' : 'topShade');
  // Collars: a band round the neck (on the chest, round the neck's cells); a shirt's points down
  // the front, open at the throat.
  const ring = (c: string, j = Y.chestTop, layer?: Layer) => {
    each([-3, j, -4], [3, j + (layer ? 0.5 : 1), 2], (p, i, jj, k) => {
      if (!inLimb(p, 0, -1, 2, 2.4) && inLimb(p, 0, -1, 3, 2.6)) vox.cells.set('chest', i, jj, k, c);
    });
  };
  const collar = t.jacket && !t.open ? 'under' : t.panels ? 'accent' : 'top';
  if (t.collar === 'shirt' || t.collar === 'open' || t.collar === 'camp') {
    ring(collar);
    for (const m of [1, -1]) {
      const a = m > 0 ? 0 : -1;
      vox.set('chest', a + m, Y.chestTop - 1, F + 1, collar, '-z');
      vox.set('chest', a + 2 * m, Y.chestTop - 1, F + 1, collar, '-z');
      vox.set('chest', a + 2 * m, Y.chestTop - 2, F + 1, collar, '-z');
      if (t.collar !== 'shirt') vox.set('chest', a + 3 * m, Y.chestTop - 1, F + 1, collar, '-z');
    }
    if (t.collar !== 'shirt') for (const i of [-1, 0]) for (let j = Y.chestTop - 3; j < Y.chestTop; j++) vox.set('chest', i, j, F, 'skin');
  } else if (t.collar === 'crew' || t.collar === 'track') ring(t.open ? 'under' : 'top', Y.chestTop, t.collar === 'crew' ? '-y' : undefined);
  if (t.collar === 'track') ring('top', Y.chestTop + 1);
  // A tank top: bare shoulders but for its straps, a scoop at the neck, wide arm holes.
  if (t.collar === 'scoop')
    vox.recolour('chest', (i, j, k) => {
      const x = Math.abs(C(i));
      const strap = x > 2 && x < 4.6;
      if (j >= Y.chestTop - 1 && !strap) return 'skin';
      if (k >= F - 1 && x < 2.6 && j >= Y.chestTop - 4) return 'skin';
      if (x > b.sh - 1.5 && j >= Y.chest + 3) return 'skin';
    });
  // A track top's zip down the front, stripes down the sleeves and sides (and the joggers' legs).
  if (t.zip) for (let j = Y.spine; j < Y.chestTop; j++) vox.set(torso(j), -1, j, frontRow(torso(j)), 'zip', '+x');
  if (t.stripes) {
    for (const [side, m] of SIDES) {
      const armOut = m > 0 ? b.sh + b.arm - 1 : -b.sh - b.arm;
      const foreOut = m > 0 ? Math.floor(L.ax) + 1 : -Math.floor(L.ax) - 2;
      vox.recolour(`upperArm${side}`, (i, _j, _k, c) => (i === armOut && c !== 'skin' ? 'accent' : undefined));
      vox.recolour(`lowerArm${side}`, (i, _j, _k, c) => (i === foreOut && c === 'top' ? 'accent' : undefined));
    }
    for (const part of ['chest', 'spine']) {
      const w = part === 'chest' ? b.sh : b.waist;
      vox.recolour(part, (i, _j, k) => (C(k) > -1 && C(k) < 1 && (i === w - 1 || i === -w) ? 'accent' : undefined));
    }
  }
  // A bowling shirt's panels down the front.
  if (t.panels) for (const part of ['chest', 'spine']) vox.recolour(part, (i, _j, k, c) => (c === 'top' && k >= frontRow(part) && Math.abs(C(i)) > 2 && Math.abs(C(i)) < 5 ? 'accent' : undefined));
  // An aloha shirt's print: flowers (a yellow heart, petals in the accent) and leaves.
  if (t.flowers)
    for (const part of ['chest', 'spine', 'upperArmL', 'upperArmR', 'hips'])
      vox.recolour(part, (i, j, k, c) => {
        if (c !== 'top') return;
        const gi = Math.floor((i + 40) / 4);
        const gj = Math.floor(j / 4);
        const gk = Math.floor((k + 40) / 4);
        const seed = hash(gi, gj, gk, 1);
        const ci = gi * 4 - 40 + 1 + Math.floor(seed * 2);
        const cj = gj * 4 + 1 + Math.floor(hash(gj, gi, gk, 2) * 2);
        const ck = gk * 4 - 40 + 1 + Math.floor(hash(gk, gj, gi, 3) * 2);
        const d = Math.abs(i - ci) + Math.abs(j - cj) + Math.abs(k - ck);
        if (seed < 0.7) return d === 0 ? 'flowerMid' : d === 1 ? 'accent' : undefined;
        if (d <= 1 && hash(i, j, k, 4) < 0.8) return 'leaf';
      });
  // A sweater's cables down the front.
  if (t.knit)
    for (const part of ['chest', 'spine'])
      vox.recolour(part, (i, j, k, c) => (c === 'top' && k >= frontRow(part) && (i === -3 + ((j >> 1) & 1) || i === 2 - ((j >> 1) & 1)) ? 'topShade' : undefined));
  // A hoodie's hood down on the shoulders behind, its drawstrings, the pocket across the front.
  if (t.hood) {
    const back = backOf(vox, 'chest', 0, Y.chestTop - 2)!;
    fill(vox, 'chest', [-6, Y.chestTop - 5, back - 3], [6, Y.chestTop + 2, back + 3], (_i, j, k) => (j === Y.chestTop - 2 && k < back - 1 ? 'topShade' : 'top'), (p) => inEllipsoid(p, [0, Y.chestTop - 1.5, back + 0.5], [5.8, 3.4, 3]));
    for (const i of [-2, 1]) for (let j = Y.chestTop - 4; j < Y.chestTop; j++) vox.set('chest', i, j, F + 1 + (j < Y.chest + 5 ? b.bust : 0), 'accent', '-z');
    for (let i = -4; i < 4; i++) for (let j = Y.spine; j < Y.spine + 3; j++) vox.set('spine', i, j, bz + 1, i === -4 || i === 3 ? 'topShade' : 'top', '-z');
  }
  // A skeleton's ribs (dark between them, front, sides and back), the spine down its hollow belly.
  if (t.ribs) {
    for (const part of ['chest', 'spine', `upperArmL`, `upperArmR`]) vox.recolour(part, () => 'skin');
    vox.recolour('chest', (i, j, k) => {
      const x = Math.abs(C(i));
      if (x < 1 || j >= Y.chestTop - 1) return;
      if ((j - Y.chest) % 2 === 1 && (k >= F - 1 || x > b.sh - 2.5 || k <= -3)) return 'socket';
    });
    vox.recolour('spine', (i, _j, k) => (Math.abs(C(i)) < 1.5 ? undefined : k >= bz - 1 || k <= -3 || Math.abs(C(i)) > b.waist - 1.5 ? 'socket' : undefined));
  }
  // A tunic hanging to mid-thigh, belted.
  if (t.tunic) skirt(vox, s, 'top', { bottom: Y.knee + 2, flare: 1.2 });
  // An apron over it all: a bib, straps up to the neck, and a panel to the knee.
  if (t.apron) {
    for (let i = -3; i < 3; i++) for (let j = Y.chest; j < Y.chest + 5; j++) vox.set('chest', i, j, F + b.bust + 1, 'accent', '-z');
    for (const i of [-4, 3]) for (let j = Y.chest + 4; j < Y.chestTop; j++) vox.set('chest', i, j, F + 1, 'accent', '-z');
    for (let j = Y.knee + 1; j < Y.spine; j++)
      for (let i = -5; i < 5; i++) {
        const part = j >= Y.split ? 'hips' : C(i) > 0 ? 'upperLegL' : 'upperLegR';
        vox.set(part, i, j, 4, j === Y.knee + 3 && i > -4 && i < 3 ? 'accentShade' : 'accent', '-z');
      }
    for (let i = -5; i < 5; i++) vox.set('spine', i, Y.spine, bz + 1, 'accent', '-z');
  }
  // The waist: a belt with a buckle (tucked in, or a tunic's), or the top's hem over it.
  const skirted = look.bottom === 'skirt';
  if (!t.jacket || t.open) {
    if ((t.tucked || t.tunic) && !skirted) {
      if (t.tunic) belt(vox);
      else {
        vox.recolour('hips', (_i, j) => (j === Y.belt ? 'belt' : undefined));
        for (const i of [-1, 0]) vox.set('hips', i, Y.belt, 4, 'buckle', '-z');
      }
    } else if (!skirted && !t.ribs) vox.recolour('hips', (i, j) => (j === Y.belt ? (t.rib && (i & 1) ? 'topShade' : 'top') : undefined));
  }
  // Legs: trousers (a crease down the front), jeans (seams, back pockets, a turned-up hem), shorts
  // to the knee, joggers (cuffed), or a skirt over bare legs.
  for (const [side, m] of SIDES) {
    const mid = m > 0 ? Math.floor(L.lx) : -Math.floor(L.lx) - 1;
    const out = m > 0 ? L.lx1 - 1 : -L.lx1;
    const legs = [`upperLeg${side}`, `lowerLeg${side}`];
    switch (look.bottom) {
      case 'trousers':
        for (const part of legs) vox.cells.recolour(part, (i, _j, k, c) => (i === mid * SUB + (m > 0 ? 0 : SUB - 1) && down(k) === L.lz1 - 1 && c === 'pants' ? 'pantsShade' : undefined));
        break;
      case 'jeans':
        for (const part of legs) vox.cells.recolour(part, (i, _j, k, c) => (c === 'pants' && down(i) === out && k === Math.floor(L.lz * SUB) ? 'seam' : undefined));
        vox.recolour(`lowerLeg${side}`, (_i, j) => (j === Y.ankle ? 'pantsShade' : undefined));
        break;
      case 'shorts':
        vox.recolour(`lowerLeg${side}`, (_i, j) => (j >= Y.knee - 1 ? undefined : 'skin'));
        break;
      case 'joggers':
        vox.recolour(`lowerLeg${side}`, (_i, j) => (j <= Y.ankle + 1 ? 'pantsShade' : undefined));
        if (t.stripes) for (const part of legs) vox.recolour(part, (i, _j, _k, c) => (i === out && c === 'pants' ? 'accent' : undefined));
        break;
      case 'skirt':
        vox.recolour(`upperLeg${side}`, () => 'skin');
        vox.recolour(`lowerLeg${side}`, () => 'skin');
        break;
    }
  }
  if (look.bottom === 'jeans') vox.recolour('hips', (i, j, k) => (k === -4 && j >= Y.pelvis + 1 && j <= Y.pelvis + 2 && (Math.abs(C(i)) > 1.5 && Math.abs(C(i)) < 4.5) ? 'pantsShade' : undefined));
  if (skirted) skirt(vox, s, 'pants', { bottom: Y.knee + 1, flare: 1.4, zFlare: 1.1 });
  // Worn thin: holes (the skin through them) and frayed hems.
  if (look.ragged) {
    const cloth = new Set(['top', 'topShade', 'pants', 'pantsShade', 'under', 'accent']);
    for (const [part, cells] of vox.parts) {
      if (part === 'head' || part.startsWith('hand') || part.startsWith('foot')) continue;
      for (const [key, c] of [...cells]) {
        if (!cloth.has(c)) continue;
        const [i, j, k] = cellOf(key).map(down);
        const h = hash(i >> 1, j >> 1, k >> 1, 9);
        if (h < 0.1) cells.set(key, 'skin');
        else if (h < 0.22) cells.set(key, c.startsWith('top') ? 'topDark' : c.startsWith('pants') ? 'pantsDark' : c);
      }
    }
    for (const [side] of SIDES) vox.recolour(`lowerLeg${side}`, (i, j, k, c) => (j < Y.ankle + 3 && cloth.has(c) && hash(i, j, k, 11) < 0.5 ? 'skin' : undefined));
  }
}

/** A belt round the pelvis's top row, a buckle a voxel proud in front. */
function belt(vox: Blocks) {
  coat(vox, 'hips', 'belt', (p) => p[1] > Y.belt && p[1] < Y.spine, 'xz');
  const k = frontOf(vox, 'hips', 0, Y.belt)! + 1;
  for (const i of [-2, -1, 0, 1]) vox.set('hips', i, Y.belt, k, 'buckle', '-z');
}

/**
 * A skirt of cloth from the belly's bottom down to `bottom`, out from the middle to the hips at the
 * top, flaring `flare` units to the sides (`zFlare` front and back) by the bottom. Each row goes
 * on the part it hangs from: the hips, and below `Y.split` each side's thigh (a stride swings it
 * with the leg). Below the pelvis it's a shell a unit and a half thick round the legs.
 */
function skirt(vox: Blocks, s: Spec, colour: string, { bottom, flare = 2, zFlare = null }: { bottom: number; flare?: number; zFlare?: number | null }) {
  const { b } = s;
  const y0 = Y.spine;
  each([-16, bottom, -16], [16, y0, 16], (p, i, j, k) => {
    const [x, y, z] = p;
    const t = (y0 - y) / (y0 - bottom);
    const hw = b.hip + 0.6 + t * flare;
    const hd = 4.2 + t * (zFlare ?? flare * 0.9);
    if (!inRound([x, 0, z], [-hw, -1, -hd], [hw, 1, hd], [1.8, 0, 1.8])) return;
    if (Math.abs(x) < hw - 1.5 && Math.abs(z) < hd - 1.5 && y < Y.pelvis) return;
    vox.cells.set(y >= Y.split ? 'hips' : x > 0 ? 'upperLegL' : 'upperLegR', i, j, k, y < bottom + 0.5 ? `${colour}Shade` : colour);
  });
}

// ---------------------------------------------------------------------------------------------
// Colours

const rgbOf = (c: string) => parseInt(c.slice(1), 16);
/** An sRGB colour scaled in brightness. */
const shade = (v: number, k: number) => {
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => Math.max(0, Math.min(255, Math.round(x * k))));
  return (c[0] << 16) | (c[1] << 8) | c[2];
};
/** Two sRGB colours mixed. */
const mix = (a: number, b: number, t: number) => {
  const c = [16, 8, 0].map((sh) => Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t));
  return (c[0] << 16) | (c[1] << 8) | c[2];
};
/** How light an sRGB colour looks, 0..1. */
const lightness = (v: number) => (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;

function palette(s: Spec): Palette {
  const { look, top: t } = s;
  const P = new Palette();
  const skin = rgbOf(look.skin);
  const hairC = rgbOf(look.hairColor);
  const top = rgbOf(look.topColor);
  const accent = rgbOf(look.accent);
  const pants = rgbOf(look.bottomColor);
  const shoes = rgbOf(look.shoeColor);
  const glow = look.face === 'glow' || look.face === 'skull';
  const cloth = t.shine ? { rough: 0.42 } : { rough: 0.85 };
  P.add('skin', skin, { rough: 0.62 });
  P.add('skinShade', shade(skin, 0.8), { rough: 0.62 });
  P.add('skinCrease', shade(skin, 0.84), { rough: 0.62 });
  P.add('blush', mix(skin, 0xe0607a, 0.3), { rough: 0.62 });
  P.add('freckle', mix(skin, 0x8a4a2a, 0.3), { rough: 0.62 });
  P.add('stubble', mix(skin, hairC, 0.28), { rough: 0.7 });
  P.add('hair', hairC, { rough: look.hair === 'slick' || look.hair === 'pomp' || look.hair === 'long' ? 0.32 : 0.7 });
  P.add('hairDark', shade(hairC, 0.72), { rough: 0.55 });
  P.add('hairTie', 0x2a2a2e, { rough: 0.6 });
  P.add('beard', shade(hairC, 1.05), { rough: 0.7 });
  P.add('beardDark', shade(hairC, 0.8), { rough: 0.7 });
  P.add('brow', shade(hairC, lightness(hairC) > 0.45 ? 0.62 : 0.9), { rough: 0.7 });
  P.add('lash', 0x141010, { rough: 0.5 });
  P.add('lid', shade(skin, 0.66), { rough: 0.62 });
  P.add('eye', rgbOf(look.eyes), { rough: 0.15, glow: glow ? 1 : 0 });
  P.add('white', glow ? rgbOf(look.eyes) : 0xf2eee6, { rough: 0.3, glow: glow ? 0.8 : 0 });
  P.add('mouth', shade(skin, 0.6), { rough: 0.5 });
  P.add('lips', look.face === 'lipstick' ? 0xc2182b : shade(skin, 0.72), { rough: 0.3 });
  P.add('glass', 0x101014, { rough: 0.06, metal: 0.4 });
  P.add('frame', 0x2a2a30, { rough: 0.3, metal: 0.7 });
  P.add('top', top, cloth);
  P.add('topShade', shade(top, 0.84), cloth);
  P.add('topDark', shade(top, 0.7), cloth);
  P.add('lapel', shade(top, 0.84), { rough: 0.6 });
  // Under a suit, a white shirt; under an open jacket, a tee in the accent.
  const under = t.open ? accent : 0xf4f1ea;
  P.add('under', under, { rough: 0.8 });
  P.add('accent', accent, { rough: 0.7 });
  P.add('accentShade', shade(accent, 0.8), { rough: 0.7 });
  P.add('flowerMid', 0xffe066, { rough: 0.75 });
  P.add('leaf', shade(top, 0.55), { rough: 0.75 });
  P.add('zip', shade(top, 0.72), { rough: 0.4, metal: 0.3 });
  P.add('button', 0x121214, { rough: 0.3 });
  P.add('pants', pants, { rough: 0.85 });
  P.add('pantsShade', shade(pants, 0.8), { rough: 0.85 });
  P.add('pantsDark', shade(pants, 0.66), { rough: 0.85 });
  P.add('seam', mix(pants, 0xe0b060, 0.4), { rough: 0.85 });
  const sneakers = look.shoes === 'sneakers';
  P.add('shoes', shoes, { rough: sneakers ? 0.7 : 0.28 });
  P.add('shoesShade', shade(shoes, 0.78), { rough: 0.35 });
  P.add('sole', sneakers ? 0xf4f1ea : 0x1a130f, { rough: 0.8 });
  P.add('lace', lightness(shoes) > 0.55 ? 0x161616 : 0xf4f1ea, { rough: 0.8 });
  P.add('socket', 0x141012, { rough: 0.8 });
  P.add('teeth', mix(skin, 0xffffff, 0.45), { rough: 0.4 });
  P.add('hat', accent, { rough: 0.85 });
  P.add('hatBand', shade(accent, 0.62), { rough: 0.6 });
  P.add('gold', 0xe0b83a, { rough: 0.22, metal: 1 });
  P.add('gem', 0xe0283a, { rough: 0.1, glow: 0.7 });
  P.add('belt', 0x2e1d14, { rough: 0.4 });
  P.add('buckle', 0xd0d0d6, { rough: 0.2, metal: 1 });
  // How much each colour's voxels vary in shade (when they do): hair most, skin a little, the
  // face's details and the small hard things not at all.
  for (const c of P.colours.values()) c.vary = /^(hair|beard)/.test(c.name) ? 0.09 : c.name.startsWith('skin') || c.name === 'stubble' ? 0.028 : FLAT.has(c.name) ? 0 : 0.05;
  return P;
}

/** Colours that never vary: the face's details, metal, glass, buttons and laces. */
const FLAT = new Set(['eye', 'white', 'lash', 'lid', 'brow', 'mouth', 'lips', 'blush', 'freckle', 'glass', 'frame', 'button', 'zip', 'lace', 'buckle', 'gold', 'gem', 'socket', 'teeth', 'hairTie', 'flowerMid']);

// ---------------------------------------------------------------------------------------------
// The figure

/** A character as a mesh: skinned rigidly on the rig's bones, in metres, and its atlas. */
export interface CharacterMesh {
  /** Where each joint is (metres, the model's space: +x its left, +z ahead, y up from the soles). */
  joints: Record<CharacterJoint, P3>;
  /** How each fist takes a gun: its grip's turn in the hand ([x, y, z] radians, applied y, then x, then z). */
  grips: { gripL: P3; gripR: P3 };
  /** Four corners a quad: positions (metres), normals, UVs (v down from the atlas's top), each corner's bone (an index into `BONES`). */
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  bone: Uint8Array;
  index: Uint32Array;
  atlas: { width: number; height: number; albedo: Uint8Array; mr: Uint8Array; glow: Uint8Array };
  /** Anything glows. */
  glows: boolean;
  /** Where what's worn goes (`WearFrame`: metres, the model's space). */
  wear: WearFrame;
}

/**
 * Where a figure wears things (cosmetics are drawn for the box figure: a head 8 texels across, a
 * back 8 wide and 12 tall), as its builder knows it rather than measured: the top of its head (its
 * hair, or what's on it) and the width of its head with its hair, not its ears; the middle of its
 * back between the shoulders, and the width a back item is scaled to (the torso's, or less where
 * the torso is short for it, so a pack fits it both ways).
 */
export interface WearFrame {
  top: P3;
  headWidth: number;
  back: P3;
  bodyWidth: number;
}

/** A character's wear frame, from its voxels and build. */
function wearFrame(vox: Blocks, b: Build): WearFrame {
  let crown = (Y.head + 12) * SUB;
  for (const key of vox.parts.get('head')!.keys()) crown = Math.max(crown, cellOf(key)[1] + 1);
  const torso = { width: (2 * b.sh) * VOXEL, height: (Y.chestTop - Y.spine) * VOXEL };
  return {
    top: [0, crown * CELL, -0.5 * VOXEL],
    headWidth: 14 * VOXEL,
    back: [0, (Y.chestTop - 1) * VOXEL, -4 * VOXEL],
    bodyWidth: 0.5 * Math.min(torso.width / 0.5, torso.height / 0.75),
  };
}

/** A character's voxels (a part per bone, `SUB` to a design unit), its colours, its joints (design units). */
function characterCells(look: Required<CharacterLook>): { vox: Voxels; palette: Palette; joints: Record<CharacterJoint, P3>; wear: WearFrame } {
  const build = BUILDS[`${look.build}${look.curvy ? 'Curvy' : ''}`] ?? BUILDS.broad;
  const s: Spec = { b: build, look, top: TOPS[look.top] ?? TOPS.tee };
  const vox = new Blocks();
  for (const j of BONES) vox.part(j);
  body(vox, s);
  dress(vox, s);
  return { vox: vox.cells, palette: palette(s), joints: joints(build), wear: wearFrame(vox, build) };
}

/**
 * A character's voxels by design cell (26 a metre: a cell most of whose voxels are filled, in the
 * colour most of them are), for tools that paint over a character at that size (Arena's
 * monsters).
 */
export function characterVoxels(look: Required<CharacterLook>): { vox: Voxels; palette: Palette; joints: Record<CharacterJoint, P3>; wear: WearFrame } {
  const made = characterCells(look);
  const vox = new Voxels();
  for (const [part, cells] of made.vox.parts) {
    const blocks = new Map<number, Map<string, number>>();
    for (const [key, c] of cells) {
      const [i, j, k] = cellOf(key).map(down);
      const at = cellKey(i, j, k);
      let n = blocks.get(at);
      if (!n) blocks.set(at, (n = new Map()));
      n.set(c, (n.get(c) ?? 0) + 1);
    }
    const out = vox.part(part);
    for (const [at, n] of blocks) {
      let total = 0;
      let best = '';
      for (const [c, count] of n) {
        total += count;
        if (count > (n.get(best) ?? 0)) best = c;
      }
      if (total * 2 >= SUB ** 3) out.set(at, best);
    }
  }
  return { ...made, vox };
}

/** Build a character from its look (the plain look's where it's silent). */
export function buildCharacter(look: CharacterLook): CharacterMesh {
  const full = { ...PLAIN_LOOK, ...look } as Required<CharacterLook>;
  const { vox, palette: P, joints: J, wear } = characterCells(full);
  const A = bake(vox, P);
  const { position, normal, uv, index } = quadMesh(A.quads, CELL);
  const boneOf = new Map<string, number>(BONES.map((j, i) => [j, i]));
  const bone = new Uint8Array(A.quads.length * 4);
  A.quads.forEach((f, q) => bone.fill(boneOf.get(f.part) ?? 0, q * 4, q * 4 + 4));
  const joints = Object.fromEntries(Object.entries(J).map(([k, v]) => [k, v.map((x) => x * VOXEL) as P3])) as Record<CharacterJoint, P3>;
  let glows = false;
  for (const c of P.colours.values()) glows ||= c.glow > 0;
  return { joints, grips: GRIPS, position, normal, uv, bone, index, atlas: A, glows, wear };
}
