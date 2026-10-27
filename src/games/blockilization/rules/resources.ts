import { distance, neighbours, within, type Grid } from './hex';
import type { Rng } from './mapgen';
import type { MapSize, Tile } from './state';
import { RESOURCES, TERRAINS } from './terrain';

/**
 * A new world's luxuries and strategic resources, placed as Civ V places them (Brave New World's
 * `AssignStartingPlots.lua`, its PlaceLuxuries and PlaceStrategicAndBonusResources).
 *
 * Luxuries by region: each civ's region (the land nearer its start than any other's) is given a type
 * that suits its ground (furs and whales in the tundra, incense and gold in the desert, wine and ivory
 * on the plains, and so on), one beside its start and a few more about it; three other types are
 * kept for the city-states; a few are left off the map (more on a small one); the rest are scattered
 * at random, and each start has one of those too, a second type. So a civ has plenty of one luxury
 * and has to trade for the others, as in Civ V.
 *
 * Strategic resources in deposits of Civ V's sizes: large ones (Iron 6, Horses 4, Coal 7, Oil 7,
 * Aluminum 8, Uranium 4), one to so many tiles of each kind of ground, of the kinds that belong there
 * (Oil and Uranium in the marshes, Iron, Coal and Aluminum in the hills, Horses on open grassland and
 * plains); small ones (2 or 3) one to every 23 tiles of flat land; a small Coal, Oil or Aluminum by
 * three city-states in four; Oil off the coast, half as much as on the land; and a large one more of
 * any the map has too little of. Each deposit keeps the next of any kind a tile or few off it (Civ
 * V's "impact"), so they spread out.
 */

/** The kinds of ground Civ V sorts the tiles into for its resources (luxuries by its fifteen, `GetIndicesForLuxuryType`; strategics by a few more). */
type Ground =
  | 'coast' // coast beside land
  | 'sea' // any coast
  | 'marsh'
  | 'floodplains'
  | 'open_hills'
  | 'covered_hills' // hills under forest or jungle
  | 'jungle_hills'
  | 'forest_hills'
  | 'hills' // all hills but snowy ones
  | 'jungle' // flat
  | 'forest' // flat
  | 'temperate_forest' // flat forest not on tundra
  | 'desert' // flat, open (no oasis or flood plains)
  | 'plains' // flat, open
  | 'dry_grass' // flat, open, no fresh water
  | 'wet_grass' // flat, open, fresh water
  | 'tundra' // flat, open or forest
  | 'open_tundra' // flat, open
  | 'snow' // flat
  | 'land'; // flat land: open, forest or jungle (not marsh or flood plains)

/** Where each luxury goes, best first (Civ V's). */
const LUXURY_GROUND: Record<string, Ground[]> = {
  whales: ['coast'],
  pearls: ['coast'],
  crab: ['coast'],
  gold_ore: ['open_hills', 'desert', 'covered_hills'],
  silver: ['open_hills', 'covered_hills', 'tundra', 'dry_grass'],
  gems: ['jungle_hills', 'forest_hills', 'open_hills', 'jungle'],
  marble: ['dry_grass', 'desert', 'plains', 'open_hills'],
  ivory: ['plains', 'dry_grass'],
  furs: ['tundra', 'temperate_forest'],
  dyes: ['forest', 'jungle', 'marsh'],
  spices: ['jungle', 'temperate_forest', 'marsh'],
  silk: ['temperate_forest', 'jungle'],
  sugar: ['marsh', 'jungle', 'floodplains', 'wet_grass'],
  cotton: ['floodplains', 'wet_grass', 'dry_grass'],
  wine: ['plains', 'dry_grass', 'wet_grass'],
  incense: ['desert', 'floodplains', 'plains'],
  copper: ['open_hills', 'covered_hills', 'dry_grass', 'tundra'],
  salt: ['plains', 'desert', 'tundra', 'forest'],
  citrus: ['jungle', 'jungle_hills', 'temperate_forest', 'floodplains'],
  truffles: ['temperate_forest', 'jungle', 'marsh', 'covered_hills'],
  cocoa: ['jungle', 'jungle_hills', 'temperate_forest'],
};

/** Where Marble goes once the rest are placed (Civ V keeps it apart: it speeds wonders). */
const MARBLE_GROUND: Ground[] = ['open_hills', 'open_tundra', 'desert', 'plains', 'dry_grass'];

