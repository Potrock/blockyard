import { baseX, centre, centreNear, HEX, HEX_W, hexW, SEA_Y, tileAt, UNIT_SPOTS } from './geometry';
import { neighbour, type Grid } from './rules/hex';
import type { Game } from './rules/state';
import { TERRAINS } from './rules/terrain';
import { PLANT_BLOCKS, TREE_BLOCKS, type Edit } from './terrain';

/**
 * The land's improvements and roads in blocks, as the server sets them in the world (`server.ts`):
 * farms are ploughed fields of wheat, mines a shaft in a rocky mound with ore by it, pastures fenced
 * with their beasts, plantations rows of bushes, camps a tent and a fire, quarries cut stone and a
 * crane, lumber mills a sawmill and its logs, trading posts a stall, forts and citadels walls,
 * oil wells a derrick, offshore platforms out on the water (fishing boats are each screen's own,
 * afloat: `client/life.ts`), a great person's improvement its building; roads a track of packed
 * earth from each tile's middle to the next (a bridge over a river), railroads rails along it.
 * Pillaged, they're burnt and broken. Where a city stood and is gone (razed, or burnt to nothing),
 * its ruins: the stubs of its wall, its houses' footings, ash. They go over the land's plants (a
 * tuft of grass, reeds), which come back when they go.
 *
 * What a tile shows is said by its `decorKey`; the server compares them as the game goes and changes
 * only the tiles whose key has changed. Each block is placed only where what it covers is still
 * there (a tree's trunk isn't overwritten), and taken back only where it still stands. Round a world
 * that wraps, a tile on its seam is built on both sides of it (each block at its place in the world
 * as built: `baseX`).
 */

/** A block set for a tile: where, what, and what was there before (put back when it goes). */
export type Placed = [x: number, y: number, z: number, block: string, under: string];

/** Blocks that are the land's surface (a column's top): units stand on these, among anything else. */
export const SURFACE_BLOCKS = new Set([
  'civ_grass', 'civ_plains', 'civ_desert', 'civ_tundra', 'civ_snow', 'civ_floodplain', 'civ_marsh', 'civ_dirt', 'civ_rock', 'civ_coast_floor', 'civ_ocean_floor',
  'water', 'ice', 'civ_farmland', 'civ_road', 'civ_rail_x', 'civ_rail_z', 'civ_ash', 'spruce_planks', 'civ_bank', 'gravel',
]);

/** The top of the land at every column of the map, as the world was built (`terrain.ts`'s blocks, trees aside), and the plant on it. */
export class Ground {
  private readonly ys: Int16Array;
  private readonly blocks: string[];
  private readonly plants = new Map<number, string>();

  constructor(
    readonly width: number,
    readonly depth: number,
    edits: Edit[],
    /** The world's period across, if it wraps (`geometry.ts`): a column off either side is round the other. */
    readonly period = 0,
  ) {
    this.ys = new Int16Array(width * depth).fill(SEA_Y);
    this.blocks = new Array<string>(width * depth).fill('water');
    for (const [x, y, z, block] of edits) {
      if (y < SEA_Y || x < 0 || z < 0 || x >= width || z >= depth) continue;
      const i = x * depth + z;
      // (A jungle's ferns go with its trees when it's cut: an improvement waits for them as for a tree.)
      if (PLANT_BLOCKS.has(block) && !TREE_BLOCKS.has(block)) this.plants.set(i, block);
      if (TREE_BLOCKS.has(block) || PLANT_BLOCKS.has(block) || y < this.ys[i]) continue;
      this.ys[i] = y;
      this.blocks[i] = block;
    }
  }

  /** A column's top block: its height and what it is, and the plant standing on it (null off the map). */
  at(x: number, z: number): { y: number; block: string; plant?: string } | null {
    if (this.period) x = ((x % this.period) + this.period) % this.period;
    if (x < 0 || z < 0 || x >= this.width || z >= this.depth) return null;
    const i = x * this.depth + z;
    return { y: this.ys[i], block: this.blocks[i], plant: this.plants.get(i) };
  }
}

/** What a tile shows, in a word: it changes when its improvement, pillage, road (or its neighbours' roads) or city does. */
export function decorKey(game: Game, t: number): string {
  const tile = game.tiles[t];
  if (cityOn(game, t)) return 'city';
  let links = 0;
  if (tile.road) for (let d = 0; d < 6; d++) if (linked(game, neighbour(game.grid, t, d))) links |= 1 << d;
  return `${tile.improvement ?? ''}|${tile.pillaged ? 1 : 0}|${tile.road ?? ''}|${links}|${tile.resource ?? ''}|${ruinSites(game).has(t) ? 1 : 0}|${wallEdges(game, t)}`;
}

/**
 * The Great Wall's run along a tile's edges (a bit for each neighbour it faces): round the land of
 * the civ that holds it, wherever that land meets land that isn't theirs (not along the coast, nor
 * round a city, which has walls of its own). It follows the borders as they grow, and goes to
 * whoever takes the wonder's city.
 */
