/**
 * What the land is: terrains, the features on them, resources and the improvements workers build.
 * The numbers are Civilization V's (its yields, movement costs and defence), so the game plays the
 * way its players already know.
 */

export type YieldKey = 'food' | 'prod' | 'gold' | 'science' | 'culture' | 'faith';
export type Yields = Partial<Record<YieldKey, number>>;
export const YIELD_KEYS: YieldKey[] = ['food', 'prod', 'gold', 'science', 'culture', 'faith'];

export const addYields = (a: Yields, b: Yields | undefined, k = 1): Yields => {
  if (!b) return a;
  const out: Yields = { ...a };
  for (const key of YIELD_KEYS) if (b[key]) out[key] = (out[key] ?? 0) + (b[key] ?? 0) * k;
  return out;
};

export type TerrainId = 'grassland' | 'plains' | 'desert' | 'tundra' | 'snow' | 'coast' | 'ocean' | 'lake';
/** Land's shape over its terrain: flat, hills, or mountains (impassable). */
export type Elevation = 'flat' | 'hills' | 'mountain';
export type FeatureId = 'forest' | 'jungle' | 'marsh' | 'oasis' | 'floodplains' | 'ice' | 'atoll' | 'fallout';

export interface Terrain {
  name: string;
  yields: Yields;
  water?: boolean;
  /** Movement points it takes to enter. */
  move: number;
  /** Combat strength bonus for a unit defending on it, in percent. */
  defense: number;
}

export const TERRAINS: Record<TerrainId, Terrain> = {
  grassland: { name: 'Grassland', yields: { food: 2 }, move: 1, defense: 0 },
  plains: { name: 'Plains', yields: { food: 1, prod: 1 }, move: 1, defense: 0 },
  desert: { name: 'Desert', yields: {}, move: 1, defense: 0 },
  tundra: { name: 'Tundra', yields: { food: 1 }, move: 1, defense: 0 },
  snow: { name: 'Snow', yields: {}, move: 1, defense: 0 },
  coast: { name: 'Coast', yields: { food: 1, gold: 1 }, water: true, move: 1, defense: 0 },
  ocean: { name: 'Ocean', yields: { food: 1, gold: 1 }, water: true, move: 1, defense: 0 },
  lake: { name: 'Lake', yields: { food: 2, gold: 1 }, water: true, move: 1, defense: 0 },
};

/** Hills replace the terrain's yields with their own; mountains can't be worked or crossed. */
export const HILLS = { name: 'Hills', yields: { prod: 2 } as Yields, move: 2, defense: 25 };
export const MOUNTAIN = { name: 'Mountain', yields: {} as Yields, move: Infinity, defense: 25 };

export interface Feature {
  name: string;
  /** Yields it gives in place of the terrain's (`replace`), or on top of them. */
  yields: Yields;
  replace?: boolean;
  move: number;
  defense: number;
  /** It can't be entered (ice). */
  impassable?: boolean;
  /** A worker can clear it (and what clearing it gives the nearest city's production). */
  removable?: { tech: string; turns: number; prod?: number };
  /** Damage to a unit ending its turn on it (fallout's). */
  hurts?: number;
}

export const FEATURES: Record<FeatureId, Feature> = {
  forest: { name: 'Forest', yields: { food: 1, prod: 1 }, replace: true, move: 2, defense: 25, removable: { tech: 'mining', turns: 4, prod: 20 } },
  jungle: { name: 'Jungle', yields: { food: 1 }, replace: true, move: 2, defense: 25, removable: { tech: 'bronze_working', turns: 7 } },
  marsh: { name: 'Marsh', yields: { food: -1 }, move: 2, defense: -15, removable: { tech: 'masonry', turns: 6 } },
  oasis: { name: 'Oasis', yields: { food: 3, gold: 1 }, replace: true, move: 1, defense: -10 },
  floodplains: { name: 'Flood Plains', yields: { food: 2 }, move: 1, defense: -10 },
  ice: { name: 'Ice', yields: {}, replace: true, move: Infinity, defense: 0, impassable: true },
  atoll: { name: 'Atoll', yields: { food: 1, prod: 1 }, move: 1, defense: 0 },
  // Left by a nuclear blast (Civ V's): -3 food, -3 production, -10 gold (next to nothing is left), and it
  // hurts units that end their turn in it; a worker scrubs it away (`FALLOUT`).
  fallout: { name: 'Fallout', yields: { food: -3, prod: -3, gold: -10 }, move: 2, defense: 0, hurts: 15 },
};

