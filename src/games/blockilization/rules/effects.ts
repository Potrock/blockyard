import type { Elevation, FeatureId, ResourceKind, TerrainId, Yields } from './terrain';
import type { Domain } from './units';

/**
 * What something does, in one shape for everything that does things: buildings, wonders, social
 * policies, beliefs, civilizations' abilities. The rules read these; anything too particular for
 * them is a `special` the rules know by name.
 *
 * Where an effect reaches: a building's effects are its city's, and a policy's, a belief's or a
 * civ's ability's are every city's (so a policy's `happiness: 1` is one in each city). A building's
 * `empire` part is every city's too (a wonder's reach). What belongs to the civ as a whole (combat,
 * moves, policy costs, golden ages, trade routes, purchases...) counts from all of them, buildings
 * anywhere in the empire included (`civEffects` in `economy.ts`).
 */

export type GreatKind = 'artist' | 'writer' | 'musician' | 'scientist' | 'engineer' | 'merchant' | 'general' | 'admiral' | 'prophet';
/** The great people a free choice can bring. */
export const CHOOSABLE: GreatKind[] = ['scientist', 'engineer', 'merchant', 'artist', 'writer', 'musician', 'general', 'admiral'];
export type SpecialistKind = 'artist' | 'writer' | 'musician' | 'scientist' | 'engineer' | 'merchant';
export type WorkKind = 'art' | 'writing' | 'music';

/** Which tiles a tile bonus is for. */
export interface TileFilter {
  terrain?: TerrainId[];
  feature?: FeatureId[];
  elevation?: Elevation[];
  resource?: string[];
  resourceKind?: ResourceKind[];
  improvement?: string[];
  /** Sea tiles (coast, ocean, lake). */
  water?: boolean;
  river?: boolean;
  /** A natural wonder's tile. */
  naturalWonder?: boolean;
}

/** Which of a civ's cities an effect is for (every condition given must hold). */
export interface CityFilter {
  capital?: boolean;
  /** Next to the sea. */
  coastal?: boolean;
  /** By a river or a lake. */
  freshWater?: boolean;
  /** At least this many citizens. */
  minPop?: number;
  /** A military unit of its own stands in it. */
  garrisoned?: boolean;
  /** Linked to the capital (not the capital itself) by roads, railroads or harbours. */
  connected?: boolean;
  /** The holy city of its owner's own religion. */
  holyCity?: boolean;
  /** One of its citizens is a specialist. */
  specialist?: boolean;
  /** It has one of these buildings (or a civ's own version of one). */
  building?: string[];
  /** Its owner knows this tech (`after`), or doesn't yet (`before`). */
  after?: string;
  before?: string;
}

/** When a combat bonus counts. */
export type CombatWhen =
  | 'always'
  | 'attacking'
  | 'defending'
  /** Fighting in its own land. */
  | 'friendly_land'
  /** Attacking a city. */
  | 'vs_cities'
  | 'vs_barbarians'
  /** Fighting a city-state's units or its city. */
  | 'vs_city_states'
  /** Another of its owner's military units is next to it. */
  | 'beside_friend'
  /** In its own land around a city that follows its owner's religion, or an enemy's that does. */
  | 'faithful_land'
  | 'faithful_enemy_land';

export interface Effects {
  /** Flat yields in the city. */
  yields?: Yields;
  /** Yields per citizen. */
  perPop?: Yields;
  /** Percent more of a yield in the city (food: of the surplus it grows on). */
  percent?: Yields;
  /** Extra yields on worked tiles that match. */
  tiles?: { where: TileFilter; yields: Yields }[];
  /** Happiness (a policy's or a belief's: in each city). */
  happiness?: number;
  /** Fewer unhappy faces from citizens, across the empire (percent; Civ V's -% unhappiness). */
  unhappinessPercent?: number;
  /** Happiness for each luxury (Civ V's +1 per luxury policies). */
  happinessPerLuxury?: number;
  /** City defence (combat strength) and hit points; and percent more of the city's whole strength. */
  defense?: number;
  hp?: number;
  cityStrength?: number;
  /** Experience, and promotions, for units trained in the city (by domain; 'all' for any). */
  xp?: { domain: Domain | 'all'; xp: number }[];
  promotions?: { domain: Domain | 'all'; promotion: string }[];
  /** Production toward units of these classes (or ids) or domains (percent). */
  unitProduction?: { classes?: string[]; domain?: Domain; percent: number }[];
  /** Production toward wonders, toward buildings, toward these particular buildings, toward spaceship parts (percent). */
  wonderProduction?: number;
  buildingProduction?: number;
  buildingBoost?: { buildings: string[]; percent: number }[];
  spaceshipProduction?: number;
  /** Great person points a turn, and percent more of them. */
  greatPeople?: { kind: GreatKind; points: number }[];
  greatPeoplePercent?: number;
  specialists?: { kind: SpecialistKind; slots: number }[];
  /** Extra yields from each specialist. */
  specialistYields?: Yields;
  greatWorks?: { kind: WorkKind; slots: number };
  /** Food kept when the city grows (percent). */
  foodKept?: number;
  /** Percent cheaper border growth (culture for tiles). */
  borderCost?: number;
  /** Percent off gold costs of buying tiles. */
  tileGoldCost?: number;
  /** Once, when it's built or adopted. */
  freeTechs?: number;
  freePolicies?: number;
  freeGreatPerson?: GreatKind | 'any';
  /** Great people of these kinds can be bought with faith from the Industrial Era (Civ V's late use of faith). */
  faithGreatPeople?: GreatKind[];
  freeUnits?: { unit: string; count: number }[];
  /** A building it gives in every city the civ has (and founds). */
  freeBuildingInAll?: string;
  /** A building it gives free in the civ's first few cities (those it has, then the next it founds). */
  freeBuildings?: { building: string; cities: number };
  /** A building it gives in this city. */
  freeBuildingHere?: string;
  /** Turns of golden age it starts, and percent longer golden ages. */
  goldenAge?: number;
  goldenAgeLength?: number;
  /** More trade routes the civ may have. */
  tradeRoutes?: number;
  /** Percent off maintenance of units. */
  unitUpkeep?: number;
  /** Percent cheaper social policies. */
  policyCost?: number;
  /** Percent off buying things with gold (units, buildings, or anything). */
  purchaseDiscount?: { kind?: 'unit' | 'building'; percent: number }[];
  /** Combat strength percent for the civ's units (all, or some classes). */
  combat?: { classes?: string[]; percent: number; when?: CombatWhen }[];
  /** Extra moves and sight for units (by domain, or some classes). */
  moves?: { domain: Domain; classes?: string[]; moves: number }[];
  sight?: { domain: Domain; sight: number }[];
  /** Percent faster workers. */
  workRate?: number;
  /** Religion's pressure the city puts out (percent more). */
  pressure?: number;
  /** Buildings a city following the religion can buy with faith. */
  faithBuildings?: string[];
  /** Tourism the city makes (flat, or percent). */
  tourism?: number;
  tourismPercent?: number;
  /** City-state friendship: percent slower to fall back. */
  cityStateInfluence?: number;
  /** Turns it lasts once adopted (a policy). */
  turns?: number;
  /** What it gives every city of the civ (a building's reach over the empire). */
  empire?: Effects;
  /** Effects only in the cities that match (the capital, coastal ones, those of 6 or more...). */
  cities?: { when: CityFilter; effects: Effects }[];
  /** Effects a city has once for each of these buildings it has (or the civs' own versions of them). */
  perBuilding?: { buildings: string[]; effects: Effects }[];
  /** Anything else, by name: the rules handle each. */
  special?: string[];
}
