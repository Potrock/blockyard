import { baseX, centre, HEX_W, SEA_Y } from '../geometry';
import { pen, SURFACE_BLOCKS } from '../improvements';
import { MODEL_SIZE, type ModelId } from '../modelids';
import type { KnownTile } from '../protocol';
import type { Grid } from '../rules/hex';
import { PLANT_BLOCKS, TREE_BLOCKS } from '../terrain';

/**
 * Where a tile's resource models stand (`resources3d.ts` places them, and keeps them living): each
 * kind's models, the spots round a tile tried for them, and what makes a spot fit, read from the
 * world's blocks: on the tile, clear, on dry land (or, the sea's, on open water). Nothing here needs
 * a screen, so the rules' tests read it too, over a world of their own.
 */

/** The world's blocks, as a screen has them (`client.world`). */
export interface Blocks {
  blockAt(x: number, y: number, z: number): string;
}

/** How a resource's models live: still; grazing (turning, wandering a step, head down); a school circling; a whale surfacing; crabs scuttling. */
export type Life = 'still' | 'graze' | 'swim' | 'surface' | 'scuttle';

export interface Kind {
  /** Its models: each spot takes the next, in turn. */
  models: ModelId[];
  /** How many on a tile, and how big (a voxel is a sixteenth of a block at 1). */
  count: number;
  scale: number;
  life: Life;
  /** In the sea: on the water's surface (or this far over it, blocks), not the land. */
  sea?: boolean;
  lift?: number;
  /** Something the models stand on, set first in the one spot (crabs' sandbar), and how high its top is (voxels). */
  base?: { model: ModelId; scale: number; top: number };
}

export const KINDS: Partial<Record<string, Kind>> = {
  // Bonus.
  wheat: { models: ['r_wheat'], count: 3, scale: 3, life: 'still' },
  cattle: { models: ['r_cattle', 'r_cattle2', 'r_cattle'], count: 3, scale: 2.9, life: 'graze' },
  sheep: { models: ['r_sheep'], count: 3, scale: 2.9, life: 'graze' },
  deer: { models: ['r_deer'], count: 2, scale: 2.6, life: 'graze' },
  bison: { models: ['r_bison'], count: 2, scale: 2.8, life: 'graze' },
  bananas: { models: ['r_bananas'], count: 2, scale: 3.4, life: 'still' },
  fish: { models: ['r_fish'], count: 2, scale: 2.4, life: 'swim', sea: true, lift: 0.1 },
  stone: { models: ['r_stone'], count: 2, scale: 3.1, life: 'still' },
  // Strategic.
  horses: { models: ['r_horses', 'r_horses2', 'r_horses'], count: 3, scale: 2.5, life: 'graze' },
  iron: { models: ['r_iron'], count: 2, scale: 3.1, life: 'still' },
  coal: { models: ['r_coal'], count: 2, scale: 3.1, life: 'still' },
  oil: { models: ['r_oil'], count: 1, scale: 2.5, life: 'still' },
  aluminum: { models: ['r_aluminum'], count: 2, scale: 3.1, life: 'still' },
  uranium: { models: ['r_uranium'], count: 2, scale: 3.1, life: 'still' },
  // Luxury.
  gold_ore: { models: ['r_gold_ore'], count: 2, scale: 3.1, life: 'still' },
  silver: { models: ['r_silver'], count: 2, scale: 3.1, life: 'still' },
  gems: { models: ['r_gems'], count: 2, scale: 3.1, life: 'still' },
  marble: { models: ['r_marble'], count: 2, scale: 2.6, life: 'still' },
  copper: { models: ['r_copper'], count: 2, scale: 3.1, life: 'still' },
  salt: { models: ['r_salt'], count: 1, scale: 3.4, life: 'still' },
  ivory: { models: ['r_ivory'], count: 1, scale: 2.8, life: 'graze' },
  furs: { models: ['r_furs'], count: 2, scale: 3, life: 'graze' },
  truffles: { models: ['r_truffles'], count: 1, scale: 3, life: 'graze' },
  dyes: { models: ['r_dyes'], count: 3, scale: 3.1, life: 'still' },
  spices: { models: ['r_spices'], count: 3, scale: 3.1, life: 'still' },
  silk: { models: ['r_silk'], count: 2, scale: 3.1, life: 'still' },
  sugar: { models: ['r_sugar'], count: 3, scale: 3, life: 'still' },
  cotton: { models: ['r_cotton'], count: 3, scale: 3.1, life: 'still' },
  wine: { models: ['r_wine'], count: 2, scale: 2.9, life: 'still' },
  incense: { models: ['r_incense'], count: 2, scale: 3.1, life: 'still' },
  citrus: { models: ['r_citrus'], count: 2, scale: 3.1, life: 'still' },
  cocoa: { models: ['r_cocoa'], count: 2, scale: 3.1, life: 'still' },
  whales: { models: ['r_whales'], count: 1, scale: 2.2, life: 'surface', sea: true },
  pearls: { models: ['r_pearls'], count: 1, scale: 2.6, life: 'still', sea: true },
  crab: { models: ['r_crab', 'r_crab', 'r_crab'], count: 3, scale: 2.4, life: 'scuttle', sea: true, base: { model: 'r_sandbar', scale: 2.4, top: 1 } },
};