export function wallEdges(game: Game, t: number): number {
  const by = game.wonders.great_wall;
  const tile = game.tiles[t];
  if (by === undefined || by < 0 || tile.owner !== by || TERRAINS[tile.terrain]?.water || cityOn(game, t)) return 0;
  let edges = 0;
  for (let d = 0; d < 6; d++) {
    const n = neighbour(game.grid, t, d);
    if (n < 0) continue;
    const other = game.tiles[n];
    if (other.owner !== by && !TERRAINS[other.terrain]?.water) edges |= 1 << d;
  }
  return edges;
}

/** Where cities stood that are gone, from the game's story (`rules/replay.ts`): worked out again only when it's grown. */
let ruins: { game: Game; events: number; tiles: Set<number> } | null = null;
function ruinSites(game: Game): Set<number> {
  const events = game.replay?.events ?? [];
  if (ruins?.game === game && ruins.events === events.length) return ruins.tiles;
  const at = new Map<number, number>();
  const tiles = new Set<number>();
  for (const e of events) {
    if (e[1] === 'found') at.set(e[2], e[4]);
    else if (e[1] === 'lost' && at.has(e[2])) tiles.add(at.get(e[2])!);
  }
  ruins = { game, events: events.length, tiles };
  return tiles;
}

const cityOn = (game: Game, t: number) => game.cities.some((c) => c.tile === t);
/** A road runs to a neighbour with a road or a city. */
const linked = (game: Game, n: number) => n >= 0 && (!!game.tiles[n].road || cityOn(game, n));

/** A column of a tile: where, from its middle (blocks), and how far across the hex (1 at its edges). */
interface Column {
  x: number;
  z: number;
  dx: number;
  dz: number;
  d: number;
}

/** How far a point is across a hex from its middle (1 on its edges); `sx`: how much wider the hexes are spaced than `HEX_W` (a world that wraps). */
function hexDistance(dx: number, dz: number, sx = 1): number {
  let d = 0;
  for (let i = 0; i < 3; i++) d = Math.max(d, Math.abs((dx / sx) * Math.cos((Math.PI / 3) * i) + dz * Math.sin((Math.PI / 3) * i)));
  return d / (HEX_W / 2);
}