/**
 * Sight's levels (Civ V's): how high a tile stands to see from, hills a level up and mountains two;
 * and to see past, forest and jungle a level higher still. Only what stands higher than the eye
 * blocks it, so from flat land forest, jungle, hills and mountains do (they're seen, not what's behind
 * them); from a hill, only wooded hills and mountains.
 */
export const seeFromLevel = (tile: { elevation: Elevation }) => (tile.elevation === 'mountain' ? 2 : tile.elevation === 'hills' ? 1 : 0);
export const seeThroughLevel = (tile: { elevation: Elevation; feature?: string }) => seeFromLevel(tile) + (tile.feature === 'forest' || tile.feature === 'jungle' ? 1 : 0);

/**
 * Nuclear fallout (Civ V's): each land tile of a blast (not a city's, a mountain or a natural
 * wonder's) gets it by this chance, the blast's forests, jungles and marshes burnt away whether or
 * not; flood plains, oases, ice and atolls are left as they are, and keep it off. Workers scrub it
 * away in this many turns (before the game's speed), and nothing else is built or mended under it.
 */
export const FALLOUT = { chance: 0.5, scrubTurns: 6, burns: ['forest', 'jungle', 'marsh'] as FeatureId[] };

// -------------------------------------------------------------------------------------------------
// Resources
// -------------------------------------------------------------------------------------------------

export type ResourceKind = 'bonus' | 'strategic' | 'luxury';

export interface Resource {
  name: string;
  kind: ResourceKind;
  yields: Yields;
  /** The improvement that taps it, and what that adds. */
  improvement: ImprovementId;
  improved: Yields;
  /** The tech that shows it (strategic resources are hidden until then). */
  reveal?: string;
  /** Where it's found: terrains, features, elevations. */
  on: (TerrainId | FeatureId | Elevation)[];
  /** How common, relative to others of its kind. */
  weight: number;
  /** A strategic resource's quantity per deposit (a unit needs one each). */
  amount?: [number, number];
  /** Its colour on the map (and its icon's). */
  color: string;
}

export type ImprovementId = 'farm' | 'mine' | 'trading_post' | 'lumber_mill' | 'pasture' | 'camp' | 'plantation' | 'quarry' | 'fishing_boats' | 'oil_well' | 'offshore_platform' | 'fort' | 'citadel' | 'academy' | 'customs_house' | 'manufactory' | 'holy_site' | 'landmark';

