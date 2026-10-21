import type { Modifier } from './rules/combat';
import type { BuildWhat, Order } from './rules/game';
import type { Grid } from './rules/hex';
import type { CombatPreview } from './rules/preview';
import type { Difficulty } from './rules/difficulty';
import type { DealItem } from './rules/diplomacy';
import type { Replay } from './rules/replay';
import type { ChatTo, City, Game, MapPin, MapSize, MapType, Note, Production, Settings, Speed, WorldEvent } from './rules/state';
import { YIELD_KEYS, type Yields } from './rules/terrain';
import type { SavedGame } from './saves';

/**
 * What the server and each screen say to each other (`game.clients.send`, `client.send`): the lobby
 * before a game, the map once it's made, and each player's own view of it (only what their civ can
 * see: the server keeps the rest), their orders, and what came of them.
 */

// ----- Lobby

export interface LobbySeat {
  /** The person's key (their account, or their name), or 'bot:<n>' for a bot. */
  key: string;
  name: string;
  civ: string | null;
  bot: boolean;
  /** Here now (a person who's left keeps their seat in a saved game). */
  here: boolean;
  /** Their team (from 0, up to `TEAMS`), with teams on; none: they play for themselves. */
  team?: number | null;
}

/** How many teams a game can have. */
export const TEAMS = 4;

/** The icons a map pin can have (glyphs), how long its label can be, and how many pins a player can have down at once. */
export const PIN_ICONS = ['golden', 'city', 'war', 'shield', 'target', 'hammer', 'gems', 'peak', 'anchor', 'spy', 'skull', 'info'] as const;
export const PIN_LABEL = 24;
export const MAX_PINS = 40;

/** How many sides a lobby's seats make (each team one, each seat on none one): a game needs two. */
export const lobbySides = (seats: LobbySeat[]) => new Set(seats.map((s, i) => (typeof s.team === 'number' ? s.team : `alone ${i}`))).size;

export interface LobbyView {
  phase: 'lobby' | 'building' | 'playing' | 'over';
  /** Who sets the game up (the first person in), and whether that's this screen. */
  host: string | null;
  you: string;
  seats: LobbySeat[];
  settings: Settings;
  /** Every unfinished game this person has a seat in, wherever it was played, to carry on here: in the lobby only. */
  saves: SavedGame[];
  /** While the world's being built: how far along (0..1). */
  progress?: number;
  /** The map's seed: before a game, the one the host set (null: a new world each game); after it, the game's own; never during one. */
  seed: number | null;
  /** Teams on (each seat's team in `seats`), or every civ for itself. */
  teams: boolean;
}

export type LobbyAction =
  | { a: 'civ'; civ: string }
  | { a: 'settings'; size?: MapSize; type?: MapType; speed?: Speed; timer?: number; dynamicTimer?: boolean; hybridTurns?: boolean; barbarians?: boolean; wrap?: boolean; trueStarts?: boolean; cityStates?: number; turnLimit?: number; difficulty?: Difficulty; disasters?: boolean; startEra?: number }
  /** A scenario set up at once (`rules/starts.ts`), or none (null: the settings as they are, without its twist). */
  | { a: 'scenario'; id: string | null }
  | { a: 'bots'; count: number }
  | { a: 'victories'; victories: Partial<Settings['victories']> }
  | { a: 'seed'; seed: number | null }
  | { a: 'teams'; on: boolean }
  | { a: 'team'; seat: string; team: number | null }
  | { a: 'teamPreset'; preset: TeamPreset }
  | { a: 'start' }
  /** Go to one of your games, at its own address (the server answers `goto`). */
  | { a: 'open'; id: string }
  /** Carry one on here (a platform whose screens can't go to another room). */
  | { a: 'resume'; id: string }
  /** Take one off your list (the others in it play on), for a week to bring back (`keep`). */
  | { a: 'discard'; id: string }
  | { a: 'keep'; id: string }
  /** Take one back to the start of a turn it has a backup of (`SavedGame.backups`), while nobody's playing it. */
  | { a: 'restore'; id: string; turn: number }
  | { a: 'newGame' };