/**
 * Where a tile's models may stand, from its middle (blocks): round its edge, beside the units in its
 * middle and their flag, clear of the resource's badge (the back right, close in), each tile trying
 * them from a place of its own; and nearer the middle (first, on a wooded tile: its trees are round
 * its edge).
 */
const RING: [number, number][] = [
  [-2.3, 0.2], [1.6, 1.7], [-1.6, 1.8], [2.4, -0.4], [-1.4, -2.0], [0.2, 2.3], [-2.4, -1.0], [0.1, -2.4], [2.2, 0.9], [-0.8, 2.4],
];
const INNER: [number, number][] = [[-1.4, 0.5], [1.3, -0.7], [0.3, -1.5], [-0.6, 1.4]];
/** Inside a pasture's fence (round the middle of its middle column, on the field inside it: `pen`), and how big the beasts are there (it's a small field). */
const PEN: [number, number][] = [[-0.9, -0.7], [0.9, 0.7]];
export const PEN_SCALE = 0.75;
/**
 * Where a model would reach over its tile's edge: drawn in from its spot toward the middle, as far as
 * it must (these shares of the way out); and failing that drawn smaller, though not smaller than this.
 */
const PULLS = [1, 0.85, 0.7, 0.55];
const LEAST = 0.7;
/** How small a land model may be drawn, at the very least, to keep off the water: smaller than this, it isn't drawn. */
const SMALLEST = 0.35;
/** How much bigger than its kind's size a model may be drawn (each a little different: `member`). */
export const GROWN = 1.1;
/** How far apart a tile's models stand, at least (blocks), and as a share of how wide they are. */
const APART = 1.4;
const APART_SHARE = 0.7;
/** Blocks a model can stand among (a field's crops), though not on. */
const CROPS = new Set(['civ_wheat', 'civ_bush', 'civ_cotton', 'dead_bush']);
/** The land's surface where nothing's set on it: not a road, a bridge or a river. */
export const OPEN = new Set([...SURFACE_BLOCKS].filter((b) => !['civ_road', 'civ_rail_x', 'civ_rail_z', 'spruce_planks', 'water', 'ice'].includes(b)));
/** The water's surface, where the sea's models float. */
export const SURFACE = SEA_Y + 0.88;

/** Where a model stands (blocks: x, the ground's top or the water's surface, z), how big it's drawn (a share of its size), and (standing still) its quarter turns. */
export interface Spot {
  x: number;
  y: number;
  z: number;
  size: number;
  turn?: number;
}

/** A tile's own small random number, the same every time (the k-th). */
export const hash = (t: number, k: number) => ((Math.imul(t + 7919, 73856093) ^ Math.imul(k + 13, 19349663)) >>> 0) / 4294967296;

/**
 * Where a tile's models go: as many as its kind has of the spots that are clear, apart from each other
 * (in a pasture, inside its fence), each wholly on the tile and (on land) wholly on dry land, none of
 * it over a river (its channels run through the tile's middle), a marsh's pools or a lake; if none is
 * clear, the one where it can at least stand (half hidden by a tree, say) that it's biggest at; if
 * there's nowhere dry, none. Null if the tile's ground isn't here yet (its chunk not loaded).
 */