export const RESOURCES: Record<string, Resource> = {
  // Bonus
  wheat: { name: 'Wheat', kind: 'bonus', yields: { food: 1 }, improvement: 'farm', improved: { food: 1 }, on: ['plains', 'floodplains', 'desert'], weight: 10, color: '#e8c95a' },
  cattle: { name: 'Cattle', kind: 'bonus', yields: { food: 1 }, improvement: 'pasture', improved: { prod: 1 }, on: ['grassland'], weight: 10, color: '#8a5a3a' },
  sheep: { name: 'Sheep', kind: 'bonus', yields: { food: 1 }, improvement: 'pasture', improved: { prod: 1 }, on: ['hills'], weight: 10, color: '#f0eee6' },
  deer: { name: 'Deer', kind: 'bonus', yields: { food: 1 }, improvement: 'camp', improved: { prod: 1 }, on: ['forest', 'tundra'], weight: 10, color: '#b07a4a' },
  bananas: { name: 'Bananas', kind: 'bonus', yields: { food: 1 }, improvement: 'plantation', improved: { food: 1 }, on: ['jungle'], weight: 8, color: '#f2d43a' },
  fish: { name: 'Fish', kind: 'bonus', yields: { food: 2 }, improvement: 'fishing_boats', improved: { food: 1 }, on: ['coast'], weight: 12, color: '#7ac8e8' },
  stone: { name: 'Stone', kind: 'bonus', yields: { prod: 1 }, improvement: 'quarry', improved: { prod: 1 }, on: ['grassland', 'plains', 'desert', 'tundra'], weight: 6, color: '#9a9a9a' },
  // Strategic
  horses: { name: 'Horses', kind: 'strategic', yields: { prod: 1 }, improvement: 'pasture', improved: { prod: 1 }, reveal: 'animal_husbandry', on: ['grassland', 'plains', 'tundra'], weight: 10, amount: [2, 4], color: '#c49a6c' },
  iron: { name: 'Iron', kind: 'strategic', yields: { prod: 1 }, improvement: 'mine', improved: { prod: 1 }, reveal: 'bronze_working', on: ['hills', 'grassland', 'plains', 'desert', 'tundra', 'snow'], weight: 10, amount: [2, 6], color: '#7a8a9a' },
  coal: { name: 'Coal', kind: 'strategic', yields: { prod: 1 }, improvement: 'mine', improved: { prod: 1 }, reveal: 'industrialization', on: ['hills', 'grassland', 'plains'], weight: 8, amount: [2, 6], color: '#a0a0ac' },
  oil: { name: 'Oil', kind: 'strategic', yields: { prod: 1 }, improvement: 'oil_well', improved: { prod: 1 }, reveal: 'biology', on: ['desert', 'tundra', 'snow', 'marsh', 'jungle', 'coast'], weight: 8, amount: [2, 6], color: '#9a88c8' },
  aluminum: { name: 'Aluminum', kind: 'strategic', yields: { prod: 1 }, improvement: 'mine', improved: { prod: 1 }, reveal: 'electricity', on: ['hills', 'plains', 'desert', 'tundra'], weight: 6, amount: [2, 6], color: '#d8dde3' },
  uranium: { name: 'Uranium', kind: 'strategic', yields: { prod: 1 }, improvement: 'mine', improved: { prod: 1 }, reveal: 'atomic_theory', on: ['hills', 'tundra', 'desert', 'forest', 'jungle', 'marsh'], weight: 4, amount: [1, 4], color: '#7aff3a' },
  // Luxury
  gold_ore: { name: 'Gold', kind: 'luxury', yields: { gold: 2 }, improvement: 'mine', improved: { gold: 1 }, on: ['hills', 'desert', 'plains', 'grassland'], weight: 6, color: '#ffc531' },
  silver: { name: 'Silver', kind: 'luxury', yields: { gold: 2 }, improvement: 'mine', improved: { gold: 1 }, on: ['hills', 'desert', 'tundra'], weight: 6, color: '#cfd6dc' },
  gems: { name: 'Gems', kind: 'luxury', yields: { gold: 3 }, improvement: 'mine', improved: { gold: 1 }, on: ['jungle', 'hills', 'desert', 'grassland', 'plains', 'tundra'], weight: 6, color: '#3ad0ff' },
  marble: { name: 'Marble', kind: 'luxury', yields: { gold: 2 }, improvement: 'quarry', improved: { prod: 1 }, on: ['grassland', 'plains', 'desert', 'tundra', 'hills'], weight: 5, color: '#f4f1ea' },
  copper: { name: 'Copper', kind: 'luxury', yields: { gold: 2 }, improvement: 'mine', improved: { gold: 1 }, on: ['hills', 'desert', 'plains', 'grassland', 'tundra'], weight: 5, color: '#d8844a' },
  salt: { name: 'Salt', kind: 'luxury', yields: { food: 1, gold: 1 }, improvement: 'mine', improved: { prod: 1 }, on: ['plains', 'desert', 'tundra'], weight: 5, color: '#f8f4ec' },
  ivory: { name: 'Ivory', kind: 'luxury', yields: { gold: 2 }, improvement: 'camp', improved: { prod: 1 }, on: ['plains'], weight: 5, color: '#f4ecd4' },
  furs: { name: 'Furs', kind: 'luxury', yields: { gold: 2 }, improvement: 'camp', improved: { prod: 1 }, on: ['tundra', 'forest'], weight: 5, color: '#8a5a2a' },
  truffles: { name: 'Truffles', kind: 'luxury', yields: { gold: 2 }, improvement: 'camp', improved: { prod: 1 }, on: ['forest', 'jungle', 'marsh'], weight: 4, color: '#5a3a2a' },
  dyes: { name: 'Dyes', kind: 'luxury', yields: { gold: 2 }, improvement: 'plantation', improved: { gold: 1 }, on: ['jungle', 'forest'], weight: 5, color: '#b03ad0' },
  spices: { name: 'Spices', kind: 'luxury', yields: { gold: 2 }, improvement: 'plantation', improved: { gold: 1 }, on: ['jungle', 'forest'], weight: 5, color: '#d8642a' },
  silk: { name: 'Silk', kind: 'luxury', yields: { gold: 2 }, improvement: 'plantation', improved: { gold: 1 }, on: ['forest'], weight: 5, color: '#ff8ab6' },
  sugar: { name: 'Sugar', kind: 'luxury', yields: { gold: 2 }, improvement: 'plantation', improved: { gold: 1 }, on: ['floodplains', 'marsh'], weight: 5, color: '#ffffff' },
  cotton: { name: 'Cotton', kind: 'luxury', yields: { gold: 2 }, improvement: 'plantation', improved: { gold: 1 }, on: ['grassland', 'plains', 'desert'], weight: 5, color: '#f4f4f4' },
  wine: { name: 'Wine', kind: 'luxury', yields: { gold: 2 }, improvement: 'plantation', improved: { gold: 1 }, on: ['grassland', 'plains'], weight: 5, color: '#8a1a3a' },
  incense: { name: 'Incense', kind: 'luxury', yields: { gold: 2 }, improvement: 'plantation', improved: { gold: 1 }, on: ['desert', 'plains'], weight: 5, color: '#c4a46a' },
  citrus: { name: 'Citrus', kind: 'luxury', yields: { gold: 2 }, improvement: 'plantation', improved: { gold: 1 }, on: ['grassland', 'plains', 'jungle'], weight: 4, color: '#ff9a1a' },
  cocoa: { name: 'Cocoa', kind: 'luxury', yields: { gold: 2 }, improvement: 'plantation', improved: { gold: 1 }, on: ['jungle', 'forest'], weight: 4, color: '#6a3a1a' },
  whales: { name: 'Whales', kind: 'luxury', yields: { food: 1, gold: 1 }, improvement: 'fishing_boats', improved: { food: 1 }, on: ['coast'], weight: 4, color: '#3a5a7a' },
  pearls: { name: 'Pearls', kind: 'luxury', yields: { gold: 2 }, improvement: 'fishing_boats', improved: { food: 1 }, on: ['coast'], weight: 4, color: '#f4f8ff' },
  crab: { name: 'Crab', kind: 'luxury', yields: { gold: 2 }, improvement: 'fishing_boats', improved: { food: 1 }, on: ['coast'], weight: 3, color: '#e8543a' },
};