/** A tile's own small random number, the same every time (stirred well: the k-th and the next are nothing alike). */
function hash(t: number, k: number): number {
  let h = Math.imul(t + 7919, 73856093) ^ Math.imul(k + 13, 19349663);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** How near where a tile's units stand (`UNIT_SPOTS`) nothing that stands up off the land is built (`Look.site`). */
const UNIT_ROOM = 0.75;

/** A column's key in a tile's sets of columns. */
const key = (x: number, z: number) => x * 4096 + z;

/** The cells of a w x d footprint, as offsets from its north-west column. */
const rect = (w: number, d: number): [number, number][] => Array.from({ length: w * d }, (_, n) => [n % w, Math.floor(n / w)]);

/**
 * Gathers a tile's blocks. A tile is small (about six columns across and seven deep, narrowing to
 * a point at its top and bottom), and everything it shows stays on its own columns: a block on a
 * neighbour's would stand in the neighbour's field, and the two tiles' blocks would fight over it.
 */
class Look {
  readonly out: Placed[] = [];
  readonly columns: Column[] = [];
  /** The tile's own columns: nothing goes on any other. */
  readonly own = new Set<number>();
  /** Its columns where its units stand, or next to them. */
  readonly middle = new Set<number>();
  /** Columns the road takes (nothing else goes there). */
  readonly road = new Set<number>();
  /** How much room each column has for `site`, on land and on water (worked out once the road's laid). */
  private readonly roomy = new Map<boolean, Map<number, number>>();
  readonly cx: number;
  readonly cz: number;

  constructor(
    readonly grid: Grid,
    readonly ground: Ground,
    readonly t: number,
  ) {
    const c = centre(grid, t);
    this.cx = c.x;
    this.cz = c.z;
    const sx = hexW(grid) / HEX_W;
    for (let x = Math.floor(c.x - HEX - 1); x <= c.x + HEX + 1; x++)
      for (let z = Math.floor(c.z - HEX - 1); z <= c.z + HEX + 1; z++) {
        if (tileAt(grid, x + 0.5, z + 0.5) !== t) continue;
        const dx = x + 0.5 - c.x;
        const dz = z + 0.5 - c.z;
        this.columns.push({ x, z, dx, dz, d: hexDistance(dx, dz, sx) });
        this.own.add(key(x, z));
        if (UNIT_SPOTS.some(([ux, uz]) => Math.hypot(dx - ux, dz - uz) < UNIT_ROOM)) this.middle.add(key(x, z));
      }
  }

  /** A random number of this tile's (the k-th). */
  rand(k: number): number {
    return hash(this.t, k);
  }

  /** The column at an offset from the tile's middle. */
  at(ox: number, oz: number): [number, number] {
    return [Math.floor(this.cx + ox), Math.floor(this.cz + oz)];
  }

  /** The land at a column (null: off the map, or water unless `water`). */
  land(x: number, z: number, water = false): { y: number; block: string; plant?: string } | null {
    const g = this.ground.at(x, z);
    if (!g || (!water && (g.block === 'water' || g.block === 'ice'))) return null;
    return g;
  }

  /** The land at a column something may go on: one of the tile's own, not the road's (null anywhere else). */
  private spot(x: number, z: number, water = false) {
    const k = key(x, z);
    return this.own.has(k) && !this.road.has(k) ? this.land(x, z, water) : null;
  }

  /** Whether something may go on a column: the tile's own land (or water, if `water`), not the road's. */
  free(x: number, z: number, water = false): boolean {
    return !!this.spot(x, z, water);
  }

  /** Whether something may stand up off the land there too: not where the tile's units stand, nor by them. */
  open(x: number, z: number, water = false): boolean {
    return this.free(x, z, water) && !this.middle.has(key(x, z));
  }

  /** A block `up` over the land at a column (1: standing on it, in its plant's place). */
  on(x: number, z: number, block: string, up = 1, water = false) {
    const g = this.spot(x, z, water);
    if (!g) return;
    this.out.push([x, g.y + up, z, block, up === 1 ? (g.plant ?? 'air') : 'air']);
  }

  /** A column of a block from the land up to `top` (an absolute height): a wall on a slope stands level. */
  stack(x: number, z: number, top: number, block: string) {
    const g = this.spot(x, z);
    if (!g) return;
    for (let y = g.y + 1; y <= top; y++) this.out.push([x, y, z, block, y === g.y + 1 ? (g.plant ?? 'air') : 'air']);
  }

  /** A block at a height (absolute) over the land at a column. */
  put(x: number, z: number, y: number, block: string, water = false) {
    const g = this.spot(x, z, water);
    if (!g || y <= g.y) return;
    this.out.push([x, y, z, block, y === g.y + 1 ? (g.plant ?? 'air') : 'air']);
  }

  /** The plant on a column taken away (a road over it, a field ploughed). */
  clear(x: number, z: number) {
    const g = this.own.has(key(x, z)) ? this.land(x, z) : null;
    if (g?.plant) this.out.push([x, g.y + 1, z, 'air', g.plant]);
  }

  /** The land's top block at a column made another (not the road's, which is the road's own). */
  surface(x: number, z: number, block: string, water = false) {
    const g = this.spot(x, z, water);
    if (!g) return;
    this.out.push([x, g.y, z, block, g.block]);
  }

  /**
   * Where a shape goes (the column its cells are offsets from): wholly on the tile's own land, clear
   * of its road and its units, as near a spot as there's room (from the tile's middle; by default its
   * back, where it hides nothing from the camera, which looks from the south), nearness back and
   * forth counting double. If there's room nowhere (a road through every side), wherever most of it
   * has: the rest is left out.
   */
  site(cells: [number, number][], opts: { water?: boolean; toward?: [number, number] } = {}): [number, number] {
    const [tx, tz] = opts.toward ?? [0, -3.5];
    const mx = cells.reduce((s, [i]) => s + i, 0) / cells.length + 0.5;
    const mz = cells.reduce((s, [, k]) => s + k, 0) / cells.length + 0.5;
    // (Each column's room: 2 open, 1 free, none else.)
    const water = !!opts.water;
    let roomy = this.roomy.get(water);
    if (!roomy) {
      roomy = new Map();
      for (const c of this.columns) if (this.free(c.x, c.z, water)) roomy.set(key(c.x, c.z), this.middle.has(key(c.x, c.z)) ? 1 : 2);
      this.roomy.set(water, roomy);
    }
    let best = this.at(0, 0);
    let most = -Infinity;
    for (let x = Math.floor(this.cx - HEX - 3); x <= this.cx + HEX; x++)
      for (let z = Math.floor(this.cz - HEX - 3); z <= this.cz + HEX; z++) {
        let room = 0;
        for (const [i, k] of cells) room += roomy.get(key(x + i, z + k)) ?? 0;
        const score = room * 100 - 2 * Math.abs(z + mz - this.cz - tz) - Math.abs(x + mx - this.cx - tx);
        if (score > most) {
          most = score;
          best = [x, z];
        }
      }
    return best;
  }

  /**
   * Where the first of some shapes goes that there's room for (`site`), and which of them it is: a
   * look's smaller forms, for where a road leaves no room for the whole of it. Failing them all, the
   * first, wherever most of it has room.
   */
  room(shapes: [number, number][][], opts: { water?: boolean; toward?: [number, number] } = {}): { at: [number, number]; shape: number } {
    for (let shape = 0; shape < shapes.length; shape++) {
      const [x, z] = this.site(shapes[shape], opts);
      if (shapes[shape].every(([i, k]) => this.open(x + i, z + k, opts.water))) return { at: [x, z], shape };
    }
    return { at: this.site(shapes[0], opts), shape: 0 };
  }

  /** The first of some columns that's open (else the first that's free), or null. */
  first(cols: [number, number][]): [number, number] | null {
    return cols.find(([x, z]) => this.open(x, z)) ?? cols.find(([x, z]) => this.free(x, z)) ?? null;
  }

  /** The highest of the tile's land under some columns (a building's floor). */
  level(cols: [number, number][]): number {
    let y = SEA_Y;
    for (const [x, z] of cols) y = Math.max(y, this.spot(x, z)?.y ?? SEA_Y);
    return y;
  }
}

/** Everything a tile shows, in blocks (round a world that wraps, each at its place in the world as built). */
export function decorOf(game: Game, ground: Ground, t: number): Placed[] {
  const out = lookOf(game, ground, t).out;
  if (game.grid.wrap) for (const p of out) p[0] = baseX(game.grid, p[0]);
  return out;
}

function lookOf(game: Game, ground: Ground, t: number): Look {
  const tile = game.tiles[t];
  const look = new Look(game.grid, ground, t);
  if (cityOn(game, t)) return look;
  const ruined = !!tile.pillaged;
  if (tile.road) roads(game, look, tile.road, ruined);
  const edges = wallEdges(game, t);
  if (edges) greatWall(game, look, edges);
  const imp = tile.improvement;
  if (!imp) {
    if (ruinSites(game).has(t)) cityRuins(look);
    return look;
  }
  const build = LOOKS[imp];
  if (build) build(look, { ruined, resource: tile.resource ?? '', hills: tile.elevation === 'hills', water: !!TERRAINS[tile.terrain]?.water });
  return look;
}

// -------------------------------------------------------------------------------------------------
// Roads

/** A road (or railroad): from the tile's middle to the edge it shares with each linked neighbour, two blocks wide; rails down its middle. */
function roads(game: Game, look: Look, kind: 'road' | 'rail', ruined: boolean) {
  const g = game.grid;
  const ends: { x: number; z: number }[] = [];
  for (let d = 0; d < 6; d++) {
    const n = neighbour(g, look.t, d);
    if (!linked(game, n)) continue;
    const c = centreNear(g, n, look.cx);
    ends.push({ x: (c.x - look.cx) / 2, z: (c.z - look.cz) / 2 });
  }
  // Alone: a little square in the middle.
  if (!ends.length) ends.push({ x: 0, z: 0 });
  for (const col of look.columns) {
    let near = Infinity;
    let along = { x: 1, z: 0 };
    for (const e of ends) {
      const len2 = e.x * e.x + e.z * e.z;
      const k = len2 ? Math.max(0, Math.min(1, (col.dx * e.x + col.dz * e.z) / len2)) : 0;
      const dist = Math.hypot(col.dx - e.x * k, col.dz - e.z * k);
      if (dist < near) {
        near = dist;
        along = e;
      }
    }
    if (near > (ends[0].x || ends[0].z ? 0.95 : 1.2)) continue;
    const ground = look.ground.at(col.x, col.z);
    look.clear(col.x, col.z);
    if (ruined && look.rand(col.x * 31 + col.z) < 0.45) look.surface(col.x, col.z, 'civ_ash');
    // Over a river, a bridge level with its banks (on a marsh's pool, planks on the water).
    else if (ground?.block === 'water') {
      if (!TERRAINS[game.tiles[look.t].terrain].water) {
        const sunk = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => (look.ground.at(col.x + dx, col.z + dz)?.y ?? -Infinity) > ground.y);
        if (sunk) look.put(col.x, col.z, ground.y + 1, 'spruce_planks', true);
        else look.surface(col.x, col.z, 'spruce_planks', true);
      }
    } else {
      const rail = kind === 'rail' && near < 0.5;
      look.surface(col.x, col.z, rail ? (Math.abs(along.x) > Math.abs(along.z) ? 'civ_rail_x' : 'civ_rail_z') : 'civ_road');
    }
    look.road.add(key(col.x, col.z));
  }
}

