import { Blueprint, type BlockRef, type Vec3 } from '@platform';

export type TeamColor = 'red' | 'blue' | 'green' | 'yellow';

/** One team's island. All positions are world block coordinates. */
export interface TeamBase {
  color: TeamColor;
  /** The two bed blocks (`<color>_bed`), side by side. Breaking either one destroys the bed. */
  bed: [Vec3, Vec3];
  /** Where team members (re)spawn: the block they stand on is at y - 1. */
  spawn: Vec3;
  /** Facing when spawning (radians; 0 looks toward -z, PI/2 toward -x). */
  spawnYaw: number;
  /** The resource generator: iron and gold drop here (centre of the top of its pad, y = pad top + 1). */
  generator: Vec3;
  /** Where the shopkeeper stands (feet), and which way it faces. */
  shop: Vec3;
  shopYaw: number;
}

export interface BedwarsMap {
  blueprints: Blueprint[];
  /** Red, blue, green, yellow (in that order). */
  teams: TeamBase[];
  /** Diamond generators (drop points), on the small islands. */
  diamonds: Vec3[];
  /** Emerald generators (drop points), on the centre island. */
  emeralds: Vec3[];
  /** The centre of the map (top of the middle island). */
  center: Vec3;
  /** Anything below this falls into the void and dies. */
  voidY: number;
}

// ---------------------------------------------------------------------------------------------
// Layout. Every walkable floor's top block is at y = FLOOR, so players stand at y = FLOOR + 1
// everywhere and bridges between islands are flat.
//
//   team islands  15 wide x 21 deep, front edge 27 and back edge 47 blocks from the centre
//   diamond       7x7 (round) at (+-26, +-26), beside the front corners of two team islands
//   centre        21x21 octagon, two 1-block tiers on top, emeralds on the diagonal
//
// Gaps: team front edge -> centre 16 blocks, team front corner -> diamond island 15 blocks.
// ---------------------------------------------------------------------------------------------

const FLOOR = 79;
const FEET = FLOOR + 1;
const VOID_Y = 48;

const TEAM_FRONT = 27;
const TEAM_BACK = 47;
const TEAM_HALF = 7;
const DIAMOND_AT = 26;
const MID_HALF = 10;

// Where things sit on a team island, in its local frame: `a` runs across the island (-7..7),
// `r` is the distance from the map centre (27 at the front edge, 47 at the back).
const SPAWN_R = 36;
const BED_R = 42;
const GEN = { a: -5, r: 35 };
const SHOP = { a: 5, r: 35 };

const COLORS: TeamColor[] = ['red', 'blue', 'green', 'yellow'];
/** Unit direction from the centre to each team (red +z, blue +x, green -z, yellow -x). */
const DIRS: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

// --- Deterministic noise ----------------------------------------------------------------------