export function spotsFor(world: Blocks, g: Grid, t: number, kind: Kind, k: KnownTile): Spot[] | null {
  const c = centre(g, t);
  const { improvement, pillaged } = k;
  const wooded = k.feature === 'forest' || k.feature === 'jungle';
  const tops = new Map<number, Top | null>();
  const top = (bx: number, bz: number) => {
    const key = bx * 4096 + bz;
    let hit = tops.get(key);
    if (hit === undefined) tops.set(key, (hit = topOf(world, g, bx, bz)));
    return hit;
  };
  // (The ground itself, under any tree over it: a river under a tree's leaves is still a river.)
  const grounds = new Map<number, Top | null>();
  const floor = (bx: number, bz: number) => {
    const key = bx * 4096 + bz;
    let hit = grounds.get(key);
    if (hit === undefined) grounds.set(key, (hit = topOf(world, g, bx, bz, true)));
    return hit;
  };
  const size = MODEL_SIZE[kind.base?.model ?? kind.models[0]];
  const across = (Math.max(size.hi[0] - size.lo[0], size.hi[2] - size.lo[2]) / 16) * (kind.base?.scale ?? kind.scale);
  const apart = Math.max(APART, across * APART_SHARE);
  const away = (out: Spot[], x: number, z: number) => out.every((o) => Math.hypot(o.x - x, o.z - z) >= apart);
  // Improved: the improvement shows much of it already (a mine's ore, a quarry's cut stone), the resource itself beside it; an oil well has its own pool.
  let count = kind.count;
  if (improvement && !pillaged && kind.life === 'still' && !kind.sea && improvement !== 'plantation' && improvement !== 'farm') count = 1;
  if ((improvement === 'oil_well' || improvement === 'offshore_platform') && k.resource === 'oil' && !pillaged) return [];
  const penned = improvement === 'pasture' && kind.life === 'graze';
  const scale = kind.scale * (penned ? PEN_SCALE : 1) * GROWN;
  // How far its models reach round where they stand as they turn (crabs, round on their sandbar too).
  const round = kind.base ? Math.max(reachOf(kind.base.model, kind.base.scale), 0.6 + reachOf(kind.models[0], scale)) : Math.max(...kind.models.map((id) => reachOf(id, scale)));
  /**
   * How big the n-th model may be drawn at a point (0: not at all); and if it stands still (square with
   * the land), the quarter turn it fits best at, its own first. A land model is drawn smaller, if it
   * must be, until none of it's over water: one that turns as it lives (a grazer), as it first faces
   * (as `place` turns it; it turns and steps after only where it stays dry), though it keeps within
   * the tile all round.
   */
  const sized = (x: number, z: number, n: number): { size: number; turn?: number } => {
    const shrunk = (share: number, foot: (size: number) => [number, number][] | number) => {
      if (kind.sea) return share;
      while (share >= SMALLEST && !dry(floor, x, z, foot(share))) share *= 0.85;
      return share >= SMALLEST ? share : 0;
    };
    const id = kind.models[n % kind.models.length];
    if (kind.life !== 'still' || kind.base) {
      const yaw = Math.atan2(x - c.x, z - c.z) + (hash(t, n + 20) - 0.5) * 2;
      return { size: shrunk(fit(x - c.x, z - c.z, round), (size) => corners(id, scale * size, yaw)) };
    }
    const own = Math.floor(hash(t, n + 20) * 4);
    let best = { size: -1, turn: own };
    for (let q = 0; q < 4 && best.size < 1; q++) {
      const turn = (own + q) % 4;
      const share = shrunk(fit(x - c.x, z - c.z, corners(id, scale, turn * (Math.PI / 2))), (size) => corners(id, scale * size, turn * (Math.PI / 2)));
      if (share > best.size) best = { size: share, turn };
    }
    return best;
  };
  if (kind.sea) {
    const out: Spot[] = [];
    const reach = Math.max(1, Math.round(across / 2 - 0.5));
    const y = SURFACE + (kind.lift ?? 0);
    let afloat: Spot | null = null;
    for (const [ox, oz] of [...turned(t), [0, 0]]) {
      if (out.length >= (kind.base ? 1 : count)) break;
      let pick: Spot | null = null;
      for (const pull of PULLS) {
        const x = c.x + ox * (reach > 1 ? 0.75 : 1) * pull;
        const z = c.z + oz * (reach > 1 ? 0.75 : 1) * pull;
        const open = openWater(top, x, z, reach);
        if (open === null) return null;
        const spot = { x, y, z, ...sized(x, z, out.length) };
        if (open === false && openWater(top, x, z, 0) && (!afloat || spot.size > afloat.size)) afloat = spot;
        if (!open || !away(out, x, z)) continue;
        if (!pick || spot.size > pick.size) pick = spot;
        if (spot.size >= 1) break;
      }
      if (pick && pick.size >= LEAST) out.push(pick);
    }
    if (!out.length && afloat) out.push(afloat);
    return out;
  }
  // In the pen: round the middle of the tile's middle column, on the dry field inside the fence (the
  // nearest of it, where the tile's edge cuts off a corner of the pen, or a river runs through it). A
  // pen with no dry field has its beasts where the tile's other spots are.
  const field = penned ? pen(g, t).field.filter(([fx, fz]) => dry(floor, fx + 0.5, fz + 0.5, 0)) : [];
  if (field.length) {
    const mx = Math.floor(c.x) + 0.5;
    const mz = Math.floor(c.z) + 0.5;
    const out: Spot[] = [];
    for (const [ox, oz] of PEN.slice(0, count)) {
      let x = mx + ox;
      let z = mz + oz;
      if (!field.some(([fx, fz]) => fx === Math.floor(x) && fz === Math.floor(z))) {
        const off = ([fx, fz]: [number, number]) => Math.hypot(fx + 0.5 - x, fz + 0.5 - z);
        const [fx, fz] = field.reduce((a, b) => (off(b) < off(a) ? b : a));
        x = fx + 0.5;
        z = fz + 0.5;
      }
      const y = groundTop(world, g, x, z);
      if (y === null) return null;
      const spot = { x, y, z, ...sized(x, z, out.length) };
      if (spot.size > 0 && away(out, x, z)) out.push(spot);
    }
    if (out.length) return out;
  }
  const out: Spot[] = [];
  let standing: Spot | null = null;
  // (In the woods, the trees stand round the tile's edge: its middle's the open ground.)
  for (const [ox, oz] of wooded ? [...INNER, ...turned(t)] : [...turned(t), ...INNER]) {
    if (out.length >= count) break;
    let pick: Spot | null = null;
    for (const pull of PULLS) {
      // (On a column's middle: a field's crops are on every other column, the gaps between them free.)
      const x = Math.floor(c.x + ox * pull) + 0.5;
      const z = Math.floor(c.z + oz * pull) + 0.5;
      const at = ground(top, x, z);
      if (at === undefined) return null;
      if (!at) continue;
      const spot = { x, y: at.y, z, ...sized(x, z, out.length) };
      if (spot.size > (standing?.size ?? 0)) standing = spot;
      if (!at.clear || !away(out, x, z)) continue;
      if (!pick || spot.size > pick.size) pick = spot;
      if (spot.size >= 1) break;
    }
    if (pick && pick.size >= LEAST) out.push(pick);
  }
  if (!out.length && standing) out.push(standing);
  return out;
}