/** Teams set up at once: the people against the bots, each person paired with a bot (then the rest in twos), or every civ for itself. */
export type TeamPreset = 'people' | 'pairs' | 'none';

// ----- The map (sent once a game's made; what the world does to its land after, as `ReshapeWire`)

export interface MapWire {
  grid: Grid;
  /** Per tile: terrain, elevation, feature, river and height, as `T E F R H` packed in short strings, and (where it has any) its marks: a volcano, rich soil, flooded by the sea (`packStatic`). */
  tiles: string[];
}

/** Tiles the world has changed since the map was sent (the sea risen over them, an eruption's or a flood's rich soil), packed as the map's are, by tile. */
export interface ReshapeWire {
  tiles: Record<number, string>;
}

// ----- A player's view

export interface PlayerSummary {
  index: number;
  name: string;
  civ: string;
  alive: boolean;
  bot: boolean;
  /** At war with the viewer. */
  war: boolean;
  /** At war, they've offered the viewer peace (the viewer's offer back makes it). */
  peaceOffered?: boolean;
  /** Met (seen any of their units or land). */
  met: boolean;
  ready: boolean;
  /** A person's seat: whether they're in the room now (away, their turn counts as done). */
  here?: boolean;
  /** Their team, by number from 0 (null: they play for themselves). */
  team?: number | null;
  score: number;
  cities: number;
  peace: number;
  openBorders: boolean;
  /** They've opened their borders to the viewer (whose units may then pass through their land). */
  opensBorders: boolean;
  /** Their era (0: Ancient), as anyone who has met them can tell: how their cities look. */
  era: number;
  /** A city-state: its kind, the viewer's influence and standing with it, and who its ally is (-1: nobody). */
  cityState?: {
    kind: string;
    influence: number;
    standing: 'ally' | 'friend' | 'neutral' | 'war';
    ally: number;
    /** What it asks of the viewer (`at`: the tile to show; `firstOnly`: only the first to do it wins it). Asked, done and over: 'citystate' notes, at its capital. */
    quests: { kind: string; text: string; at: number | null; reward: number; turns: number; firstOnly: boolean; done: boolean }[];
    /** What it gives the viewer now (null: nothing, below friendship), and would as a friend and as an ally. */
    gives: { now: string | null; friend: string; ally: string };
    /** The influence gifts of 100, 250 and 500 gold would buy the viewer. */
    gifts: { gold: number; influence: number }[];
    /** Where the viewer's influence drifts back to: down by `fall` a turn from above it, up by 1 from below. */
    rest: number;
    fall: number;
    /** Tribute the viewer could demand (order `tribute`, take 'gold' or 'worker'): the gold, each choice's influence cost, and why it can't now (null: it can). */
    tribute: { gold: number; cost: { gold: number; worker: number }; why: string | null };
    /** Pledges to protect it (order `pledge`): whether the viewer has pledged, why it can't now (null: it can), how much higher a pledge rests its influence, and the civs pledged to it. */
    pledge: { mine: boolean; why: string | null; rest: number; by: number[] };
  };
  /** The viewer's cultural influence over them (1: influential), and their religion. */
  influence?: number;
  religion?: string | null;
  /** Their army as the demographics measure it (`militaryMight`): for the viewer, and each civilization they've met. */
  army?: number;
  /** A civ the viewer has met: how things stand between them (`Relation`). */
  relation?: Relation;
}

