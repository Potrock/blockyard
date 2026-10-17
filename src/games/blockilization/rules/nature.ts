import { neighbour, neighbours, type Grid } from './hex';
import type { Game, Tile } from './state';
import { addYields, TERRAINS, type Elevation, type TerrainId, type Yields } from './terrain';

/**
 * Natural wonders: the world's own marvels, a tile each, set by the map where the land suits them
 * (`mapgen.ts`) and built in blocks as landmarks (`terrain.ts`). Civilization V's, in our own words:
 * working one yields far more than any other tile (its yields are the whole tile's), most can't be
 * entered (to the rules they're mountains: no units, no sight past them) and some do something for
 * the land or the units round them. Every civilization that finds one is the happier for it for good,
 * and the first to find each has a burst of golden-age points (`discover` in `core.ts`).
 */

export interface NaturalWonder {
  id: string;
  name: string;
  /** A line about it, for the Civilopedia and the moment it's found. */
  flavour: string;
  /** What working it yields (all its tile yields: the land under it adds nothing). */
  yields: Yields;
  /** Units can enter it (it keeps its land's moves and defence); the others can't be entered. */
  passable?: boolean;
  /** Where it can rise: its tile's terrain and elevation; by the open sea (a land wonder); with woods or fresh water within a tile; standing alone (no more than one mountain next to it). */
  site: { terrain: TerrainId[]; elevation: Elevation[]; coast?: boolean; lush?: boolean; alone?: boolean };
  /** It spans two tiles (Civ V's Great Barrier Reef's way): the second next to the first, in one of these directions (`hex.ts`'s), of this terrain and elevation; each yields in full. */
  pair?: { dirs: number[]; terrain: TerrainId[]; elevation: Elevation[] };
  /** Happiness for the civ whose land it's in. */
  happiness?: number;
  /** Fresh water for the tiles next to it (farms there need no river; cities by it count as by a lake). */
  freshWater?: boolean;
  /** What the land next to it yields more (volcanic ash). */
  around?: Yields;
  /** Units that end a turn next to it: healed fully; given a promotion (land units that fight); seeing further. */
  heals?: boolean;
  promotion?: string;
  sight?: number;
  /** Gold for the first civ to find it (by the game's speed). */
  finderGold?: number;
  /** How high its blocks reach over the sea (for the camera, the fog and the map). */
  top: number;
  /** Its colour on the map and in the Civilopedia. */
  color: string;
}

const LAND: TerrainId[] = ['grassland', 'plains', 'desert', 'tundra'];

export const NATURAL_WONDER_LIST: NaturalWonder[] = [
  {
    id: 'sky_pillar',
    name: 'The Sky Pillar',
    flavour: 'A needle of pale stone so tall the clouds snag on it. From its foot a scout can see half a kingdom.',
    yields: { culture: 3, science: 2 },
    site: { terrain: LAND, elevation: ['flat', 'hills'] },
    sight: 1,
    top: 13,
    color: '#e4dccb',
  },
  {
    id: 'emerald_falls',
    name: 'Emerald Falls',
    flavour: 'A river throws itself off a mossy cliff and is lost in its own mist; the valley below never knows a dry year.',
    yields: { food: 3, prod: 1, culture: 2 },
    site: { terrain: ['grassland', 'plains'], elevation: ['hills', 'flat'], lush: true },
    // (The falls drop from the first tile into the second, south of it: toward the camera.)
    pair: { dirs: [4, 5], terrain: ['grassland', 'plains'], elevation: ['flat', 'hills'] },
    freshWater: true,
    top: 12,
    color: '#3fbf7a',
  },
  {
    id: 'sunken_crown',
    name: 'The Sunken Crown',
    flavour: 'A ring of coral breaks the surface like a drowned king’s crown, and the shallows inside teem with fish of every colour.',
    yields: { food: 2, prod: 1, gold: 2, science: 2 },
    passable: true,
    site: { terrain: ['coast'], elevation: ['flat'] },
    pair: { dirs: [0, 1, 2, 3, 4, 5], terrain: ['coast'], elevation: ['flat'] },
    top: 2,
    color: '#4fd8d0',
  },
  {
    id: 'ember_throne',
    name: 'The Ember Throne',
    flavour: 'A sleeping volcano, its crater still red at the heart. The ash it once threw down makes the fields round it the richest anywhere.',
    yields: { prod: 3, science: 3 },
    site: { terrain: LAND, elevation: ['mountain', 'hills'], alone: true },
    around: { food: 1 },
    top: 11,
    color: '#ff6a2a',
  },
  {
    id: 'starfall_crater',
    name: 'Starfall Crater',
    flavour: 'Where a star once fell, a bowl of scorched rock; shards of strange metal still glitter at its heart.',
    yields: { gold: 2, science: 3 },
    site: { terrain: ['desert', 'plains', 'tundra'], elevation: ['flat'] },
    top: 5,
    color: '#7ad8ff',
  },
  {
    id: 'ageless_spring',
    name: 'The Ageless Spring',
    flavour: 'A pool that glows at dusk under its palms. The wounded who sleep beside it wake whole.',
    yields: { food: 3, faith: 2 },
    site: { terrain: ['desert'], elevation: ['flat'] },
    freshWater: true,
    heals: true,
    top: 7,
    color: '#8af0e0',
  },
  {
    id: 'mount_solace',
    name: 'Mount Solace',
    flavour: 'A lone white peak where pilgrims climb to watch the sunrise. A light burns at its summit that nobody lit.',
    yields: { faith: 6 },
    site: { terrain: [...LAND, 'snow'], elevation: ['mountain'], alone: true },
    happiness: 2,
    top: 13,
    color: '#ffe08a',
  },
  {
    id: 'cloudcrown',
    name: 'The Cloudcrown',
    flavour: 'A broad green mountain that wears a ring of cloud. Soldiers who march its slopes come down tireless.',
    yields: { food: 3, culture: 2 },
    site: { terrain: ['grassland', 'plains'], elevation: ['mountain', 'hills'], alone: true },
    promotion: 'altitude_training',
    top: 11,
    color: '#bfe6ff',
  },
  {
    id: 'gilded_peak',
    name: 'The Gilded Peak',
    flavour: 'A mountain veined with gold, glinting from a day’s march away. Its finders never forget the sight.',
    yields: { gold: 7 },
    site: { terrain: ['desert', 'plains', 'tundra'], elevation: ['mountain', 'hills'] },
    finderGold: 100,
    top: 10,
    color: '#ffc531',
  },
  {
    id: 'stone_grove',
    name: 'The Stone Grove',
    flavour: 'A forest turned to stone before the first city stood. Armies have held its knotted ridge against all comers.',
    yields: { prod: 3, culture: 2 },
    passable: true,
    site: { terrain: LAND, elevation: ['hills'] },
    top: 8,
    color: '#b89a7a',
  },
  {
    id: 'heartstone',
    name: 'The Heartstone',
    flavour: 'A crystal the size of a temple, rising out of the frozen ground and humming faintly in the cold.',
    yields: { science: 3, faith: 2 },
    site: { terrain: ['tundra', 'snow'], elevation: ['flat', 'hills'] },
    top: 12,
    color: '#b58aff',
  },
  {
    id: 'sun_arch',
    name: 'The Sun Arch',
    flavour: 'A span of red rock the wind carved over ages. At midsummer the rising sun stands in it like a jewel in a ring.',
    yields: { gold: 2, culture: 3 },
    passable: true,
    site: { terrain: ['desert', 'plains'], elevation: ['flat'] },
    top: 10,
    color: '#e0703a',
  },
  {
    id: 'titans_steps',
    name: 'The Titan’s Steps',
    flavour: 'Thousands of six-sided columns of black stone step down into the sea, as if a giant had begun a road across it.',
    yields: { prod: 2, gold: 1, culture: 2 },
    site: { terrain: LAND, elevation: ['flat', 'hills'], coast: true },
    pair: { dirs: [0, 1, 2, 3, 4, 5], terrain: ['coast'], elevation: ['flat'] },
    top: 8,
    color: '#5a6a7a',
  },
  {
    id: 'worldroot',
    name: 'The Worldroot',
    flavour: 'A tree older than speech, its golden crown wider than a village. The forest round it is said to listen.',
    yields: { food: 2, faith: 3, culture: 1 },
    site: { terrain: ['grassland', 'plains'], elevation: ['flat'], lush: true },
    top: 12,
    color: '#e8c84a',
  },
];