/** Civ V's regions, by what most of their land is (`DetermineRegionTypes`). */
type RegionKind = 'tundra' | 'jungle' | 'forest' | 'desert' | 'hills' | 'plains' | 'grass' | 'hybrid' | 'none';
const REGION_ORDER: RegionKind[] = ['tundra', 'jungle', 'forest', 'desert', 'hills', 'plains', 'grass', 'hybrid', 'none'];

/** How likely each luxury is to be a region's, by its kind (Civ V's `luxury_region_weights`). */
const REGION_WEIGHTS: Record<Exclude<RegionKind, 'none'>, [string, number][]> = {
  tundra: [['furs', 40], ['whales', 35], ['crab', 30], ['silver', 25], ['copper', 15], ['salt', 15], ['gems', 5], ['dyes', 5]],
  jungle: [['cocoa', 35], ['citrus', 35], ['spices', 30], ['gems', 20], ['sugar', 20], ['pearls', 20], ['copper', 5], ['truffles', 5], ['crab', 5], ['silk', 5], ['dyes', 5]],
  forest: [['dyes', 30], ['silk', 30], ['truffles', 30], ['furs', 10], ['spices', 10], ['citrus', 5], ['salt', 5], ['copper', 5], ['cocoa', 5], ['crab', 10], ['whales', 10], ['pearls', 10]],
  desert: [['incense', 35], ['salt', 15], ['gold_ore', 25], ['copper', 10], ['cotton', 15], ['sugar', 15], ['pearls', 5], ['citrus', 5]],
  hills: [['gold_ore', 30], ['silver', 30], ['copper', 30], ['gems', 15], ['pearls', 15], ['salt', 10], ['crab', 10], ['whales', 10]],
  plains: [['ivory', 35], ['wine', 35], ['salt', 25], ['incense', 10], ['spices', 5], ['whales', 5], ['pearls', 5], ['crab', 5], ['truffles', 5], ['gold_ore', 5]],
  grass: [['cotton', 30], ['silver', 20], ['sugar', 20], ['copper', 20], ['crab', 20], ['pearls', 10], ['whales', 10], ['cocoa', 10], ['truffles', 5], ['spices', 5], ['gems', 5]],
  hybrid: [['ivory', 15], ['cotton', 15], ['wine', 15], ['silver', 10], ['salt', 15], ['copper', 20], ['whales', 20], ['pearls', 20], ['crab', 20], ['truffles', 10], ['cocoa', 10], ['spices', 5], ['sugar', 5], ['citrus', 5], ['incense', 5], ['silk', 5], ['gems', 5], ['gold_ore', 5]],
};

/** Every luxury but Marble, as likely as Civ V has them where nothing else decides (`luxury_fallback_weights`): the types left off the map and those scattered at random are from these. */
const FALLBACK_WEIGHTS: [string, number][] = [['whales', 10], ['pearls', 10], ['gold_ore', 10], ['silver', 5], ['gems', 10], ['ivory', 5], ['furs', 10], ['dyes', 5], ['spices', 5], ['silk', 5], ['sugar', 5], ['cotton', 5], ['wine', 5], ['incense', 5], ['copper', 5], ['salt', 5], ['citrus', 5], ['truffles', 5], ['cocoa', 5], ['crab', 5]];

/** The city-states' own types, those civs have least of the likelier (`luxury_city_state_weights`). */
const CITY_STATE_WEIGHTS: [string, number][] = [['whales', 15], ['pearls', 15], ['gold_ore', 10], ['silver', 10], ['gems', 10], ['ivory', 10], ['furs', 15], ['dyes', 10], ['spices', 15], ['silk', 15], ['sugar', 10], ['cotton', 10], ['wine', 10], ['incense', 15], ['copper', 10], ['salt', 10], ['citrus', 15], ['truffles', 15], ['cocoa', 10], ['crab', 15]];

const WATER_LUXURIES = new Set(['whales', 'pearls', 'crab']);

/** A deposit of Oil out at sea (Civ V's). */
export const SEA_OIL = 4;

/**
 * Civ V's luxury numbers for a map's size: those of its own world size for as many civs (a duel map's
 * Duel's, a small one's Tiny's, a standard one's Small's, a large one's Standard's, a huge one's
 * Large's). Each region's copies of its type (by how many civs there are), the luxuries the world
 * should have (but for each start's second type) and the least of each random type, and the types
 * left off the map.
 */