/** How things stand between a civ and the viewer, and what it has to trade. */
export interface Relation {
  /** A bot leader's opinion of the viewer: how it reads, its total and why (none for a person). */
  opinion: { stance: string; total: number; reasons: { text: string; value: number }[] } | null;
  /** Turns left: a declaration of friendship, a defensive pact, a research agreement; their denouncement of the viewer, the viewer's of them. */
  friends: number;
  pact: number;
  research: number;
  denouncedYou: number;
  youDenounced: number;
  /** An embargo the viewer declared on them: the turns before it can be lifted (0: it can be now). */
  youEmbargo?: number;
  /** An embargo they declared on the viewer. */
  embargoYou?: boolean;
  /** Whether trade between them and the viewer is embargoed, by either or by the World Congress. */
  embargoed?: boolean;
  /** The viewer's embassy in their capital, and theirs in the viewer's. */
  embassyThere: boolean;
  embassyHere: boolean;
  /** What they could put into a deal: their gold and gold a turn, luxuries and strategic resources to spare; whether they know Writing and Philosophy. */
  gold: number;
  income: number;
  luxuries: string[];
  strategic: Record<string, number>;
  writing: boolean;
  philosophy: boolean;
  /** What a research agreement with them costs each side (at the later era of the two, as the rules charge it). */
  researchCost: number;
  /** Deals running between them and the viewer. */
  deals: { item: DealItem; turns: number }[];
  /** The civs they're friends with and have denounced (as anyone can tell). */
  friendsWith: number[];
  denouncing: number[];
  /** The civs they're at war with, and have defensive pacts with, among those the viewer has met (the world's politics). */
  atWarWith: number[];
  pactsWith: number[];
}

/** A deal another civ has put to the viewer, waiting for an answer. */
export interface OfferWire {
  id: number;
  from: number;
  items: DealItem[];
  turn: number;
}

/** The server's word on a deal being drawn up, for the deal it was asked about: whether it can be made at all, whether the other side would take it, and what to say. */
export interface DealCheck {
  key: string;
  valid: boolean;
  ok: boolean;
  text: string;
}

/** One unit as a screen sees it. Own units have their moves and paths. */
export interface UnitWire {
  id: number;
  type: string;
  owner: number;
  tile: number;
  hp: number;
  moves?: number;
  /** Its moves a turn as it is now (embarked, with its civ's and promotions' extra moves). */
  maxMoves?: number;
  stance?: string;
  path?: number[];
  work?: { what: string; turns: number };
  xp?: number;
  attacked?: boolean;
  setUp?: boolean;
  /** Told to wait this turn (Skip): not one of the units still wanting orders. */
  skip?: boolean;
  /** Left to itself: improving the land, or exploring (not one of the units wanting orders). */
  auto?: 'work' | 'explore';
  embarked?: boolean;
  /** Own units: promotions taken, how many are due and what's open; a religious unit's faith; where a trade unit can go. */
  promotions?: string[];
  promotionsDue?: number;
  promotionOptions?: string[];
  religion?: string;
  spreads?: number;
  /** A trade unit's: where it could open a route, and what each brings (to one of yours, `home`: the food it would carry, or the production if sent with `cargo: 'prod'`). */
  destinations?: { city: number; name: string; gold: number; science: number; food: number; prod: number; home: boolean }[];
  /** Own units: whether it can pillage where it stands now. */
  pillage?: boolean;
  /** Own military units: their strength defending where they stand, and what changes it. */
  defence?: { strength: number; mods: Modifier[] };
  /** Own units: what they can be upgraded to now, and for how much gold. */
  upgrade?: { to: string; cost: number };
}

