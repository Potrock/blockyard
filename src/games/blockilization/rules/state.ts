import type { BotMemory } from './ai/memory';
import type { Difficulty } from './difficulty';
import type { Congress } from './congress';
import type { Relations } from './diplomacy';
import type { Quest } from './quests';
import type { Replay } from './replay';
import type { GreatKind, SpecialistKind } from './effects';
import type { Grid } from './hex';
import type { Elevation, FeatureId, ImprovementId, TerrainId } from './terrain';

/**
 * A game of Blockilization as plain data: the map, the civilizations, their cities and units, whose
 * turn it is. Everything the rules change is in here and nothing else, so a game saves as it is
 * (JSON) and carries on from there, and the server sends each player the part they can see.
 */

export interface Tile {
  terrain: TerrainId;
  elevation: Elevation;
  feature?: FeatureId;
  resource?: string;
  /** A strategic resource's quantity. */
  amount?: number;
  /** Fresh water runs by it (a river tile: +1 gold, farms anywhere near it). */
  river?: boolean;
  improvement?: ImprovementId;
  /** Being built here by a worker: what, and turns left. */
  pillaged?: boolean;
  road?: 'road' | 'rail';
  /** Whose land it is (player index), or -1; and the city it belongs to. */
  owner: number;
  city?: number;
  /** An ancient ruin (a goody hut), a barbarian camp, a natural wonder (by id, `nature.ts`), an antiquity site (seen with Archaeology; a hidden one only with Treasure Fleets or Aesthetics). */
  ruin?: boolean;
  camp?: boolean;
  wonder?: string;
  antiquity?: boolean;
  hiddenAntiquity?: boolean;
  /** Its height in blocks over the sea (for the voxel map and the camera). */
  height: number;
}

export interface Unit {
  id: number;
  type: string;
  owner: number;
  tile: number;
  /** Moves left this turn (whole moves; roads use thirds), and those it began the turn with (to tell whether it has moved since). */
  moves: number;
  turnMoves?: number;
  hp: number;
  xp: number;
  promotions: string[];
  /** Fortified (+defence), asleep (skipped until something comes near), or on sentry (a fighter: on patrol). */
  stance?: 'fortify' | 'sleep' | 'alert';
  /** Turns it's been fortified (the bonus builds). */
  fortified?: number;
  /** Where it's going (tiles still to step through), for multi-turn moves. */
  path?: number[];
  /** The enemy soldiers it has had in sight on its way (ids): a long move stops only for one it hasn't seen yet. */
  sighted?: number[];
  /** A settler's: the city site it's on its way to (one where a city could be founded when it was sent). */
  site?: number;
  /** Building an improvement or a road (or digging up an artifact): what, and the worker-turns it's had. */
  work?: { what: ImprovementId | 'road' | 'rail' | 'remove_feature' | 'repair' | 'artifact'; done: number };
  /** Has it attacked this turn (most units only once), and how many times (Blitz, Logistics: twice). */
  attacked?: boolean;
  attacks?: number;
  /** Set up to fire (siege units must, the turn before). */
  setUp?: boolean;
  /** At sea in a land unit. */
  embarked?: boolean;
  /** A religious unit's religion, and spreads left. */
  religion?: string;
  spreads?: number;
  /** A trade unit's route: from city to city (ids), turns left. */
  route?: { from: number; to: number; turns: number };
  /** A great person's or a unit's name of its own. */
  name?: string;
  /** For a ranged unit: has it been told to stay put this turn (skip). */
  skip?: boolean;
  /** Left to itself (a person's unit): a worker improving the land, a unit exploring. */
  auto?: 'work' | 'explore';
  /** An aircraft aboard a carrier: the carrier's id (`air.ts`); and the turn it last intercepted. */
  carrier?: number;
  intercepted?: number;
}

export type ProductionKind = 'unit' | 'building' | 'project' | 'process';
export interface Production {
  kind: ProductionKind;
  id: string;
}

export interface City {
  id: number;
  name: string;
  owner: number;
  /** Who founded it (a capital taken stays someone's original capital). */
  founder: number;
  tile: number;
  pop: number;
  /** Food in the box, production toward what's being built, culture toward the next tile. */
  food: number;
  prod: number;
  culture: number;
  /** Tiles it has (beyond the first ring), for the cost of the next. */
  tilesBought: number;
  hp: number;
  /** Attacked since its last turn (so it heals less: `cityHeal`). */
  attacked?: boolean;
  buildings: string[];
  queue: Production[];
  /** Units finished go back to the end of the queue, to be built again (the city screen's Repeat). */
  repeat?: boolean;
  /** Tiles its citizens work (not the city's own); the rest are specialists. */
  worked: number[];
  specialists: Partial<Record<SpecialistKind, number>>;
  /** What the governor favours when it places citizens. */
  focus: 'balanced' | 'food' | 'prod' | 'gold' | 'science' | 'culture' | 'faith';
  /** Citizens placed by hand (the governor leaves them): on tiles, and as specialists of each kind. */
  locked?: number[];
  lockedSpecialists?: Partial<Record<SpecialistKind, number>>;
  capital?: boolean;
  /** A conquered city kept as a puppet (no say in it), or being razed (turns left). */
  puppet?: boolean;
  razing?: number;
  occupied?: boolean;
  /** Has it fired this turn. */
  fired?: boolean;
  /** Turns of resistance after being taken. */
  resistance?: number;
  /** Religious followers by religion (citizens), and pressure built up. */
  followers?: Record<string, number>;
  pressure?: Record<string, number>;
  /** Great works in its buildings: by building id, the works' names. */
  works?: Record<string, string[]>;
  /** Wonders built here (for the map and the score). */
  wonders?: string[];
  /** Production put into each item it switched away from (kept, as Civ V does). */
  saved?: Record<string, number>;
  /** "We love the king" days, and the luxury it demands. */
  wltkd?: number;
  demand?: string;
}