// -------------------------------------------------------------------------------------------------
// Improvements

interface Where {
  ruined: boolean;
  resource: string;
  hills: boolean;
  water: boolean;
}

/**
 * The ore a mine shows, by what it digs: a luxury's (anyone can tell those). Everyone sees the blocks,
 * so a strategic resource's mine shows plain ore; its own is each screen's (`client/resources3d.ts`),
 * for those who know it.
 */
const ORE: Record<string, string> = { gold_ore: 'gold_ore', silver: 'iron_ore', gems: 'diamond_ore', copper: 'gold_ore', salt: 'white_concrete' };

/** A building's walls (h high) and roof on a w x d footprint from its north-west column, standing level on a slope: its floor. */
function building(look: Look, [x0, z0]: [number, number], w: number, d: number, h: number, wall: string, roof: string, ruined: boolean): number {
  const cols: [number, number][] = [];
  for (let i = 0; i < w; i++) for (let k = 0; k < d; k++) cols.push([x0 + i, z0 + k]);
  const floor = look.level(cols);
  cols.forEach(([x, z], n) => {
    // (Pillaged: stubs of its walls here and there, its floor burnt.)
    if (ruined && look.rand(n + 40) >= 0.5) return look.surface(x, z, 'civ_ash');
    const top = ruined ? floor + 1 : floor + h;
    look.stack(x, z, top, wall);
    if (!ruined) look.put(x, z, top + 1, roof);
  });
  return floor;
}