/** The spots round a tile's edge, from a place of its own. */
function turned(t: number): [number, number][] {
  const from = Math.floor(hash(t, 1) * RING.length);
  return RING.map((_, i) => RING[(from + i) % RING.length]);
}

/** The hex's three ways across (its sides face them), and how far its sides are from its middle. */
const ACROSS = [0, 1, 2].map((i) => [Math.cos((Math.PI / 3) * i), Math.sin((Math.PI / 3) * i)]);
const SIDE = HEX_W / 2;

/**
 * How big a model may be drawn at a point (blocks from its tile's middle) and stand wholly on the tile:
 * a share of its size, 1 at most. `foot` is its footprint's corners (blocks from the point, turned as
 * it stands), or how far it reaches all round it (as it turns).
 */
export function fit(px: number, pz: number, foot: [number, number][] | number): number {
  let k = 1;
  for (const [ax, az] of ACROSS) {
    const p = px * ax + pz * az;
    if (typeof foot === 'number') k = Math.min(k, (SIDE - Math.abs(p)) / foot);
    else
      for (const [vx, vz] of foot) {
        const q = vx * ax + vz * az;
        if (q > 0) k = Math.min(k, (SIDE - p) / q);
        else if (q < 0) k = Math.min(k, (SIDE + p) / -q);
      }
  }
  return Math.max(0, k);
}

/**
 * Whether a model's footprint at a point is all over dry land (its corners, from the point, as it
 * stands; or how far it reaches all round it, as it turns): none of it over water, a river's, a
 * marsh's pools or a lake. (Ground not here yet counts as dry: the model's own spot waits for it.)
 */