export interface Diplomacy {
  /** At war with each player (by index). */
  war: boolean[];
  /** Turns of peace treaty left (no declaring war). */
  peaceTurns: number[];
  /** Open borders given to each (turns left). */
  openBorders: number[];
  /** Embassies held in each civ's capital. */
  embassy: boolean[];
  /** Research agreements running (turns left). */
  research: number[];
  /** Declarations of friendship (turns left). */
  friends: number[];
  /** Denounced (turns left). */
  denounced: number[];
  /** Defensive pacts (turns left). */
  pacts: number[];
}

export interface Player {
  index: number;
  /** The platform player they are (null for a bot or a city-state). */
  user: string | null;
  name: string;
  civ: string;
  bot: boolean;
  /** A city-state (not a full civilization). */
  /** A city-state: its kind, its character, what it asks of the civs that have met it (`quests.ts`), and the turn it last paid tribute (`citystates.ts`). */
  cityState?: { kind: 'maritime' | 'cultured' | 'militaristic' | 'mercantile' | 'religious'; personality: string; quests?: Quest[]; tributeAt?: number };
  /** Their team, by number from 0 (`teams.ts`): none, they play for themselves. */
  team?: number;
  alive: boolean;
  /** Has said they're done this turn. */
  ready: boolean;
  gold: number;
  techs: string[];
  /** Science put into each tech so far, and what's being researched (with what comes after). */
  research: Record<string, number>;
  researching: string | null;
  techQueue: string[];
  /** Who chose what's being researched (on a team, which of them: `shareResearch`). */
  researchBy?: number;
  /** The achievements their person has been given in this game (the server's), not given again when they come back. */
  awarded?: string[];
  /** Culture toward the next policy, and the policies (and ideology tenets) adopted, and on which turn. */
  culture: number;
  policies: string[];
  policyTurns?: Record<string, number>;
  ideology?: string;
  /** Turns of anarchy left (a revolution: no gold, science, culture or faith), and tenets of a new ideology to be taken without culture. */
  anarchy?: number;
  freeTenets?: number;
  /** Free buildings still to come in newly founded cities (Legalism's Monuments...), by building. */
  freeBuildings?: Record<string, number>;
  /** Free great people of their choice still to be chosen (Liberty finished, Hero of the People). */
  greatChoices?: number;
  faith: number;
  pantheon?: string;
  religion?: string;
  /** Golden age points banked, turns of golden age left, how many there have been. */
  goldenPoints: number;
  goldenTurns: number;
  goldenAges: number;
  /** Great person points by kind, and how many of each have been born (the next costs more). */
  greatPoints: Partial<Record<GreatKind, number>>;
  greatCount: Partial<Record<GreatKind, number>>;
  /** Great people bought with faith so far (each costs half again as much as the first). */
  faithGreat?: number;
  /** Tiles they've seen (1) or not (0), and how many of their units and cities see each now. */
  explored: number[];
  visible: number[];
  /** The players they've met (seen a unit or the land of), by index: once met, always met. */
  met?: number[];
  diplomacy: Diplomacy;
  /** Influence with each city-state (by index). */
  influence: Record<number, number>;
  /** Score parts kept as they happen (wonders, techs, future techs). */
  futureTechs: number;
  /** Their spaceship's parts in place. */
  spaceship: string[];
  /** Tourism they've put into each civ, for the culture victory. */
  tourism: Record<number, number>;
  /** Total culture ever (for the culture victory's influence). */
  lifetimeCulture: number;
  /** What to tell them at the start of their turn (cleared once sent). */
  notes: Note[];
  /** The ruins they've had, for a fair spread of rewards. */
  ruins: number;
  /** Trade routes running, spies, and their vote in the United Nations (`trade.ts`). */
  routes?: { from: number; to: number; turns: number; sea: boolean }[];
  spies?: { id: number; city: number | null; progress: number; watch?: number; diplomat?: boolean; told?: number }[];
  vote?: number;
  /** Units' upkeep paid last turn, for the top bar. */
  lastIncome?: { gold: number; science: number; culture: number; faith: number; happiness: number; tourism: number };
  /** How they stood each turn (score, science a turn, land, military strength), for the graphs at the end. */
  stats?: { score: number[]; science: number[]; land: number[]; military: number[] };
  /** A bot's plans, kept from turn to turn, or the jobs of a person's automated units (`ai/memory.ts`). */
  ai?: BotMemory;
}