/** A small building at the back of the tile, clear of the units in its middle: three columns by two (two by two where a road leaves no room), walls two high, a roof. */
function hall(look: Look, wall: string, roof: string, ruined: boolean) {
  const { at, shape } = look.room([rect(3, 2), rect(2, 2)]);
  const w = 3 - shape;
  return { x0: at[0], z0: at[1], w, floor: building(look, at, w, 2, 2, wall, roof, ruined) };
}

const LOOKS: Partial<Record<string, (look: Look, at: Where) => void>> = {
  farm(look, { ruined }) {
    for (const c of look.columns) {
      if (c.d > 0.92) continue;
      const g = look.land(c.x, c.z);
      if (!g || !SURFACE_BLOCKS.has(g.block) || g.block === 'civ_marsh' || look.road.has(key(c.x, c.z))) continue;
      const burnt = ruined && look.rand(c.x * 7 + c.z * 13) < 0.5;
      look.surface(c.x, c.z, burnt ? 'civ_ash' : 'civ_farmland');
      if (c.z % 2 === 0 && c.d <= 0.84 && !ruined) look.on(c.x, c.z, 'civ_wheat');
      else if (c.z % 2 === 0 && c.d <= 0.84 && !burnt && look.rand(c.x + c.z * 5) < 0.4) look.on(c.x, c.z, 'dead_bush');
      else look.clear(c.x, c.z);
    }
  },

  mine(look, { ruined, resource }) {
    // The shaft's dark mouth in a rocky mound at the back of the tile, timbered either side (the mound
    // goes on back as far as the tile does); its ore heaped beside it, a cart's rails out of it.
    const [x0, z0] = look.site(rect(3, 2));
    const [x, z] = [x0 + 1, z0 + 1];
    const floor = look.level([[x - 1, z - 1], [x, z - 1], [x + 1, z - 1], [x - 1, z], [x + 1, z]]);
    for (const dx of [-2, -1, 0, 1, 2]) {
      const top = floor + (ruined ? 1 : 4 - Math.abs(dx));
      if (dx === 0 && !ruined) {
        look.stack(x, z - 1, floor + 2, 'black_concrete');
        for (let y = floor + 3; y <= top; y++) look.put(x, z - 1, y, 'cobblestone');
      } else look.stack(x + dx, z - 1, top, 'cobblestone');
    }
    for (const dx of [-1, 0, 1]) look.stack(x + dx, z - 2, floor + (ruined ? 1 : 4 - Math.abs(dx)), 'cobblestone');
    // The ore heaped to one side of the mouth (the right, if there's room), the mound's foot on the other.
    const ore = ORE[resource] ?? 'coal_ore';
    const heap = look.first([[x + 2, z], [x - 2, z], [x + 2, z + 1], [x - 2, z + 1], [x + 1, z + 1], [x - 1, z + 1]]);
    const side = heap && heap[0] < x ? -1 : 1;
    if (ruined) {
      look.on(x - side, z, 'oak_log');
      if (heap) look.on(...heap, 'cobblestone');
      look.surface(x, z + 1, 'civ_ash');
      return;
    }
    look.stack(x - 1, z, floor + 2, 'oak_log');
    look.stack(x + 1, z, floor + 2, 'oak_log');
    for (const dx of [-1, 0, 1]) look.put(x + dx, z, floor + 3, 'oak_log[axis=x]');
    if (heap) {
      const [hx, hz] = heap;
      look.on(hx, hz, ore);
      look.on(hx, hz, ore, 2);
      const more = look.first([[hx + side, hz], [hx, hz + 1], [hx - side, hz + 1]].filter(([mx, mz]) => mx !== x || mz <= z) as [number, number][]);
      if (more) look.on(...more, ore);
    }
    look.on(x - 2 * side, z, 'cobblestone');
    look.surface(x, z + 1, 'civ_rail_z');
    look.surface(x, z + 2, 'civ_rail_z');
  },

  pasture(look, { ruined }) {
    // A fence round the field (a gate to the south): `pen`. The beasts in it are each screen's own
    // (`client/resources3d.ts`): only those who know the resource see them.
    const [cx, cz] = look.at(0, 0);
    for (const [x, z] of pen(look.grid, look.t).fence) {
      if (ruined && look.rand((x - cx) * 7 + (z - cz) * 3 + 50) < 0.55) continue;
      look.on(x, z, 'civ_fence');
    }
  },

  plantation(look, { ruined, resource }) {
    const bush = resource === 'cotton' ? 'civ_cotton' : 'civ_bush';
    for (const c of look.columns) {
      if (c.d > 0.8 || c.x % 2 !== 0 || c.z % 2 !== 0) continue;
      if (!ruined) look.on(c.x, c.z, bush);
      else {
        look.surface(c.x, c.z, 'civ_ash');
        if (look.rand(c.x + c.z * 3) < 0.5) look.on(c.x, c.z, 'dead_bush');
      }
    }
  },

  camp(look, { ruined }) {
    // A hunters' tent at the back, their fire beside it, and a post to hang the game on.
    const [x0, z0] = look.site(rect(3, 2));
    const [x, z] = [x0 + 1, z0];
    if (!ruined) {
      const floor = look.level([[x - 1, z], [x, z], [x + 1, z], [x - 1, z + 1], [x + 1, z + 1]]);
      for (const dz of [0, 1]) {
        look.stack(x - 1, z + dz, floor + 1, 'brown_concrete');
        look.stack(x + 1, z + dz, floor + 1, 'brown_concrete');
        look.put(x, z + dz, floor + 2, 'white_wool');
      }
      look.stack(x, z, floor + 1, 'brown_concrete');
      // (The first spot beside the tent with room for the post by the fire too; else the first with room for the fire.)
      const posts = ([fx, fz]: [number, number]): [number, number][] => [[fx, fz - 1], [fx + Math.sign(fx - x), fz], [fx + Math.sign(fx - x), fz - 1]];
      const fires: [number, number][] = [[x + 3, z + 1], [x - 3, z + 1], [x + 2, z + 1], [x - 2, z + 1]];
      const fire = fires.find((f) => look.open(...f) && posts(f).some((p) => look.open(...p))) ?? look.first(fires);
      if (!fire) return;
      look.on(...fire, 'civ_embers');
      const post = look.first(posts(fire));
      if (post) look.stack(...post, (look.land(...post)?.y ?? SEA_Y) + 2, 'oak_log');
    } else {
      look.surface(x, z, 'civ_ash');
      look.surface(x + 1, z + 1, 'civ_ash');
      look.on(x - 1, z, 'oak_log');
    }
  },

  quarry(look, { ruined, resource }) {
    // A stone floor at the back, cut blocks stacked on it, a crane at its corner with its jib out over it.
    const cut = resource === 'marble' ? 'diorite' : 'stone_bricks';
    const [x, z] = look.site([[0, 0], [-1, 0], [-2, 0]], { toward: [2, -3.5] });
    const floor = look.columns.filter((c) => c.dz < -0.6 && c.d < 0.8 && look.open(c.x, c.z));
    for (const c of floor) look.surface(c.x, c.z, ruined && look.rand(c.x + c.z * 7) < 0.4 ? 'civ_ash' : 'cobblestone');
    // Each pile on the floor's column nearest where it's meant to be.
    const piles: [number, number, number][] = ruined ? [[-1, -1.6, 1], [1.4, -2, 1]] : [[-1.2, -1.6, 2], [0.2, -2.2, 1], [1.4, -1.4, 1], [-0.2, -1.4, 1]];
    const used = new Set([key(x, z)]);
    for (const [ox, oz, h] of piles) {
      let near: Column | null = null;
      for (const c of floor)
        if (!used.has(key(c.x, c.z)) && (!near || Math.hypot(c.dx - ox, c.dz - oz) < Math.hypot(near.dx - ox, near.dz - oz))) near = c;
      if (!near) break;
      used.add(key(near.x, near.z));
      for (let i = 1; i <= h; i++) look.on(near.x, near.z, cut, i);
    }
    if (ruined) return;
    const top = (look.land(x, z)?.y ?? SEA_Y) + 4;
    look.stack(x, z, top, 'oak_log');
    for (let i = 1; i <= 2; i++) look.put(x - i, z, top + 1, 'oak_planks');
  },

  lumber_mill(look, { ruined }) {
    // A sawmill, and its logs piled beside it (where there's room).
    const { at, shape } = look.room([rect(4, 2), rect(3, 2), rect(2, 2)]);
    const [x0, z0] = at;
    building(look, at, shape === 2 ? 2 : 3, 2, 2, 'oak_planks', 'spruce_slab', ruined);
    if (!ruined && shape === 0)
      for (const dz of [0, 1]) {
        look.on(x0 + 3, z0 + dz, 'oak_log[axis=z]');
        if (dz) look.on(x0 + 3, z0 + dz, 'oak_log[axis=z]', 2);
      }
  },

  trading_post(look, { ruined }) {
    // A hut, and beside it (where there's room) a stall under the roof's awning: a post at its front, a counter, a crate by it.
    const { at, shape } = look.room([rect(3, 2), rect(2, 2)]);
    const [x0, z0] = at;
    const floor = building(look, at, 2, 2, 2, 'birch_planks', 'red_wool', ruined);
    if (ruined || shape) return;
    look.stack(x0 + 2, z0 + 1, floor + 2, 'civ_fence');
    look.stack(x0 + 2, z0, floor + 1, 'oak_planks');
    for (const dz of [0, 1]) look.put(x0 + 2, z0 + dz, floor + 3, 'red_wool');
    const crate = look.first([[x0 + 3, z0 + 1], [x0 + 3, z0]]);
    if (crate) look.on(...crate, 'spruce_slab');
  },

  fort(look, { ruined }) {
    walls(look, 'cobblestone', 1, 2, ruined);
  },

  citadel(look, { ruined }) {
    walls(look, 'stone_bricks', 2, 3, ruined);
  },

  oil_well(look, { ruined }) {
    // A derrick (four girders), its pool of oil beside it (or wherever there's room by it).
    const { at, shape } = look.room([rect(3, 2), rect(2, 2)]);
    const [x, z] = at;
    const floor = look.level([[x, z], [x + 1, z], [x, z + 1], [x + 1, z + 1]]);
    for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) look.stack(x + dx, z + dz, floor + (ruined ? 1 : dx + dz === 2 ? 6 : 4), 'civ_girder');
    const pool = shape ? look.first([[x + 2, z + 1], [x - 1, z + 1], [x + 2, z], [x - 1, z], [x, z + 2], [x + 1, z + 2]]) : ([x + 2, z + 1] as [number, number]);
    if (!pool) return;
    const [px, pz] = pool;
    look.surface(px, pz, 'black_concrete');
    const more = look.first([[px, pz - 1], [px + (px > x ? 1 : -1), pz], [px, pz + 1]].filter(([ox, oz]) => ox < x || ox > x + 1 || oz < z || oz > z + 1) as [number, number][]);
    if (more) look.surface(...more, ruined ? 'civ_ash' : 'black_concrete');
  },

  offshore_platform(look, { ruined }) {
    // A deck on legs (at its corners) out on the water, a derrick on it.
    const [x, z] = look.site(rect(3, 2), { water: true });
    for (let dx = 0; dx <= 2; dx++)
      for (let dz = 0; dz <= 1; dz++) {
        if (ruined && look.rand(dx * 3 + dz + 9) < 0.5) continue;
        if (dx !== 1) look.surface(x + dx, z + dz, 'iron_block', true);
        look.on(x + dx, z + dz, 'light_gray_concrete', 1, true);
      }
    if (!ruined) for (let i = 2; i <= 5; i++) look.on(x + 1, z, 'civ_girder', i, true);
  },

  academy(look, { ruined }) {
    hall(look, 'diorite', 'blue_concrete', ruined);
  },

  customs_house(look, { ruined }) {
    hall(look, 'sandstone', 'yellow_concrete', ruined);
  },

  manufactory(look, { ruined }) {
    const { x0, z0, w, floor } = hall(look, 'bricks', 'gray_concrete', ruined);
    // Its chimney up through the roof.
    if (!ruined) for (let y = floor + 4; y <= floor + 5; y++) look.put(x0 + w - 1, z0, y, 'bricks');
  },

  holy_site(look, { ruined }) {
    // A shrine: a pale stone floor, pillars at its corners, a roof with a ridge.
    const [x, z] = look.site(rect(3, 2));
    const floor = look.level([[x, z], [x + 2, z], [x, z + 1], [x + 2, z + 1]]);
    for (let dx = 0; dx <= 2; dx++) for (let dz = 0; dz <= 1; dz++) look.stack(x + dx, z + dz, floor + 1, 'diorite');
    for (const [dx, dz] of [[0, 0], [2, 0], [0, 1], [2, 1]]) for (let y = floor + 2; y <= floor + (ruined ? 2 : 3); y++) look.put(x + dx, z + dz, y, 'diorite');
    if (ruined) return;
    for (let dx = 0; dx <= 2; dx++) for (let dz = 0; dz <= 1; dz++) look.put(x + dx, z + dz, floor + 4, 'white_concrete');
    for (let dz = 0; dz <= 1; dz++) look.put(x + 1, z + dz, floor + 5, 'white_concrete');
  },

  landmark(look, { ruined }) {
    // An obelisk on a plinth (its corners too, where there's room), its tip gilded.
    const [sx, sz] = look.site([[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]]);
    const [x, z] = [sx + 1, sz + 1];
    const floor = look.level([[x, z]]);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (!(dx && dz) || look.open(x + dx, z + dz)) look.stack(x + dx, z + dz, floor + 1, 'stone_bricks');
    for (let y = floor + 2; y <= floor + (ruined ? 2 : 5); y++) look.put(x, z, y, 'diorite');
    if (!ruined) look.put(x, z, floor + 6, 'yellow_concrete');
  },
};