export function dry(top: (bx: number, bz: number) => Top | null, x: number, z: number, foot: [number, number][] | number): boolean {
  const wet = (px: number, pz: number) => {
    const hit = top(Math.floor(px), Math.floor(pz));
    return !!hit && (hit.block === 'water' || hit.block === 'ice');
  };
  if (typeof foot === 'number') {
    if (wet(x, z)) return false;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      if (wet(x + Math.cos(a) * foot, z + Math.sin(a) * foot) || wet(x + Math.cos(a) * foot * 0.5, z + Math.sin(a) * foot * 0.5)) return false;
    }
    return true;
  }
  // (Across the footprint a half at a time: a river's channel is two columns wide, too wide to slip between.)
  const [a, b, , d] = foot;
  for (const u of [0, 0.5, 1]) for (const v of [0, 0.5, 1]) if (wet(x + a[0] + (b[0] - a[0]) * u + (d[0] - a[0]) * v, z + a[1] + (b[1] - a[1]) * u + (d[1] - a[1]) * v)) return false;
  return true;
}

/** A model's footprint's corners at a scale (blocks from where it stands), turned to a yaw (as its holder's turns it). */
export function corners(id: ModelId, scale: number, yaw: number): [number, number][] {
  const { lo, hi } = MODEL_SIZE[id];
  return facing([[lo[0], lo[2]], [hi[0], lo[2]], [hi[0], hi[2]], [lo[0], hi[2]]].map(([x, z]) => [(x * scale) / 16, (z * scale) / 16]), yaw);
}

/** A footprint, as it stands unturned, turned to a yaw (as a holder's `rotation.y` turns what's in it). */
export function facing(foot: [number, number][], yaw: number): [number, number][] {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return foot.map(([x, z]) => [x * cos + z * sin, z * cos - x * sin]);
}

/** How far a model reaches from where it stands, at a scale (blocks): all round, as it turns. */
export function reachOf(id: ModelId, scale: number): number {
  const { lo, hi } = MODEL_SIZE[id];
  return (Math.hypot(Math.max(-lo[0], hi[0]), Math.max(-lo[2], hi[2])) * scale) / 16;
}

/** A column's first block down from above the trees: what it is and how high. */
export type Top = { y: number; block: string };

/**
 * A column's top, under any plant on it (and, `under` the trees, any tree over it); null if there's
 * nothing (its chunk isn't here). Round a world that wraps, read where it's built.
 */
export function topOf(world: Blocks, g: Grid, bx: number, bz: number, under = false): Top | null {
  bx = baseX(g, bx);
  for (let y = SEA_Y + 13; y >= SEA_Y - 1; y--) {
    const b = world.blockAt(bx, y, bz);
    if (b !== 'air' && !PLANT_BLOCKS.has(b) && !(under && TREE_BLOCKS.has(b))) return { y, block: b };
  }
  return null;
}

/** The top of the land at a point, whatever's on it (null: not here yet). */
function groundTop(world: Blocks, g: Grid, x: number, z: number): number | null {
  const bx = baseX(g, Math.floor(x));
  for (let y = SEA_Y + 13; y >= SEA_Y - 1; y--) if (SURFACE_BLOCKS.has(world.blockAt(bx, y, Math.floor(z)))) return y + 1;
  return null;
}

/** The columns round a spot that something tall hides it behind or crowds (the camera looks from the south: a tree there hides what's just north of it). */
const AROUND: [number, number][] = [[1, 0], [-1, 0], [0, -1], [-1, 1], [0, 1], [1, 1], [-1, 2], [0, 2], [1, 2]];

/**
 * A point's ground, if a model can stand there: open land on its column (no road, no water, nothing
 * built or growing on it), its top; and whether it's clear (nothing taller than a field's crops next
 * to it, nor in front of it toward the camera: no tree, no wall, no fence). Null where it can't
 * stand; undefined if the ground isn't here yet.
 */
function ground(top: (bx: number, bz: number) => Top | null, x: number, z: number): { y: number; clear: boolean } | null | undefined {
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  const own = top(bx, bz);
  if (!own) return undefined;
  if (!OPEN.has(own.block)) return null;
  const clear = AROUND.every(([dx, dz]) => {
    const n = top(bx + dx, bz + dz);
    return !n || SURFACE_BLOCKS.has(n.block) || CROPS.has(n.block) || n.y <= own.y + (dz > 0 ? 1 : 0);
  });
  return { y: own.y + 1, clear };
}

/** Whether the sea round a point is open, `reach` columns each way (nothing on the water: boats, a platform; no land); null if it isn't here yet. */
function openWater(top: (bx: number, bz: number) => Top | null, x: number, z: number, reach: number): boolean | null {
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  if (!top(bx, bz)) return null;
  for (let dx = -reach; dx <= reach; dx++)
    for (let dz = -reach; dz <= reach; dz++) {
      const n = top(bx + dx, bz + dz);
      if (n && (n.block !== 'water' || n.y !== SEA_Y)) return false;
    }
  return true;
}