/** The improvement that taps a tile's resource: the resource's own, but Oil out at sea takes an Offshore Platform (a work boat's, with Refrigeration). */
export function tapsWith(tile: { resource?: string; terrain: TerrainId }): ImprovementId | undefined {
  const r = tile.resource ? RESOURCES[tile.resource] : undefined;
  if (!r) return undefined;
  return r.improvement === 'oil_well' && TERRAINS[tile.terrain]?.water ? 'offshore_platform' : r.improvement;
}

/** What a work boat builds (out at sea, and it's spent doing it): fishing boats, and offshore platforms on Oil. */
export const SEA_WORK: readonly string[] = ['fishing_boats', 'offshore_platform'];

/** Whether a tile's resource is tapped: its improvement stands there, unpillaged. */
export const tapped = (tile: { resource?: string; terrain: TerrainId; improvement?: ImprovementId; pillaged?: boolean }): boolean => !!tile.improvement && !tile.pillaged && tile.improvement === tapsWith(tile);

// -------------------------------------------------------------------------------------------------
// Improvements
// -------------------------------------------------------------------------------------------------

export interface Improvement {
  name: string;
  tech: string;
  /** Worker-turns to build (Civ V's, before the game speed). */
  turns: number;
  yields: Yields;
  /** Where it can go: terrains, features, elevations, or 'resource' (only on its resources). */
  on: (TerrainId | FeatureId | Elevation | 'resource' | 'any_land')[];
  /** It needs fresh water (a river, a lake, an oasis next to it) until this tech. */
  freshWaterUntil?: string;
  /** Only great people make it. */
  great?: boolean;
  /** Its colour on the map. */
  color: string;
}