/** A city as anyone who sees it does: its banner. */
export interface CityWire {
  id: number;
  name: string;
  owner: number;
  tile: number;
  pop: number;
  hp: number;
  maxHp: number;
  capital: boolean;
  strength: number;
  /** Blockaded from the sea by enemy warships (`blockaded`): its sea tiles and sea trade routes yield nothing, and it heals half as fast. */
  blockaded?: boolean;
  /** Own cities: what's being built, and when it's done; growth. */
  building?: { kind: Production['kind']; id: string; turns: number; progress: number };
  growth?: number;
  food?: number;
  foodNeed?: number;
  yields?: { food: number; prod: number; gold: number; science: number; culture: number; faith: number; surplus: number };
  buildings?: string[];
  /** Own cities: the buildings it was founded with free (a game begun in a later era), which cost no upkeep. */
  free?: string[];
  queue?: Production[];
  /** Own cities: units finished are built again (they go back to the end of the queue). */
  repeat?: boolean;
  worked?: number[];
  locked?: number[];
  focus?: City['focus'];
  /** Annexed from another, its people unhappy at the occupation (not once a Courthouse calms them). */
  occupied?: boolean;
  puppet?: boolean;
  resistance?: number;
  fired?: boolean;
  specialists?: Record<string, number>;
  /** Specialists placed by hand (the governor leaves them). */
  lockedSpecialists?: Record<string, number>;
  borderTurns?: number;
  /** Culture toward its next tile, and what that tile costs. */
  culture?: number;
  cultureNeed?: number;
  /** The religion most of its people follow, and how many follow each (anyone who sees it knows). */
  religion?: string | null;
  followers?: Record<string, number>;
  /** Own cities: the tile its borders take next (null: none left in reach). */
  nextTile?: number | null;
  /** What anyone who sees it can see standing in it: its world wonders (in the order built), and its walls (0: none, 1 walls, 2 a castle, 3 an arsenal or a military base). */
  wonders?: string[];
  walls?: number;
  /** Own cities: being razed (turns left), whether it can be razed, the great works in it. */
  razing?: number;
  canRaze?: boolean;
  /** Own cities: who it could be liberated to (order `cityChoice` 'liberate'), and whether that brings them back to life; absent if it can't be. */
  liberate?: { to: number; name: string; revive: boolean; cityState: boolean };
  works?: Record<string, string[]>;
}

export interface SelfWire {
  index: number;
  civ: string;
  gold: number;
  income: number;
  science: number;
  culture: number;
  culturePerTurn: number;
  policyCost: number;
  faith: number;
  faithPerTurn: number;
  happiness: number;
  /** Where it comes from and where it goes (the base, luxuries, buildings; cities, citizens...). */
  happinessParts: { label: string; value: number }[];
  goldenPoints: number;
  goldenCost: number;
  goldenTurns: number;
  techs: string[];
  researching: string | null;
  /** Science toward research a turn: the viewer's, or (on a team) the whole team's. */
  researchScience: number;
  /** On a team: which of them chose what's researched (null: alone, or nobody yet). */
  researchBy: number | null;
  research: Record<string, number>;
  techQueue: string[];
  techCosts: Record<string, number>;
  policies: string[];
  ideology: string | null;
  /** A revolution the viewer may make now (the ideology its people lean to, the dissent, the tenets that would be free, the turns of anarchy it brings), turns of anarchy left, free tenets to take. */
  ideologySwitch: { to: string; dissent: number; free: number; anarchy: number } | null;
  anarchy: number;
  freeTenets: number;
  /** Whether an ideology can be chosen now, a Reformation belief is waiting to be chosen, and how many free great people. */
  ideologyOpen: boolean;
  reformation: boolean;
  greatChoices: number;
  pantheon: string | null;
  era: number;
  luxuries: string[];
  strategic: Record<string, { have: number; used: number }>;
  /** The natural wonders the viewer has found (by id), and whether they found each first. */
  naturalWonders: { id: string; first: boolean }[];
  blockers: { text: string; at?: number }[];
  pantheonCost: number;
  ready: boolean;
  religion: string | null;
  prophetCost: number;
  /** What faith buys (missionaries, inquisitors, a prophet, faith buildings). */
  faithCosts: Record<string, number>;
  /** Beliefs already taken by anyone, and how many more religions can be founded. */
  takenBeliefs: string[];
  religionsLeft: number;
  greatPoints: Record<string, number>;
  greatCosts: Record<string, number>;
  routes: { from: string; to: string; turns: number; gold: number; science: number; food: number; prod: number; cargo: 'food' | 'prod' | null }[];
  maxRoutes: number;
  /** Spies: where each is, how far toward a theft, or (in a city-state) the turns to the election it rigs. */
  /** Spies: where each is; in a city-state, turns to its election; in a civ's city, turns still watching, the theft's progress and need, or why it can't steal there. */
  spies: { id: number; city: number | null; cityName: string | null; progress: number; election: number | null; watch: number; need: number | null; perTurn: number | null; why: string | null; diplomat: boolean; coup: { chance: number; why: string | null } | null }[];
  spaceship: { id: string; name: string; have: number; count: number; tech: string }[];
  apollo: boolean;
  tourism: number;
  vote: number | null;
  /** What the viewer could put into a deal: luxuries (with copies) and strategic resources to spare, what a research agreement costs, Writing and Philosophy known. */
  trade: { luxuries: Record<string, number>; strategic: Record<string, number>; researchCost: number; writing: boolean; philosophy: boolean; dealTurns: number; embargoTurns: number };
}