/**
 * A pasture's pen: the columns its fence stands on, round a field five columns across in the tile's
 * middle (where the tile's edge cuts off a corner, the fence turns in round it), a gate to the south;
 * and the field inside, where the beasts graze (`client/resources3d.ts`).
 */
export function pen(g: Grid, t: number): { fence: [number, number][]; field: [number, number][] } {
  const c = centre(g, t);
  const [cx, cz] = [Math.floor(c.x), Math.floor(c.z)];
  const inside = (i: number, k: number) => Math.max(Math.abs(i), Math.abs(k)) <= 2 && tileAt(g, cx + i + 0.5, cz + k + 0.5) === t;
  const fence: [number, number][] = [];
  const field: [number, number][] = [];
  const gate = inside(0, 2) ? 2 : 1;
  for (let k = -2; k <= 2; k++)
    for (let i = -2; i <= 2; i++) {
      if (!inside(i, k)) continue;
      let edge = false;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) edge ||= !inside(i + a, k + b);
      if (!edge) field.push([cx + i, cz + k]);
      else if (i !== 0 || k !== gate) fence.push([cx + i, cz + k]);
    }
  return { fence, field };
}

/** Where a city stood: the stubs of its wall in a broken ring, its houses' footings, gravel and ash among them. */
function cityRuins(look: Look) {
  const stubs = new Set<number>();
  for (const c of look.columns) {
    const r = look.rand(c.x * 31 + c.z * 17);
    const g = look.land(c.x, c.z);
    if (!g) continue;
    if (c.d > 0.5 && c.d < 0.62) {
      if (r >= 0.45) continue;
      look.stack(c.x, c.z, g.y + (r < 0.15 ? 2 : 1), r < 0.25 ? 'mossy_cobblestone' : 'cobblestone');
      stubs.add(key(c.x, c.z));
    } else if (c.d < 0.42) {
      if (r < 0.12) look.surface(c.x, c.z, 'gravel');
      else if (r < 0.2) look.surface(c.x, c.z, 'civ_ash');
    }
  }
  // Houses' footings: a few broken squares, each wholly on the tile and clear of the others (drawn in
  // toward the middle, or turned round it, until it is; if there's no room left, one fewer).
  const square = rect(3, 3);
  const taken = new Set<number>();
  for (let i = 0; i < 4; i++) {
    const a = look.rand(100 + i) * Math.PI * 2;
    let at: number[] | null = null;
    let x0 = 0;
    let z0 = 0;
    for (let out = 0.8 + look.rand(110 + i) * 1.4; out > 0.5 && !at; out -= 0.5)
      for (let turn = 0; turn < 6 && !at; turn++) {
        [x0, z0] = look.at(Math.cos(a + turn) * out - 1, Math.sin(a + turn) * out - 1);
        const cells = square.map(([dx, dz]) => key(x0 + dx, z0 + dz));
        if (cells.every((k) => look.own.has(k) && !taken.has(k))) at = cells;
      }
    if (!at) continue;
    for (const k of at) taken.add(k);
    for (const [dx, dz] of square)
      if ((dx !== 1 || dz !== 1) && !stubs.has(key(x0 + dx, z0 + dz)) && look.rand(120 + i * 9 + dx * 3 + dz) >= 0.35) look.on(x0 + dx, z0 + dz, look.rand(140 + i * 5 + dx + dz) < 0.3 ? 'mossy_cobblestone' : 'stone_bricks');
  }
}