export interface Note {
  text: string;
  /** A tile to look at, if it's about somewhere. */
  at?: number;
  kind?: 'info' | 'good' | 'bad' | 'war' | 'tech' | 'city' | 'religion' | 'great' | 'wonder' | 'citystate';
  /** News of the world a player may quieten (their settings): others' wonders, city-state quests, the World Congress, religion news, others' wars. Never a choice to make. */
  topic?: NoteTopic;
  /** A reminder of a choice still to make (research, a policy, production...), said each turn it waits: the screens pin those choices themselves. */
  remind?: boolean;
  /** A choice to make in the reader's city at `at` (a city taken: annex, puppet or raze): a click on the note opens it. */
  openCity?: boolean;
}

/** The kinds of news a player may quieten (`Note.topic`). */
export const NOTE_TOPICS = ['wonders', 'quests', 'congress', 'religion', 'wars'] as const;
export type NoteTopic = (typeof NOTE_TOPICS)[number];

export type MapSize = 'duel' | 'small' | 'standard' | 'large';
export type MapType = 'continents' | 'pangaea' | 'archipelago' | 'fractal';
export type Speed = 'quick' | 'standard';

export interface Settings {
  size: MapSize;
  type: MapType;
  speed: Speed;
  /** Seconds a turn lasts at most (0: until everyone's ready). */
  timer: number;
  /** Civilization VI's dynamic turn timer instead: each turn's clock set by how far on the game is and how much there is to move (the server's `dynamicLength`). */
  dynamicTimer?: boolean;
  /** City-states, barbarians, victory types on. */
  cityStates: number;
  barbarians: boolean;
  victories: { domination: boolean; science: boolean; culture: boolean; diplomatic: boolean; score: boolean };
  /** The turn the game ends on, for the score victory. */
  turnLimit: number;
  /** Who gets a head start (`difficulty.ts`); Prince if unset. */
  difficulty?: Difficulty;
  /** The world wraps round east to west, Civ V's (`hex.ts`); unset, it does. */
  wrap?: boolean;
}

export interface Game {
  version: 1;
  seed: number;
  /** The random generator's state (combat, ruins), so a saved game goes on the same way. */
  rng: number;
  turn: number;
  settings: Settings;
  grid: Grid;
  tiles: Tile[];
  players: Player[];
  units: Unit[];
  cities: City[];
  nextId: number;
  /** World wonders built (by id, the player who built it), religions founded (by id, founder). */
  wonders: Record<string, number>;
  /** Natural wonders found (`nature.ts`): by id, where it is and the civs that have found it, the first to find it first. */
  found?: Record<string, { tile: number; by: number[] }>;
  religions: Record<string, { founder: number; holyCity: number; name: string; beliefs: string[] }>;
  /** Deals running, offers waiting for an answer, and what civs have done to each other (`diplomacy.ts`). */
  relations?: Relations;
  /** The World Congress, once founded (`congress.ts`). */
  congress?: Congress;
  /** Great works made (to name new ones). */
  worksMade: number;
  /** Each team's research as last shared among them, by team (`shareResearch`): progress toward each tech. */
  teamResearch?: Record<number, Record<string, number>>;
  /** Over: who won and how. */
  over?: { winner: number; how: 'domination' | 'science' | 'culture' | 'diplomatic' | 'score' | 'time' };
  /** The game's story so far, for the replay at its end (`replay.ts`). */
  replay?: Replay;
  /** When this turn started (game clock seconds, for the timer). */
  turnStarted: number;
  /** When the game began (the server's time, ISO): with its seed, which game it is (a Hall of Fame entry's), the same seed played again another. */
  started?: string;
  /** Pins people have put on the map (the server's, `server.ts`: nothing in the rules looks at them). */
  pins?: MapPin[];
}

/** A pin on the map, Civilization VI's: a tile a player marked with an icon and a short label, for them and their team. */
export interface MapPin {
  id: number;
  owner: number;
  tile: number;
  icon: string;
  label: string;
}

export const SPEEDS: Record<Speed, number> = { quick: 0.67, standard: 1 };
/** A game's turn limit at each speed, Civ V's: 330 turns quick, 500 standard (the lobby sets it as the speed is chosen). */
export const TURN_LIMITS: Record<Speed, number> = { quick: 330, standard: 500 };

/** Map sizes: tiles across and down, and players and city-states they suit. */
export const MAP_SIZES: Record<MapSize, { name: string; width: number; height: number; players: number; cityStates: number }> = {
  duel: { name: 'Duel', width: 26, height: 18, players: 2, cityStates: 2 },
  small: { name: 'Small', width: 34, height: 22, players: 4, cityStates: 4 },
  standard: { name: 'Standard', width: 42, height: 26, players: 6, cityStates: 6 },
  large: { name: 'Large', width: 50, height: 30, players: 8, cityStates: 8 },
};