export interface View {
  turn: number;
  /** Seconds left on the turn's clock (null: no clock; with people at war, the segment's playing now). */
  timer: number | null;
  /** People at war with each other taking their turns one side at a time: the sides in order, whose segment it is (`rules/turns.ts`). */
  sequence?: { sides: number[][]; at: number };
  /** The bots are playing the turn just begun (what they do comes in the view once they're done). */
  moving?: boolean;
  /** A game with one person in it: the turns kept to go back to (newest first). */
  autosaves?: number[];
  you: number;
  /** Watching (not playing): the whole world, and no empire of one's own (`self` is only a stand-in). */
  spectator: boolean;
  /** Watching because their own civilization (this one, by index) has fallen: the game goes on without it. */
  fallen?: number;
  players: PlayerSummary[];
  self: SelfWire;
  /** Per tile, what this player knows of it (null: never seen): owner, city, improvement, road, resource, visible, ruin, pillaged, natural wonder..., packed. Sent only when it's changed since the screen's last view (`setView` keeps the last). */
  tiles: (string | null)[];
  units: UnitWire[];
  cities: CityWire[];
  notes: Note[];
  over: { winner: number; how: string } | null;
  /** Wonders built, by whom (all know, Civ V's announcements). */
  wonders: Record<string, number>;
  /** Religions founded: name, founder, holy city, beliefs, how many cities follow. */
  religions: { id: string; name: string; founder: number; holyCity: string; beliefs: string[]; cities: number }[];
  /** The game over: each civ's standing turn by turn (for the graphs). */
  history?: { index: number; score: number[]; science: number[]; land: number[]; military: number[] }[];
  /** The game over: its story, for the replay (`rules/replay.ts`). */
  replay?: Replay;
  /** Storms at sea the viewer knows the water of (their tiles), what the world did at the last turn's end where they know the land (eruptions, floods, the sea), and how many times the sea has risen (`rules/disasters.ts`, `rules/climate.ts`). */
  storms?: number[];
  events?: WorldEvent[];
  climate?: { rises: number };
  /** Trade routes running between cities the viewer knows (the tiles of their ends), each plied by its caravan or cargo ship. */
  traffic: { from: number; to: number; sea: boolean; owner: number }[];
  /** Who built the United Nations (null: nobody yet), and the next World Leader vote's turn. */
  un: number | null;
  nextVote: number | null;
  /** How the World Leader vote would go now (delegates by candidate) and how many it takes (null: no diplomatic victory in this game). */
  unVotes: { votes: { candidate: number; votes: number }[]; needed: number } | null;
  /**
   * The World Congress, once founded (null before): its host, the turn of its next session, the
   * delegates of the viewer and of each civ it has met, the total, what the viewer may propose (if
   * it may), the proposals before it (the viewer's vote, and each met civ's expected vote as a
   * forecast), the last session's results, and the resolutions in force.
   */
  congress: {
    host: number;
    next: number;
    delegates: { player: number; delegates: number }[];
    mine: { total: number; base: number; host: number; un: number; cityStates: number; diplomats: number };
    total: number;
    canPropose: boolean;
    /** What may be proposed: each kind (and whether it names a civ or a luxury), the civs and luxuries it may name. Repeals: of those in `active`. */
    proposable: { kind: string; name: string; effect: string; names: 'civ' | 'luxury' | null }[];
    civs: number[];
    luxuries: string[];
    /** Each proposal: what it names (civ, luxury), the viewer's vote, each met civ's expected vote (null: another person's, kept until the session), and the totals as they'd fall now (without those). */
    proposals: { id: number; kind: string; civ: number | null; luxury: string | null; name: string; effect: string; by: number; repeal: boolean; vote: 'yes' | 'no' | 'abstain' | null; forecast: { player: number; vote: 'yes' | 'no' | 'abstain' | null; delegates: number }[]; projected: { yes: number; no: number } }[];
    last: { turn: number; results: { name: string; effect: string; passed: boolean; yes: number; no: number }[] } | null;
    active: { kind: string; name: string; effect: string; civ: number | null; luxury: string | null; since: number }[];
    /**
     * The international projects it has opened (`rules/projects.ts`): what's been put in of the cost,
     * production a turn going in and the turns left at that pace (null: none going in), when it opened
     * and was done (null: under way); each tier's reward; each met civ's share, the most first, with
     * its tier as it stands (or stood), what civs not met have put in, and the viewer's tier.
     */
    projects: { id: string; name: string; cost: number; total: number; perTurn: number; turns: number | null; since: number; done: number | null; rewards: { gold: string; silver: string; bronze: string }; shares: { player: number; put: number; tier: 'gold' | 'silver' | 'bronze' | null }[]; unmet: number; mine: 'gold' | 'silver' | 'bronze' | null }[];
  } | null;
  /** Deals put to the viewer, waiting for an answer; the civs the viewer has a deal waiting with. */
  offers: OfferWire[];
  waiting: number[];
  /** The map pins of the viewer and their team. */
  pins: MapPin[];
}