function hash(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** Smooth 2D value noise in 0..1. */
function noise(x: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash(xi, 0, zi, seed) + (hash(xi + 1, 0, zi, seed) - hash(xi, 0, zi, seed)) * sx;
  const b = hash(xi, 0, zi + 1, seed) + (hash(xi + 1, 0, zi + 1, seed) - hash(xi, 0, zi + 1, seed)) * sx;
  return a + (b - a) * sz;
}

// --- Floating islands -------------------------------------------------------------------------

interface Footprint {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  inside(x: number, z: number): boolean;
}

interface IslandStyle {
  seed: number;
  /** How many blocks the underside deepens per block away from the rim. */
  taper: number;
  /** Deepest the underside gets below the floor (before hanging spikes). */
  maxDepth: number;
  /** How far the hanging rock spikes (clumps under the island) reach below the rest. */
  spikes: number;
  /** Glowing tips on the underside (the centre island). */
  glow?: boolean;
  /** The layer under the rim of the floor (default stone bricks, a built edge). */
  band?: BlockRef;
}

/** Distance from each column to the nearest column outside the footprint (rim columns = 1). */
function rimDistance(fp: Footprint): (x: number, z: number) => number {
  const w = fp.x1 - fp.x0 + 1;
  const d = new Float32Array(w * (fp.z1 - fp.z0 + 1));
  const R = 14;
  for (let z = fp.z0; z <= fp.z1; z++)
    for (let x = fp.x0; x <= fp.x1; x++) {
      if (!fp.inside(x, z)) continue;
      let best = R;
      for (let oz = -R; oz <= R; oz++)
        for (let ox = -R; ox <= R; ox++) {
          const dist = Math.hypot(ox, oz);
          if (dist < best && !fp.inside(x + ox, z + oz)) best = dist;
        }
      d[(z - fp.z0) * w + (x - fp.x0)] = best;
    }
  return (x, z) => d[(z - fp.z0) * w + (x - fp.x0)];
}

/** Rock for the underside: a dirt band under the floor, then banded stone, darker at the bottom. */
function rock(x: number, y: number, z: number, k: number, depth: number, s: IslandStyle): BlockRef {
  const h = hash(x, y, z, s.seed + 11);
  if (k <= 2 || (k === 3 && hash(x, 0, z, s.seed + 3) < 0.5)) return h < 0.05 ? 'gravel' : 'dirt';
  if (k === depth && s.glow && hash(x, 0, z, s.seed + 5) < 0.18) return 'glowstone';
  if (k >= depth - 1 && h < 0.45) return 'cobblestone';
  if (k > 10 && h < 0.55) return 'deepslate';
  const band = Math.sin(y * 0.8 + noise(x / 5, z / 5, s.seed) * 5);
  if (band > 0.6) return 'andesite';
  if (h < 0.07) return 'cobblestone';
  if (h < 0.1) return 'granite';
  if (h < 0.12 && k < 7) return 'dirt';
  return 'stone';
}

/**
 * A floating island: `floor` paints the top layer (y = FLOOR), a stone-brick band sits under the
 * rim, and the underside tapers down (dirt, then stone strata) with a few hanging spikes.
 */
function floatingIsland(fp: Footprint, style: IslandStyle, floor: (x: number, z: number, rim: number) => BlockRef): Blueprint {
  const top = FLOOR + 25;
  const bottom = VOID_Y + 2;
  const bp = new Blueprint({ x: fp.x0 - 4, y: bottom, z: fp.z0 - 4 }, { x: fp.x1 - fp.x0 + 9, y: top - bottom + 1, z: fp.z1 - fp.z0 + 9 });
  const rim = rimDistance(fp);
  for (let z = fp.z0; z <= fp.z1; z++)
    for (let x = fp.x0; x <= fp.x1; x++) {
      if (!fp.inside(x, z)) continue;
      const e = rim(x, z);
      const n = noise(x / 4, z / 4, style.seed);
      let depth = Math.round(Math.min(style.maxDepth * (0.85 + 0.3 * n), 2 + (e - 1) * style.taper * (0.7 + 0.6 * n)));
      const clump = noise(x / 2.3, z / 2.3, style.seed + 9);
      if (e >= 1.5 && clump > 0.58) depth += Math.round(((clump - 0.58) / 0.42) * style.spikes * (0.6 + 0.4 * Math.min(1, e / 4)));
      depth = Math.min(depth, FLOOR - bottom);
      bp.set(x, FLOOR, z, floor(x, z, e));
      bp.set(x, FLOOR - 1, z, e < 1.5 ? (style.band ?? 'stone_bricks') : 'dirt');
      for (let k = 2; k <= depth; k++) bp.set(x, FLOOR - k, z, rock(x, FLOOR - k, z, k, depth, style));
    }
  return bp;
}

// --- Small builds -----------------------------------------------------------------------------

/** A 3x3 generator pad raised one block (top at FLOOR + 1); returns the drop point above its centre. */
function pad(bp: Blueprint, cx: number, cz: number, corner: BlockRef, edge: BlockRef, middle: BlockRef): Vec3 {
  bp.fill({ x: cx - 1, y: FEET, z: cz - 1 }, { x: cx + 1, y: FEET, z: cz + 1 }, (x, _y, z) =>
    x === cx && z === cz ? middle : x !== cx && z !== cz ? corner : edge,
  );
  return { x: cx + 0.5, y: FEET + 1, z: cz + 0.5 };
}

/** Yaw that looks from `from` toward `to` (0 = -z, PI/2 = -x). */
function yawToward(from: Vec3, to: Vec3): number {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

// --- Team islands -----------------------------------------------------------------------------

function teamIsland(color: TeamColor, [dx, dz]: [number, number], seed: number): { bp: Blueprint; base: TeamBase } {
  const wool = `${color}_wool`;
  // Local (a, r) <-> world (x, z). `a` turns the same way on every island, so all four are rotated copies.
  const toWorld = (a: number, r: number) => ({ x: dx * r + dz * a, z: dz * r - dx * a });
  const toLocal = (x: number, z: number) => ({ a: dz * x - dx * z, r: dx * x + dz * z });
  const insideLocal = (a: number, r: number) => {
    if (Math.abs(a) > TEAM_HALF || r < TEAM_FRONT || r > TEAM_BACK) return false;
    // Round off the back corners; the front stays square for bridging.
    return Math.abs(a) - 5 + (r - (TEAM_BACK - 2)) <= 2;
  };
  const c1 = toWorld(-TEAM_HALF, TEAM_FRONT);
  const c2 = toWorld(TEAM_HALF, TEAM_BACK);
  const fp: Footprint = {
    x0: Math.min(c1.x, c2.x),
    z0: Math.min(c1.z, c2.z),
    x1: Math.max(c1.x, c2.x),
    z1: Math.max(c1.z, c2.z),
    inside: (x, z) => {
      const { a, r } = toLocal(x, z);
      return insideLocal(a, r);
    },
  };

  // The bed's two blocks pair up along x, foot then head; on the x-axis islands the head goes
  // outward so every bed is 42..43 from the centre.
  const bedCell = toWorld(0, BED_R);
  const bedCell2 = { x: bedCell.x + (dx < 0 ? -1 : 1), z: bedCell.z };
  const bedCells = [bedCell, bedCell2].map((c) => toLocal(c.x, c.z));
  // The bed deck: 3 blocks of open planks all round the bed, room for wool defences.
  const deckA0 = Math.min(...bedCells.map((c) => c.a)) - 3;
  const deckA1 = Math.max(...bedCells.map((c) => c.a)) + 3;
  const deckR0 = Math.min(...bedCells.map((c) => c.r)) - 3;
  const deckR1 = Math.max(...bedCells.map((c) => c.r)) + 3;
  const garden = (a: number, r: number) => Math.abs(a) >= 5 && r >= TEAM_BACK - 3;
  const floorAt = (x: number, z: number, e: number): BlockRef => {
    const { a, r } = toLocal(x, z);
    const la = Math.abs(a);
    const h = hash(x, 0, z, seed);
    if (r === TEAM_FRONT) return wool; // the starting line for bridges
    if (la <= 1 && Math.abs(r - SPAWN_R) <= 1) return a === 0 && r === SPAWN_R ? 'sea_lantern' : wool;
    if (la <= 1 && r > TEAM_FRONT && r < SPAWN_R - 1) return a === 0 ? wool : 'light_gray_concrete';
    if (a >= deckA0 && a <= deckA1 && r >= deckR0 && r <= deckR1) {
      const corner = (a === deckA0 || a === deckA1) && (r === deckR0 || r === deckR1);
      return corner ? wool : 'spruce_planks';
    }
    if (Math.abs(a - GEN.a) <= 2 && Math.abs(r - GEN.r) <= 2) return 'light_gray_concrete';
    if (Math.abs(a - SHOP.a) <= 2 && Math.abs(r - SHOP.r) <= 2) return 'oak_planks';
    if (garden(a, r)) return 'grass_block';
    if (la === 6 && r === TEAM_FRONT + 1) return 'glowstone';
    if (e < 1.5) return 'andesite';
    if (h < 0.05) return 'mossy_cobblestone';
    if (h < 0.1) return 'cobblestone';
    return 'stone_bricks';
  };
  const bp = floatingIsland(fp, { seed, taper: 1.5, maxDepth: 14, spikes: 9 }, floorAt);
  const put = (a: number, y: number, r: number, block: BlockRef) => {
    const w = toWorld(a, r);
    bp.set(w.x, y, w.z, block);
  };

  // The bed.
  const bed: [Vec3, Vec3] = [
    { x: bedCell.x, y: FEET, z: bedCell.z },
    { x: bedCell2.x, y: FEET, z: bedCell2.z },
  ];
  const facing = bedCell2.x > bedCell.x ? 'east' : 'west';
  bp.set(bed[0].x, bed[0].y, bed[0].z, `${color}_bed[facing=${facing},part=foot]`);
  bp.set(bed[1].x, bed[1].y, bed[1].z, `${color}_bed[facing=${facing},part=head]`);

  // Resource generator.
  const g = toWorld(GEN.a, GEN.r);
  const generator = pad(bp, g.x, g.z, 'gold_ore', 'iron_block', 'glowstone');

  // Shop stall: log posts, a bookshelf back wall and a striped awning.
  for (const [a, r] of [[3, SHOP.r - 2], [3, SHOP.r + 2], [7, SHOP.r - 2], [7, SHOP.r + 2]])
    for (let y = FEET; y < FEET + 3; y++) put(a, y, r, 'spruce_log');
  for (let r = SHOP.r - 1; r <= SHOP.r + 1; r++) for (let y = FEET; y < FEET + 2; y++) put(7, y, r, 'bookshelf');
  for (let a = 3; a <= 7; a++)
    for (let r = SHOP.r - 2; r <= SHOP.r + 2; r++) put(a, FEET + 3, r, (r - SHOP.r) % 2 === 0 ? wool : 'white_wool');
  for (const r of [SHOP.r - 1, SHOP.r + 1]) put(3, FEET + 2, r, wool);
  put(3, FEET + 4, SHOP.r - 2, 'torch');
  put(3, FEET + 4, SHOP.r + 2, 'torch');

  // Flag poles at the back corners, flags flying outward.
  for (const side of [-1, 1]) {
    const a = side * 6;
    const r = TEAM_BACK - 2;
    for (let y = FEET; y < FEET + 8; y++) put(a, y, r, 'spruce_log');
    put(a, FEET + 8, r, 'glowstone');
    for (let i = 1; i <= 4; i++) for (let y = FEET + 5; y <= FEET + 7; y++) if (i < 4 || y === FEET + 6) put(a + side * i, y, r, wool);
    // A hedge along the rounded corner, flowers in the grass.
    for (const [ha, hr] of [[7, TEAM_BACK - 2], [6, TEAM_BACK - 1], [5, TEAM_BACK]]) put(side * ha, FEET, hr, 'oak_leaves');
    for (let fa = 5; fa <= 7; fa++)
      for (let fr = TEAM_BACK - 3; fr <= TEAM_BACK; fr++) {
        const w = toWorld(side * fa, fr);
        if (!insideLocal(side * fa, fr) || bp.get(w.x, FEET, w.z) !== undefined) continue;
        const f = hash(w.x, 5, w.z, seed);
        if (f < 0.55) bp.set(w.x, FEET, w.z, f < 0.15 ? 'poppy' : f < 0.25 ? 'dandelion' : 'short_grass');
      }
  }

  const s = toWorld(0, SPAWN_R);
  const spawn = { x: s.x + 0.5, y: FEET, z: s.z + 0.5 };
  const sh = toWorld(SHOP.a, SHOP.r);
  const shop = { x: sh.x + 0.5, y: FEET, z: sh.z + 0.5 };
  return {
    bp,
    base: {
      color,
      bed,
      spawn,
      spawnYaw: yawToward(spawn, { x: 0.5, y: FEET, z: 0.5 }),
      generator,
      shop,
      shopYaw: yawToward(shop, spawn),
    },
  };
}

// --- Diamond islands --------------------------------------------------------------------------

function diamondIsland(cx: number, cz: number, seed: number): { bp: Blueprint; drop: Vec3 } {
  const fp: Footprint = {
    x0: cx - 3,
    z0: cz - 3,
    x1: cx + 3,
    z1: cz + 3,
    inside: (x, z) => Math.hypot(x - cx, z - cz) <= 3.7,
  };
  const bp = floatingIsland(fp, { seed, taper: 2.4, maxDepth: 11, spikes: 7, band: 'dirt' }, (x, z) => {
    const h = hash(x, 0, z, seed);
    return h < 0.25 ? 'mossy_cobblestone' : h < 0.35 ? 'cobblestone' : 'grass_block';
  });
  const drop = pad(bp, cx, cz, 'obsidian', 'diamond_ore', 'sea_lantern');
  bp.fill({ x: cx - 3, y: FEET, z: cz - 3 }, { x: cx + 3, y: FEET, z: cz + 3 }, (x, _y, z) => {
    if (bp.get(x, FEET, z) !== undefined || bp.get(x, FLOOR, z) !== 'grass_block') return undefined;
    const f = hash(x, 6, z, seed);
    return f < 0.3 ? 'short_grass' : f < 0.36 ? 'cornflower' : undefined;
  });
  return { bp, drop };
}

// --- The centre -------------------------------------------------------------------------------

/** The team whose side of the map a centre-island cell faces. */
function facing(x: number, z: number): TeamColor {
  return Math.abs(z) > Math.abs(x) ? (z > 0 ? 'red' : 'green') : x > 0 ? 'blue' : 'yellow';
}

function centreIsland(seed: number): { bp: Blueprint; emeralds: Vec3[]; center: Vec3 } {
  const octagon = (x: number, z: number, half: number, cut: number) =>
    Math.abs(x) <= half && Math.abs(z) <= half && Math.abs(x) + Math.abs(z) <= 2 * half - cut;
  const fp: Footprint = {
    x0: -MID_HALF,
    z0: -MID_HALF,
    x1: MID_HALF,
    z1: MID_HALF,
    inside: (x, z) => octagon(x, z, MID_HALF, 4),
  };
  const bp = floatingIsland(fp, { seed, taper: 1.6, maxDepth: 20, spikes: 10, glow: true }, (x, z, e) => {
    const ax = Math.abs(x);
    const az = Math.abs(z);
    const h = hash(x, 0, z, seed);
    // Team-coloured landings where each team's bridge arrives.
    if (e < 1.5 && Math.min(ax, az) <= 1) return `${facing(x, z)}_wool`;
    if (Math.min(ax, az) <= 1) return 'white_concrete';
    const d = Math.hypot(x, z);
    if (d >= 7.5 && d < 8.5) return 'andesite';
    if (e < 1.5) return 'andesite';
    if (h < 0.06) return 'mossy_cobblestone';
    return 'stone_bricks';
  });
  // Middle tier (one block up) and the crown (two up).
  bp.fill({ x: -5, y: FEET, z: -5 }, { x: 5, y: FEET, z: 5 }, (x, _y, z) => {
    if (!octagon(x, z, 5, 2)) return undefined;
    const rimCell = !octagon(x + 1, z, 5, 2) || !octagon(x - 1, z, 5, 2) || !octagon(x, z + 1, 5, 2) || !octagon(x, z - 1, 5, 2);
    return rimCell ? 'stone_bricks' : (x + z) % 2 === 0 ? 'white_concrete' : 'diorite';
  });
  bp.fill({ x: -2, y: FEET + 1, z: -2 }, { x: 2, y: FEET + 1, z: 2 }, (x, _y, z) => {
    if (!octagon(x, z, 2, 1)) return undefined;
    // Where the four teams meet: each quarter in the colour of the team it faces.
    if (x === 0 && z === 0) return 'sea_lantern';
    if (Math.abs(x) === Math.abs(z)) return 'white_concrete';
    return `${facing(x, z)}_wool`;
  });
  // A gateway over each team's landing: posts either side, a lintel with the team's colour.
  COLORS.forEach((color, i) => {
    const [dx, dz] = DIRS[i];
    const at = (a: number, y: number, r: number, block: BlockRef) => bp.set(dx * r + dz * a, y, dz * r - dx * a, block);
    for (const a of [-4, 4]) {
      for (let y = FEET; y < FEET + 5; y++) at(a, y, MID_HALF - 1, 'stone_bricks');
      at(a, FEET + 5, MID_HALF - 1, 'glowstone');
    }
    for (let a = -3; a <= 3; a++) at(a, FEET + 5, MID_HALF - 1, Math.abs(a) <= 1 ? `${color}_wool` : 'stone_bricks');
    for (let a = -1; a <= 1; a++) at(a, FEET + 4, MID_HALF - 1, `${color}_wool`);
  });
  // A little sky island with a tree, hovering over the crown and out of everyone's way.
  const skyTop = FEET + 15;
  bp.columns(0, 0, 4.4, (x, z, d) => {
    const depth = Math.round(1 + (4.4 - d) * 1.4 + hash(x, 3, z, seed) * 1.5);
    bp.set(x, skyTop, z, 'grass_block');
    for (let k = 1; k <= depth; k++) bp.set(x, skyTop - k, z, k < 2 ? 'dirt' : hash(x, k, z, seed) < 0.3 ? 'andesite' : 'stone');
  });
  for (let y = skyTop + 1; y <= skyTop + 5; y++) bp.set(0, y, 0, 'oak_log');
  for (let y = skyTop + 3; y <= skyTop + 7; y++)
    bp.columns(0, 0, 3, (x, z, d) => {
      const r = y <= skyTop + 5 ? 2.8 : y === skyTop + 6 ? 2 : 1.2;
      if (d <= r && !(x === 0 && z === 0 && y <= skyTop + 5) && hash(x, y, z, seed + 1) > (d > r - 0.8 ? 0.35 : 0)) bp.set(x, y, z, 'oak_leaves');
    });
  const emeralds = [
    pad(bp, 6, 6, 'obsidian', 'green_wool', 'sea_lantern'),
    pad(bp, -6, -6, 'obsidian', 'green_wool', 'sea_lantern'),
  ];
  return { bp, emeralds, center: { x: 0.5, y: FEET + 2, z: 0.5 } };
}

// --- The map ----------------------------------------------------------------------------------

export function buildMap(): BedwarsMap {
  const teams = COLORS.map((color, i) => teamIsland(color, DIRS[i], 100 + i));
  const diamondIslands = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([sx, sz], i) => diamondIsland(sx * DIAMOND_AT, sz * DIAMOND_AT, 200 + i));
  const mid = centreIsland(300);
  return {
    blueprints: [...teams.map((t) => t.bp), ...diamondIslands.map((d) => d.bp), mid.bp],
    teams: teams.map((t) => t.base),
    diamonds: diamondIslands.map((d) => d.drop),
    emeralds: mid.emeralds,
    center: mid.center,
    voidY: VOID_Y,
  };
}