/**
 * The Great Wall along a tile's edges (`wallEdges`): a rampart of stone bricks two blocks high on
 * the hex's outer ring, crenellated, with a watchtower at each of its corners; a road goes through it
 * by a gate (the road's columns are left open). Its columns are kept from the tile's improvement.
 */
function greatWall(game: Game, look: Look, edges: number) {
  const g = game.grid;
  const way = new Map<number, number>();
  for (let d = 0; d < 6; d++) way.set(neighbour(g, look.t, d), d);
  for (const c of look.columns) {
    if (!look.free(c.x, c.z)) continue;
    // The neighbours it touches (the tiles of the columns beside it): an edge, or two by a corner.
    const touches = new Set<number>();
    for (const [i, k] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = tileAt(g, c.x + i + 0.5, c.z + k + 0.5);
      if (n !== look.t && way.has(n)) touches.add(way.get(n)!);
    }
    if (![...touches].some((d) => edges & (1 << d))) continue;
    const ground = look.land(c.x, c.z);
    if (!ground) continue;
    const corner = touches.size > 1;
    const top = ground.y + (corner ? 4 : 2);
    look.stack(c.x, c.z, top, 'stone_bricks');
    if (corner) look.put(c.x, c.z, top + 1, 'cobblestone');
    else if ((c.x + c.z) % 2 === 0) look.put(c.x, c.z, top + 1, 'stone_bricks');
    look.road.add(key(c.x, c.z));
  }
}

/** A fort's walls round the tile's middle (`h` high, its six corners `corner` high), broken if pillaged. */
function walls(look: Look, block: string, h: number, corner: number, ruined: boolean) {
  for (const c of look.columns) {
    if (c.d < 0.5 || c.d > 0.64) continue;
    if (ruined && look.rand(c.x * 5 + c.z * 7) < 0.5) continue;
    const a = Math.atan2(c.dz, c.dx) + Math.PI / 2;
    const atCorner = Math.abs(((a / (Math.PI / 3)) % 1 + 1) % 1 - 0.5) > 0.36;
    const g = look.land(c.x, c.z);
    if (!g) continue;
    look.stack(c.x, c.z, g.y + (ruined ? 1 : atCorner ? corner : h), block);
  }
}