/**
 * City details for its screen (on asking): what it can build, at what cost and how many turns, and
 * what buying costs; its tiles (yields, who works them, what buying one costs), specialist slots,
 * the tile its borders take next, and where each of its yields comes from.
 */
export interface CityInfo {
  id: number;
  options: { kind: Production['kind']; id: string; cost: number; turns: number; buy: number | null; faith?: number | null }[];
  /** Units it could train but for something missing (Iron for a Swordsman, a citizen to spare for a Settler), and what. */
  held: { id: string; why: string }[];
  /** Buildings it could build but for a strategic resource (Coal for a Factory), and what. */
  heldBuildings: { id: string; why: string }[];
  tiles: { t: number; yields: Record<string, number>; worked: boolean; locked: boolean; buyCost: number | null }[];
  slots: Record<string, number>;
  nextTile: number | null;
  breakdown: Record<string, { label: string; value: number }[]>;
  /** What the advisor would build here next, and why (`advisor.ts`). */
  advice: Advice | null;
  /** What it would make with the governor favouring each focus (its citizens placed as they'd be, hand-placed ones kept): the yields, food to spare and turns to grow (-1: starving, 0: not growing). */
  focuses: { focus: City['focus']; food: number; prod: number; gold: number; science: number; culture: number; faith: number; surplus: number; growth: number }[];
  /** Great person points it makes a turn, by kind (its specialists, buildings and bonuses). */
  greatPeople: Record<string, number>;
  /** The religious pressure on it each turn, by religion (the most first), what each has gathered toward winning a citizen, and what that takes. */
  pressure: { religion: string; perTurn: number; gathered: number }[];
  conversionNeed: number;
}

/** One of the advisor's recommendations: a thing to build (`kind` unit, building, project) or research (`tech`), and why. */
export interface Advice {
  kind: Production['kind'] | 'tech';
  id: string;
  why: string;
}

/**
 * A game in a person's Hall of Fame (Civilization V's), kept in their store as it ends for them (won,
 * lost or fallen): their civ, the game's map and settings, how it ended, their place and score.
 */
export interface FameEntry {
  /** The game (its seed) and their seat in it: each game is kept once. */
  id: string;
  civ: string;
  map: MapType;
  size: MapSize;
  difficulty: Difficulty;
  speed: Speed;
  /** Won (they or their team); how the game was won (absent: it went on after they fell); who won, if not they. */
  won: boolean;
  how?: NonNullable<Game['over']>['how'];
  winner?: string;
  /** Their civilization fell before the end. */
  fell?: boolean;
  /** Their place among the civilizations (the winners first, then by score), and their score and turn. */
  place: number;
  of: number;
  score: number;
  turn: number;
  /** The day it ended (YYYY-MM-DD), and how many people played. */
  date: string;
  people: number;
}