export const IMPROVEMENTS: Record<ImprovementId, Improvement> = {
  farm: { name: 'Farm', tech: 'agriculture', turns: 5, yields: { food: 1 }, on: ['grassland', 'plains', 'desert', 'tundra', 'floodplains', 'hills'], freshWaterUntil: 'civil_service', color: '#d8c04a' },
  mine: { name: 'Mine', tech: 'mining', turns: 6, yields: { prod: 1 }, on: ['hills', 'resource'], color: '#6a6a6a' },
  trading_post: { name: 'Trading Post', tech: 'trapping', turns: 6, yields: { gold: 1 }, on: ['grassland', 'plains', 'desert', 'tundra', 'jungle'], color: '#c48a3a' },
  lumber_mill: { name: 'Lumber Mill', tech: 'construction', turns: 6, yields: { prod: 1 }, on: ['forest'], color: '#7a5a2a' },
  pasture: { name: 'Pasture', tech: 'animal_husbandry', turns: 7, yields: {}, on: ['resource'], color: '#8ac04a' },
  camp: { name: 'Camp', tech: 'trapping', turns: 6, yields: {}, on: ['resource'], color: '#8a6a3a' },
  plantation: { name: 'Plantation', tech: 'calendar', turns: 5, yields: {}, on: ['resource'], color: '#4ab04a' },
  quarry: { name: 'Quarry', tech: 'masonry', turns: 7, yields: {}, on: ['resource'], color: '#b0b0b0' },
  fishing_boats: { name: 'Fishing Boats', tech: 'sailing', turns: 0, yields: {}, on: ['resource'], color: '#4a8ac0' },
  oil_well: { name: 'Oil Well', tech: 'biology', turns: 8, yields: {}, on: ['resource'], color: '#2a2a2a' },
  offshore_platform: { name: 'Offshore Platform', tech: 'refrigeration', turns: 0, yields: {}, on: ['resource'], color: '#4a4a4a' },
  fort: { name: 'Fort', tech: 'engineering', turns: 6, yields: {}, on: ['any_land'], color: '#8a7a6a' },
  citadel: { name: 'Citadel', tech: '', turns: 0, yields: {}, on: ['any_land'], great: true, color: '#6a5a4a' },
  academy: { name: 'Academy', tech: '', turns: 0, yields: { science: 3 }, on: ['any_land'], great: true, color: '#4aa8ff' },
  customs_house: { name: 'Customs House', tech: '', turns: 0, yields: { gold: 4 }, on: ['any_land'], great: true, color: '#ffd23a' },
  manufactory: { name: 'Manufactory', tech: '', turns: 0, yields: { prod: 3 }, on: ['any_land'], great: true, color: '#ff8a2a' },
  holy_site: { name: 'Holy Site', tech: '', turns: 0, yields: { faith: 3 }, on: ['any_land'], great: true, color: '#f4f4f4' },
  landmark: { name: 'Landmark', tech: '', turns: 0, yields: { culture: 3 }, on: ['any_land'], great: true, color: '#ff5aa8' },
};

/** A road's cost to move along (one-third of a movement point), and a railroad's. */
export const ROAD_MOVE = 1 / 3;
export const RAIL_MOVE = 1 / 10;