const LUXURY_COUNTS: Record<MapSize, { region: number[]; world: number; least: number; disabled: number }> = {
  duel: { region: new Array(22).fill(1), world: 18, least: 3, disabled: 11 },
  small: { region: [0, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], world: 30, least: 4, disabled: 8 },
  standard: { region: [0, 3, 3, 3, 4, 4, 4, 3, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], world: 45, least: 4, disabled: 6 },
  large: { region: [0, 3, 3, 4, 4, 5, 5, 6, 5, 4, 4, 3, 3, 2, 2, 1, 1, 1, 1, 1, 1, 1], world: 60, least: 5, disabled: 4 },
  huge: { region: [0, 3, 4, 4, 5, 5, 5, 6, 6, 7, 6, 5, 5, 4, 4, 3, 3, 2, 2, 2, 2, 2], world: 75, least: 5, disabled: 2 },
};

/** How the random types share what's left to place, the first the most (Civ V's `random_lux_ratios_table`). */
const RANDOM_SHARES = [[1], [0.55, 0.45], [0.4, 0.33, 0.27], [0.35, 0.25, 0.25, 0.15], [0.25, 0.25, 0.2, 0.15, 0.15], [0.2, 0.2, 0.2, 0.15, 0.15, 0.1], [0.2, 0.2, 0.15, 0.15, 0.1, 0.1, 0.1], [0.2, 0.15, 0.15, 0.1, 0.1, 0.1, 0.1, 0.1]];

/** How the luxuries were shared out: each civ's region's type, the city-states' types, those at random, those left off. */
export interface LuxuryRoles {
  regions: (string | null)[];
  cityStates: string[];
  random: string[];
  disabled: string[];
}

/** The tiles' grounds and a world's resources set on them (`placeLuxuries`, `placeStrategics`). */
class Placer {
  readonly grounds: Ground[][];
  /** Civ V's impact layers: where a luxury or a strategic resource has been put, and how far it keeps the next. */
  readonly luxury: number[];
  readonly strategic: number[];
  readonly marble: number[];
  private readonly lists = new Map<Ground, number[]>();

  constructor(
    readonly g: Grid,
    readonly tiles: Tile[],
    readonly rng: Rng,
    readonly blocked: Set<number>,
  ) {
    const n = tiles.length;
    this.luxury = new Array(n).fill(0);
    this.strategic = new Array(n).fill(0);
    this.marble = new Array(n).fill(0);
    this.grounds = tiles.map((_, t) => (blocked.has(t) ? [] : groundsOf(g, tiles, t)));
  }

  /** All the tiles of a ground (each list shuffled once, as Civ V's are). */
  list(ground: Ground): number[] {
    let out = this.lists.get(ground);
    if (!out) {
      out = this.shuffled(this.grounds.flatMap((gs, t) => (gs.includes(ground) ? [t] : [])));
      this.lists.set(ground, out);
    }
    return out;
  }

  /** The tiles of a ground within so many of a tile (its own aside), shuffled. */
  near(t: number, radius: number, ground: Ground): number[] {
    return this.shuffled(within(this.g, t, radius).filter((x) => x !== t && this.grounds[x].includes(ground)));
  }