/** A bot's word on a deal being drawn up, asked at the table (`advisor.ts`): the deal it would take, if any, and what it says. */
export interface DealHelp {
  items: DealItem[] | null;
  text: string;
}

/**
 * The advisor's recommended work for a worker (on asking, while it's selected), Civ V's: the tiles
 * near it worth improving, each with what to build there, what that adds to the tile, and why.
 */
export interface WorkAdvice {
  unit: number;
  tips: { tile: number; what: BuildWhat; gain: Yields; why: string }[];
  /** With no tips: why not (enemies in reach of the land round it, or nothing there to improve). */
  quiet?: string;
}

/** The advisor's research advice (on asking, once a turn): the techs worth heading for. */
export interface ResearchAdvice {
  turn: number;
  techs: Advice[];
}

/** The demographics (on asking): how the viewer's empire measures up against the civilizations they know, and the score race. */
export interface StatsInfo {
  turn: number;
  /** How many civilizations are measured: the viewer and those they've met (Civ V's demographics rank among those known). */
  civs: number;
  /** Each measure: the viewer's value and place, the best (and whose), the average and the worst. */
  rows: { id: DemographicId; you: number; rank: number; best: number; bestBy: number; average: number; worst: number }[];
  /** Score turn by turn: the viewer's, and each civilization's they've met. */
  scores: { index: number; score: number[] }[];
}

export type DemographicId = 'population' | 'land' | 'military' | 'food' | 'production' | 'gold' | 'science' | 'culture';
/** What a combat preview is asked about: a unit's attack, or a city's fire, on a tile. */
/** An attack to preview: a unit's (`from`: the tile it would charge from, next to the target), or a city's. */
export type PreviewAsk = { unit: number; target: number; from?: number } | { city: number; target: number };

export type ClientToServer =
  | { name: 'lobby'; data: LobbyAction }
  | { name: 'order'; data: Order }
  | { name: 'city'; data: { id: number } }
  | { name: 'stats'; data: null }
  | { name: 'advice'; data: null }
  | { name: 'reload'; data: { turn: number } }
  | { name: 'look'; data: { x: number; z: number } }
  | { name: 'preview'; data: PreviewAsk }
  | { name: 'dealCheck'; data: { target: number; items: DealItem[]; key: string } }
  | { name: 'prefs'; data: { muted?: boolean; tips?: boolean; seen?: string[] } }
  | { name: 'pin'; data: { tile: number; icon?: string; label?: string; remove?: boolean } }
  | { name: 'chat'; data: { to?: ChatTo; text?: string; emote?: string; ping?: { tile: number; kind?: string } } }
  | { name: 'workAdvice'; data: { unit: number } }
  | { name: 'dealHelp'; data: { target: number; items: DealItem[]; ask: 'balance' | 'counter'; key: string } }
  | { name: 'exit'; data: null };

/** A combat preview's answer (null: nothing there to attack from here). */
export interface PreviewReply {
  ask: PreviewAsk;
  preview: CombatPreview | null;
}

export interface OrderResult {
  ok: boolean;
  error?: string;
  combat?: FightWire[];
}

/** A fight, for a screen to show: the attacking unit, the tile struck, the damage each side took, whether either fell, whether a city was taken. */
export interface FightWire {
  attacker: number;
  at: number;
  dealt: number;
  taken: number;
  killed: boolean;
  died: boolean;
  captured?: boolean;
}

// ----- Packing tiles

const TERRAIN_CODES = ['grassland', 'plains', 'desert', 'tundra', 'snow', 'coast', 'ocean', 'lake'] as const;
const ELEVATION_CODES = ['flat', 'hills', 'mountain'] as const;
const FEATURE_CODES = ['', 'forest', 'jungle', 'marsh', 'oasis', 'floodplains', 'ice', 'atoll', 'fallout'] as const;