export const NATURAL_WONDERS: Record<string, NaturalWonder> = Object.fromEntries(NATURAL_WONDER_LIST.map((w) => [w.id, w]));

/** The natural wonder on a tile, if there's one. */
export const naturalWonderOf = (tile: Tile): NaturalWonder | undefined => (tile.wonder ? NATURAL_WONDERS[tile.wonder] : undefined);

/** Happiness for good for each natural wonder a civ has found, and the golden-age points (and its own gold) the first to find each has, before the game's speed. */
export const FOUND_HAPPINESS = 1;
export const FIRST_FINDER_GOLDEN = 60;

/** The natural wonders next to a tile. */
export function wondersBeside(game: Game, t: number): NaturalWonder[] {
  const out: NaturalWonder[] = [];
  for (const n of neighbours(game.grid, t)) {
    const w = naturalWonderOf(game.tiles[n]);
    if (w) out.push(w);
  }
  return out;
}

/** Happiness a civ has from natural wonders: for each it has found, and from those in its land (which it has found, to hold). */
export function natureHappiness(game: Game, p: number): number {
  let n = 0;
  for (const [id, f] of Object.entries(game.found ?? {})) {
    if (!f.by.includes(p)) continue;
    n += FOUND_HAPPINESS;
    if (game.tiles[f.tile].owner === p) n += NATURAL_WONDERS[id]?.happiness ?? 0;
  }
  return n;
}

/** What a land tile yields more for the natural wonders next to it (volcanic ash). */
export function aroundYields(game: Game, t: number): Yields | undefined {
  let out: Yields | undefined;
  if (TERRAINS[game.tiles[t].terrain].water) return out;
  for (let d = 0; d < 6; d++) {
    const n = neighbour(game.grid, t, d);
    const extra = n >= 0 ? naturalWonderOf(game.tiles[n])?.around : undefined;
    if (extra) out = addYields(out ?? {}, extra);
  }
  return out;
}

/** Whether a natural wonder could rise on a tile: its site's terrain and elevation, and (for some) the sea or woods and water near. */
export function fitsSite(g: Grid, tiles: Tile[], t: number, w: NaturalWonder): boolean {
  const tile = tiles[t];
  if (!w.site.terrain.includes(tile.terrain) || !w.site.elevation.includes(tile.elevation) || tile.feature === 'ice') return false;
  const next = neighbours(g, t).map((n) => tiles[n]);
  if (w.site.coast && !next.some((n) => n.terrain === 'coast' || n.terrain === 'ocean')) return false;
  if (w.site.lush && !next.some((n) => n.feature === 'forest' || n.feature === 'jungle' || n.feature === 'marsh' || n.river || n.terrain === 'lake')) return false;
  if (w.site.alone && next.filter((n) => n.elevation === 'mountain').length > 1) return false;
  return true;
}