  shuffled<T>(list: T[]): T[] {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  free(t: number): boolean {
    return !this.tiles[t].resource && !this.blocked.has(t);
  }

  put(t: number, id: string, amount?: number) {
    this.tiles[t].resource = id;
    if (amount) this.tiles[t].amount = amount;
  }

  /** Civ V's impact: the tile marked, and the rings round it out to `radius`, each less (more where they overlap). */
  mark(layer: number[], t: number, radius: number) {
    layer[t] = layer === this.marble ? 1 : 99;
    for (const x of within(this.g, t, radius)) {
      if (x === t) continue;
      if (layer === this.marble) {
        layer[x] = 1;
        continue;
      }
      const ripple = radius - distance(this.g, t, x) + 1;
      layer[x] = layer[x] > 0 ? Math.min(50, Math.max(layer[x], ripple) + 2) : ripple;
    }
  }

  /**
   * Civ V's PlaceSpecificNumberOfResources: up to `count` of a resource on the first free tiles of a list
   * (no more than `ratio` of the list), each clear of the layer's marks if one's given (and marking it,
   * `minR` to `maxR` round). How many weren't placed.
   */
  some(id: string, count: number, ratio: number, list: number[], layer?: number[], minR = 0, maxR = 0, amount?: number): number {
    let left = count;
    const n = Math.min(count, Math.ceil(ratio * list.length));
    for (let i = 0; i < n; i++) {
      const t = list.find((x) => this.free(x) && (!layer || layer[x] === 0));
      if (t === undefined) break;
      this.put(t, id, amount);
      left--;
      if (layer) this.mark(layer, t, minR + (maxR > minR ? this.rng.int(0, maxR - minR) : 0));
    }
    return left;
  }

  /** `some` from a resource's grounds in turn (each one's tiles from `listOf`), with a ratio each, until all are placed. */
  inGrounds(id: string, count: number, grounds: Ground[], listOf: (ground: Ground) => number[], ratios: number[], layer?: number[], radii?: [number, number][], amount?: number): number {
    let left = count;
    grounds.forEach((ground, i) => {
      if (left > 0) left = this.some(id, left, ratios[Math.min(i, ratios.length - 1)], listOf(ground), layer, radii?.[i]?.[0], radii?.[i]?.[1], amount);
    });
    return left;
  }

  /** Whether a luxury could go within so many tiles of a site (Civ V's `GetListOfAllowableLuxuriesAtCitySite`). */
  allowedNear(t: number, radius: number, id: string): boolean {
    return within(this.g, t, radius).some((x) => x !== t && this.free(x) && LUXURY_GROUND[id].some((gr) => this.grounds[x].includes(gr)));
  }
}

/** A tile's grounds (Civ V's `GenerateGlobalResourcePlotLists`). */
function groundsOf(g: Grid, tiles: Tile[], t: number): Ground[] {
  const tile = tiles[t];
  if (tile.resource || tile.elevation === 'mountain' || tile.feature === 'ice' || tile.feature === 'atoll') return [];
  if (tile.terrain === 'coast') return neighbours(g, t).some((n) => !TERRAINS[tiles[n].terrain].water) ? ['coast', 'sea'] : ['sea'];
  if (TERRAINS[tile.terrain].water) return [];
  if (tile.elevation === 'hills') {
    if (tile.terrain === 'snow') return [];
    if (!tile.feature) return ['open_hills', 'hills'];
    if (tile.feature === 'jungle') return ['covered_hills', 'jungle_hills', 'hills'];
    if (tile.feature === 'forest') return ['covered_hills', 'forest_hills', 'hills'];
    return ['hills'];
  }
  if (tile.feature === 'marsh') return ['marsh'];
  if (tile.feature === 'floodplains') return ['floodplains'];
  if (tile.feature === 'jungle') return ['jungle', 'land'];
  if (tile.feature === 'forest') return tile.terrain === 'tundra' ? ['forest', 'tundra', 'land'] : ['forest', 'temperate_forest', 'land'];
  if (tile.feature) return [];
  if (tile.terrain === 'tundra') return ['tundra', 'open_tundra', 'land'];
  if (tile.terrain === 'snow') return ['snow', 'land'];
  if (tile.terrain === 'desert') return ['desert', 'land'];
  if (tile.terrain === 'plains') return ['plains', 'land'];
  return [freshWater(g, tiles, t) ? 'wet_grass' : 'dry_grass', 'land'];
}

/** A river on it, or a lake or an oasis beside it. */
function freshWater(g: Grid, tiles: Tile[], t: number): boolean {
  return !!tiles[t].river || neighbours(g, t).some((n) => tiles[n].terrain === 'lake' || tiles[n].feature === 'oasis' || !!tiles[n].river);
}

/** Each tile's region: the civ whose start it's nearest by land (none on land no civ starts on), and each coast beside its land. */
function regionsOf(g: Grid, tiles: Tile[], starts: number[]): number[] {
  const water = (t: number) => !!TERRAINS[tiles[t].terrain].water;
  const region: number[] = new Array(tiles.length).fill(-1);
  const queue: number[] = [];
  starts.forEach((s, i) => {
    if (s >= 0 && region[s] < 0) {
      region[s] = i;
      queue.push(s);
    }
  });
  for (let i = 0; i < queue.length; i++)
    for (const n of neighbours(g, queue[i]))
      if (region[n] < 0 && !water(n)) {
        region[n] = region[queue[i]];
        queue.push(n);
      }
  tiles.forEach((tile, t) => {
    if (tile.terrain !== 'coast') return;
    const by = neighbours(g, t).find((n) => !water(n) && region[n] >= 0);
    if (by !== undefined) region[t] = region[by];
  });
  return region;
}

/** What a region's land mostly is (Civ V's tests, in its order). */
function regionKind(tiles: Tile[], own: number[]): RegionKind {
  const land = own.filter((t) => !TERRAINS[tiles[t].terrain].water);
  const area = land.length;
  const count = (f: (tile: Tile) => boolean) => land.filter((t) => f(tiles[t])).length;
  const cold = count((x) => x.terrain === 'tundra' || x.terrain === 'snow');
  const jungle = count((x) => x.feature === 'jungle');
  const forest = count((x) => x.feature === 'forest');
  const desert = count((x) => x.terrain === 'desert');
  const hills = count((x) => x.elevation === 'hills');
  const plains = count((x) => x.terrain === 'plains');
  const grass = count((x) => x.terrain === 'grassland');
  const peaks = count((x) => x.elevation === 'mountain');
  if (!area) return 'none';
  if (cold >= area * 0.3) return 'tundra';
  if (jungle >= area * 0.3 || (jungle >= area * 0.2 && jungle + forest >= area * 0.35)) return 'jungle';
  if (forest >= area * 0.3 || (forest >= area * 0.2 && jungle + forest >= area * 0.35)) return 'forest';
  if (desert >= area * 0.25) return 'desert';
  if (hills >= area * 0.415) return 'hills';
  if (plains >= area * 0.3 && plains * 0.7 > grass) return 'plains';
  if (grass >= area * 0.3 && grass * 0.7 > plains) return 'grass';
  if (grass + plains + desert + cold + hills + peaks > area * 0.8) return 'hybrid';
  return 'none';
}

/** A pick by weight (none from an empty list). */
function pickWeighted(rng: Rng, options: [string, number][]): string | null {
  const total = options.reduce((s, [, w]) => s + w, 0);
  if (!options.length || total <= 0) return null;
  let roll = rng.next() * total;
  for (const [id, w] of options) if ((roll -= w) < 0) return id;
  return options[options.length - 1][0];
}

/**
 * The luxuries, as Civ V shares them out (`AssignLuxuryRoles`) and places them (`PlaceLuxuries`): each
 * region's type by its kind of land (no more than eight types for the regions, each a region's alone
 * until there are more than eight civs; a sea luxury only where the start is on the coast with water
 * enough), then three types for the city-states and a few left off, the rest at random. Then one of
 * each region's type by its start (within two tiles, or three), one by each city-state (three times in
 * four one of their own types), the rest of each region's about it, the random types across the map
 * up to the world's count, a second type by each start, and Marble.
 */
export function placeLuxuries(g: Grid, tiles: Tile[], rng: Rng, size: MapSize, starts: number[], cityStates: number[]): LuxuryRoles {
  const placer = new Placer(g, tiles, rng, new Set([...starts, ...cityStates]));
  const civs = starts.length;
  const counts = LUXURY_COUNTS[size];
  const region = regionsOf(g, tiles, starts);
  const own = starts.map((_, i) => region.flatMap((r, t) => (r === i ? [t] : [])));
  const kinds = own.map((tilesOf) => regionKind(tiles, tilesOf));
  const coastal = starts.map((s) => neighbours(g, s).some((n) => tiles[n].terrain === 'coast'));
  const water = own.map((tilesOf) => tilesOf.filter((t) => tiles[t].terrain === 'coast').length);

  // --- Roles. Each region a type, the regions in order of their kind (each kind's in a random order).
  const order = REGION_ORDER.flatMap((k) => placer.shuffled(starts.map((_, i) => i).filter((i) => kinds[i] === k)));
  const assigned = new Map<string, number>();
  const regions: (string | null)[] = starts.map(() => null);
  const split = civs > 12 ? 3 : civs > 8 ? 2 : 1;
  for (const i of order) {
    const kind = kinds[i];
    // (And, unlike Civ V, only a type with ground for it by the start, if any has: else a civ now and
    // then had none of its own type there, given a random one instead.)
    const canTake = (id: string, cap: number, strict: boolean) => {
      if ((assigned.get(id) ?? 0) >= cap) return false;
      if (assigned.size >= 8 && !assigned.has(id)) return false;
      if (!strict) return true;
      if (WATER_LUXURIES.has(id)) {
        if ((id === 'whales' && kind === 'jungle') || (id === 'pearls' && kind === 'tundra') || (id === 'crab' && kind === 'desert')) return false;
        if (!coastal[i] || water[i] < 12) return false;
      }
      return placer.allowedNear(starts[i], 3, id);
    };
    const weigh = (list: [string, number][], cap: number, strict: boolean): [string, number][] => list.filter(([id]) => canTake(id, cap, strict)).map(([id, w]) => [id, w / (1 + (assigned.get(id) ?? 0))]);
    let options = weigh(kind === 'none' ? FALLBACK_WEIGHTS : REGION_WEIGHTS[kind], split, true);
    if (!options.length) options = weigh(FALLBACK_WEIGHTS, split, true);
    if (!options.length) options = weigh(FALLBACK_WEIGHTS, 3, true);
    if (!options.length) options = weigh(FALLBACK_WEIGHTS, 3, false);
    const id = pickWeighted(rng, options);
    if (!id) continue;
    regions[i] = id;
    assigned.set(id, (assigned.get(id) ?? 0) + 1);
  }
  const cityStateTypes: string[] = [];
  const csOptions = CITY_STATE_WEIGHTS.filter(([id]) => !assigned.has(id));
  for (let k = 0; k < 3; k++) {
    const id = pickWeighted(rng, csOptions);
    if (!id) break;
    cityStateTypes.push(id);
    csOptions.splice(csOptions.findIndex(([x]) => x === id), 1);
  }
  const rest = placer.shuffled(FALLBACK_WEIGHTS.map(([id]) => id).filter((id) => !assigned.has(id) && !cityStateTypes.includes(id)));
  const disabled = rest.slice(0, Math.min(rest.length, counts.disabled));
  const random = rest.slice(disabled.length);
  const placed = () => tiles.filter((tile) => tile.resource && RESOURCES[tile.resource].kind === 'luxury').length;
  const at = (t: number, radius: number) => (ground: Ground) => placer.near(t, radius, ground);

  // --- At each start: one of its region's type (or, with no room for it, one of a random type).
  starts.forEach((s, i) => {
    const id = regions[i];
    if (!id) return;
    let left = placer.inGrounds(id, 1, LUXURY_GROUND[id], at(s, 2), [0.5]);
    if (left) left = placer.inGrounds(id, left, LUXURY_GROUND[id], at(s, 3), [1]);
    if (!left) return;
    let randoms = 1;
    for (const r of random) if (randoms > 0) randoms = placer.inGrounds(r, randoms, LUXURY_GROUND[r], at(s, 3), [1]);
  });

  // --- At each city-state: one of their own types three times in four (where there's ground for it), else a random one or its region's.
  for (const cs of cityStates) {
    const options: [string, number][] = [];
    const theirOwn = cityStateTypes.filter((id) => placer.allowedNear(cs, 2, id));
    for (const id of theirOwn) options.push([id, 75 / theirOwn.length]);
    const theirs = region[cs] >= 0 ? regions[region[cs]] : null;
    const randoms = random.filter((id) => placer.allowedNear(cs, 2, id));
    const share = randoms.length + (theirs ? 1 : 0);
    for (const id of randoms) options.push([id, 25 / share]);
    if (theirs && placer.allowedNear(cs, 2, theirs)) options.push([theirs, 25 / share]);
    const id = pickWeighted(rng, options);
    if (id) placer.inGrounds(id, 1, LUXURY_GROUND[id], at(cs, 2), [1]);
  }

  // --- The rest of each region's type, about it (shared out where regions share a type).
  const inRegion = (i: number) => (ground: Ground) => placer.list(ground).filter((t) => region[t] === i);
  starts.forEach((_, i) => {
    const id = regions[i];
    if (!id) return;
    const want = Math.max(1, Math.floor(counts.region[Math.min(civs, counts.region.length) - 1] / (assigned.get(id) ?? 1)));
    placer.inGrounds(id, want, LUXURY_GROUND[id], inRegion(i), [0.3, 0.3, 0.4, 0.5], placer.luxury, [[0, 3], [0, 3], [0, 2], [0, 2]]);
  });

  // --- The random types across the map, up to the world's count (a few of each at least).
  if (random.length) {
    const target = counts.world + rng.int(0, Math.max(0, civs - 1)) - placed();
    random.forEach((id, k) => {
      const many =
        random.length * 3 > target ? 3 : random.length > 8 ? Math.max(3, Math.ceil(target / 10)) : Math.max(Math.max(3, counts.least - (k + 1)), Math.ceil(target * RANDOM_SHARES[random.length - 1][k]));
      placer.inGrounds(id, many, LUXURY_GROUND[id], (ground) => placer.list(ground), [0.25, 0.25, 0.25, 0.3], placer.luxury, [[4, 6], [4, 6], [4, 6], [4, 6]]);
    });
  }

  // --- A second type by each start: a random type (or Marble) if one fits, else a city-states', else another region's.
  starts.forEach((s, i) => {
    let options = [...random, 'marble'].filter((id) => placer.allowedNear(s, 2, id));
    if (!options.length) options = cityStateTypes.filter((id) => placer.allowedNear(s, 2, id));
    if (!options.length) options = [...assigned.keys()].filter((id) => id !== regions[i] && placer.allowedNear(s, 2, id));
    if (!options.length) return;
    const id = options[rng.int(0, options.length - 1)];
    placer.inGrounds(id, 1, LUXURY_GROUND[id], at(s, 2), [1]);
  });

  // --- Marble: three for every four civs, apart from each other and the other luxuries.
  const marbles = Math.max(2, Math.ceil(civs * 0.75) - tiles.filter((tile) => tile.resource === 'marble').length);
  const marbleSpots = placer.shuffled(MARBLE_GROUND.flatMap((ground) => placer.list(ground)).filter((t, k, all) => all.indexOf(t) === k));
  for (let k = 0; k < marbles; k++) {
    const t = marbleSpots.find((x) => placer.free(x) && placer.marble[x] === 0 && placer.luxury[x] === 0);
    if (t === undefined) break;
    placer.put(t, 'marble');
    placer.mark(placer.luxury, t, 1);
    placer.mark(placer.marble, t, 6);
  }
  return { regions, cityStates: cityStateTypes, random, disabled };
}

/**
 * The strategic resources, as Civ V places them (`PlaceStrategicAndBonusResources`): large deposits on
 * the grounds that suit each, one to so many of those tiles, each a kind by its weight there; a small
 * Coal, Oil or Aluminum by three city-states in four; small deposits on flat land, one to 23 tiles,
 * each a kind the tile suits; Oil off the coast, half as much as on the land; and a large deposit more
 * where the map has too little of a kind (under four for each civ, or eight of Iron and Coal; Uranium
 * under two a civ).
 */
export function placeStrategics(g: Grid, tiles: Tile[], rng: Rng, starts: number[], cityStates: number[]) {
  const placer = new Placer(g, tiles, rng, new Set([...starts, ...cityStates]));
  const large = (id: string) => RESOURCES[id].amount![1];
  const small = (id: string) => RESOURCES[id].amount![0];
  // Civ V's ProcessResourceList: so many to the tiles of a ground, each of a kind by weight, the first
  // free tile clear of the others' marks taken (or, once there's none, the one marked least).
  const process = (every: number, ground: Ground, kinds: [id: string, weight: number, minR: number, maxR: number][]) => {
    const list = placer.list(ground);
    const many = Math.ceil(list.length / every);
    let next = 0;
    for (let k = 0; k < many; k++) {
      const pick = pickWeighted(rng, kinds.map(([id, w]) => [id, w]))!;
      const [id, , minR, maxR] = kinds.find(([x]) => x === pick)!;
      let t = -1;
      while (next < list.length && t < 0) {
        const x = list[next++];
        if (placer.free(x) && placer.strategic[x] === 0) t = x;
      }
      if (t < 0) {
        let least = 98;
        for (const x of list)
          if (placer.free(x) && placer.strategic[x] < least) {
            least = placer.strategic[x];
            t = x;
          }
      }
      if (t < 0) continue;
      placer.put(t, id, large(id));
      placer.mark(placer.strategic, t, minR + (maxR > minR ? rng.int(0, maxR - minR) : 0));
    }
  };
  process(9, 'marsh', [['oil', 65, 1, 1], ['uranium', 35, 0, 1]]);
  process(16, 'open_tundra', [['oil', 40, 1, 2], ['aluminum', 15, 1, 2], ['iron', 45, 1, 2]]);
  process(17, 'snow', [['oil', 60, 1, 1], ['aluminum', 15, 2, 3], ['iron', 25, 2, 3]]);
  process(13, 'desert', [['oil', 65, 0, 1], ['iron', 35, 1, 1]]);
  process(22, 'hills', [['iron', 26, 0, 2], ['coal', 35, 1, 3], ['aluminum', 39, 2, 3]]);
  process(33, 'jungle', [['coal', 30, 1, 2], ['uranium', 70, 1, 2]]);
  process(39, 'forest', [['coal', 30, 1, 2], ['uranium', 70, 1, 1]]);
  process(33, 'dry_grass', [['horses', 100, 2, 5]]);
  process(33, 'plains', [['horses', 100, 1, 4]]);

  // By three city-states in four: a small Coal, Oil or Aluminum within three tiles.
  const minor: Record<string, Ground[]> = {
    coal: ['open_hills', 'covered_hills', 'tundra', 'dry_grass', 'plains', 'desert'],
    oil: ['desert', 'marsh', 'tundra', 'temperate_forest', 'dry_grass', 'plains'],
    aluminum: ['open_hills', 'covered_hills', 'tundra', 'desert', 'plains', 'dry_grass'],
  };
  for (const cs of cityStates) {
    const roll = rng.int(0, 3);
    if (!roll) continue;
    const id = (['coal', 'oil', 'aluminum'] as const)[roll - 1];
    placer.inGrounds(id, 1, minor[id], (ground) => placer.near(cs, 3, ground), [1], undefined, undefined, small(id));
  }

  // Small deposits on the flat land, one to 23 tiles, clear of the others' marks: a kind the tile suits.
  const land = placer.list('land');
  let next = 0;
  for (let k = Math.ceil(land.length / 23); k > 0 && next < land.length; k--) {
    let t = -1;
    while (next < land.length && t < 0) {
      const x = land[next++];
      if (placer.free(x) && placer.strategic[x] === 0) t = x;
    }
    if (t < 0) break;
    const id = smallKind(g, tiles, rng, t);
    placer.put(t, id, small(id));
    const radius = rng.int(0, 3);
    placer.mark(placer.strategic, t, radius > 2 ? 1 : radius);
  }

  // Oil off the coast, half as much as on the land, in deposits of 4 spread well apart.
  const total = (id: string) => tiles.reduce((s, tile) => s + (tile.resource === id ? (tile.amount ?? 0) : 0), 0);
  placer.some('oil', Math.floor(total('oil') / 2 / SEA_OIL), 0.2, placer.list('sea'), placer.strategic, 4, 7, SEA_OIL);

  // Too little of a kind: a large deposit more.
  const civs = starts.length;
  const more = (id: string, ground: Ground) => process(99999, ground, [[id, 100, 0, 0]]);
  if (total('iron') < 8) more('iron', 'hills');
  if (total('iron') < 4 * civs) more('iron', 'land');
  if (total('horses') < 4 * civs) more('horses', 'plains');
  if (total('horses') < 4 * civs) more('horses', 'dry_grass');
  if (total('coal') < 8) more('coal', 'hills');
  if (total('coal') < 4 * civs) more('coal', 'land');
  if (total('oil') < 4 * civs) more('oil', 'land');
  if (total('aluminum') < 4 * civs) more('aluminum', 'hills');
  if (total('uranium') < 2 * civs) more('uranium', 'land');
}

/** The kind of a small deposit on a tile of flat land (Civ V's `PlaceSmallQuantitiesOfStrategics`). */
function smallKind(g: Grid, tiles: Tile[], rng: Rng, t: number): string {
  const tile = tiles[t];
  if (tile.feature === 'jungle') return ['oil', 'coal', 'aluminum', 'aluminum'][rng.int(0, 3)];
  if (tile.feature === 'forest') return ['uranium', 'coal', 'iron', 'iron'][rng.int(0, 3)];
  if (tile.terrain === 'grassland') return freshWater(g, tiles, t) || rng.int(0, 4) >= 3 ? 'horses' : 'iron';
  if (tile.terrain === 'plains') return rng.int(0, 4) < 2 ? 'iron' : 'horses';
  if (tile.terrain === 'desert') return ['iron', 'aluminum', 'oil'][rng.int(0, 2)];
  return ['iron', 'uranium', 'oil', 'oil'][rng.int(0, 3)];
}