/** A tile's marks, a bit each (a sixth character, left off when it has none): a volcano, rich soil, flooded by the sea. */
const VOLCANO = 1;
const SOIL = 2;
const FLOODED = 4;

export const packStatic = (t: { terrain: string; elevation: string; feature?: string; river?: boolean; height: number; volcano?: boolean; soil?: object; flooded?: boolean }) => {
  const marks = (t.volcano ? VOLCANO : 0) | (t.soil ? SOIL : 0) | (t.flooded ? FLOODED : 0);
  return `${TERRAIN_CODES.indexOf(t.terrain as never)}${ELEVATION_CODES.indexOf(t.elevation as never)}${FEATURE_CODES.indexOf((t.feature ?? '') as never)}${t.river ? 1 : 0}${String.fromCharCode(48 + Math.min(40, t.height))}${marks ? String.fromCharCode(48 + marks) : ''}`;
};

export function unpackStatic(s: string) {
  const marks = s.length > 5 ? s.charCodeAt(5) - 48 : 0;
  return {
    terrain: TERRAIN_CODES[+s[0]],
    elevation: ELEVATION_CODES[+s[1]],
    feature: (FEATURE_CODES[+s[2]] || undefined) as (typeof FEATURE_CODES)[number] | undefined,
    river: s[3] === '1',
    height: s.charCodeAt(4) - 48,
    volcano: !!(marks & VOLCANO),
    soil: !!(marks & SOIL),
    flooded: !!(marks & FLOODED),
  };
}

/** A tile as a player knows it: `owner|city|improvement|road|resource|visible|ruin|pillaged|camp|feature|antiquity|wonder`. */
export interface KnownTile {
  owner: number;
  city: number;
  improvement: string;
  road: string;
  resource: string;
  visible: boolean;
  ruin: boolean;
  pillaged: boolean;
  /** A barbarian camp (as last seen). */
  camp: boolean;
  /** Its feature now (forests are cut, cities clear their ground): '' for none. */
  feature: string;
  /** An antiquity site (for archaeologists), if the player can tell. */
  antiquity: boolean;
  /** A natural wonder (its id, `rules/nature.ts`): '' for none. */
  wonder: string;
}

export const packKnown = (k: KnownTile) => `${k.owner}|${k.city}|${k.improvement}|${k.road}|${k.resource}|${k.visible ? 1 : 0}|${k.ruin ? 1 : 0}|${k.pillaged ? 1 : 0}|${k.camp ? 1 : 0}|${k.feature ? FEATURE_CODES.indexOf(k.feature as never) : ''}|${k.antiquity ? 1 : 0}|${k.wonder}`;
export function unpackKnown(s: string): KnownTile {
  const [owner, city, improvement, road, resource, visible, ruin, pillaged, camp, feature, antiquity, wonder] = s.split('|');
  return { owner: +owner, city: +city, improvement, road, resource, visible: visible === '1', ruin: ruin === '1', pillaged: pillaged === '1', camp: camp === '1', feature: feature ? (FEATURE_CODES[+feature] ?? '') : '', antiquity: antiquity === '1', wonder: wonder ?? '' };
}

// ----- Packing yields (each known tile's, for the yields lens and the tooltip)

/** Each tile's yields, as one string: per tile its yields (food, production, gold, science, culture, faith) as characters from '0', trailing nothings left off, tiles split by commas. */
export const packYields = (tiles: (Yields | null)[]) => tiles.map((y) => (y ? YIELD_KEYS.map((k) => String.fromCharCode(48 + Math.max(0, Math.min(70, Math.round(y[k] ?? 0))))).join('').replace(/0+$/, '') : '')).join(',');

export function unpackYields(s: string): (Yields | null)[] {
  return s.split(',').map((p) => {
    if (!p) return null;
    const y: Yields = {};
    for (let i = 0; i < p.length; i++) if (p.charCodeAt(i) > 48) y[YIELD_KEYS[i]] = p.charCodeAt(i) - 48;
    return y;
  });
}
