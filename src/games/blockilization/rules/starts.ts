import { unitFor } from './civs';
import { MAP_SIZES, TURN_CHOICES, TURN_LIMITS, type MapSize, type MapType, type Settings, type Speed } from './state';
import { ERAS, ERA_NAMES, pathTo, TECH_LIST } from './techs';
import { UNIT_LIST, UNITS, type UnitClass } from './units';

/**
 * A game begun in a later era (Civilization V's advanced start), and the scenarios: games set up at
 * once with a twist of their own.
 *
 * Begun in a later era, each civ knows every tech of the eras before it and starts with what a civ
 * of that age would have: more Settlers, Workers, an army of the age's best units, gold, culture
 * toward its first policies; and every city it founds starts bigger, with the age's everyday
 * buildings standing (Civ V's free population and free start-era buildings). The calendar starts in
 * the era's own years, and the game's turns are fewer (as Civ V's later starts begin partway through).
 */

/** What a part of a starting army is: foot soldiers, archers or guns, horse or armour, siege, scouts, warships. */
export type Role = 'foot' | 'ranged' | 'mounted' | 'siege' | 'recon' | 'navy' | 'warship';

const ROLE_CLASSES: Record<Role, UnitClass[]> = {
  foot: ['melee', 'gun'],
  ranged: ['ranged'],
  mounted: ['mounted', 'armor'],
  siege: ['siege'],
  recon: ['recon'],
  navy: ['naval_melee'],
  warship: ['naval_ranged'],
};

export interface EraStart {
  settlers: number;
  workers: number;
  /** The army, by role: each the best unit of its kind the civ can field (its own unique one, if it has it). */
  army: [Role, number][];
  /** Gold in the treasury (at Standard speed; the game's speed scales it). */
  gold: number;
  /** Culture banked as the capital's founded: enough for this many policies. */
  policies: number;
  /** Citizens each city is founded with beyond its first, all game. */
  pop: number;
  /** Buildings each city is founded with, all game (as far as its civ's techs and its site allow; a civ's own version where it has one). */
  buildings: string[];
  /** The calendar's turn this start begins on (`year()`: 1000 BC for the Classical Era, 1950 AD for the Atomic). */
  calendar: number;
  /** The share of a game's usual turns (`TURN_LIMITS`) left to play from it. */
  left: number;
}

const ANCIENT_BUILDINGS: string[] = [];
const CLASSICAL_BUILDINGS = ['monument'];
const MEDIEVAL_BUILDINGS = [...CLASSICAL_BUILDINGS, 'shrine', 'granary'];
const RENAISSANCE_BUILDINGS = [...MEDIEVAL_BUILDINGS, 'library', 'walls'];
const INDUSTRIAL_BUILDINGS = [...RENAISSANCE_BUILDINGS, 'market', 'temple'];
const MODERN_BUILDINGS = [...INDUSTRIAL_BUILDINGS, 'aqueduct', 'amphitheater'];
const ATOMIC_BUILDINGS = [...MODERN_BUILDINGS, 'workshop'];

/** Each era's start, by era (`ERAS`): the Ancient Era's is Civ V's own, a Settler and a Warrior. The Information Era is too late to begin in. */
export const ERA_STARTS: EraStart[] = [
  { settlers: 1, workers: 0, army: [['foot', 1]], gold: 0, policies: 0, pop: 0, buildings: ANCIENT_BUILDINGS, calendar: 0, left: 1 },
  { settlers: 1, workers: 1, army: [['foot', 2], ['ranged', 1], ['recon', 1]], gold: 50, policies: 0, pop: 0, buildings: CLASSICAL_BUILDINGS, calendar: 75, left: 0.85 },
  { settlers: 2, workers: 1, army: [['foot', 2], ['ranged', 1], ['mounted', 1], ['recon', 1]], gold: 100, policies: 1, pop: 1, buildings: MEDIEVAL_BUILDINGS, calendar: 135, left: 0.75 },
  { settlers: 2, workers: 2, army: [['foot', 2], ['ranged', 1], ['mounted', 1], ['siege', 1], ['recon', 1]], gold: 200, policies: 2, pop: 1, buildings: RENAISSANCE_BUILDINGS, calendar: 200, left: 0.65 },
  { settlers: 3, workers: 2, army: [['foot', 3], ['ranged', 1], ['mounted', 1], ['siege', 1], ['recon', 1]], gold: 300, policies: 3, pop: 2, buildings: INDUSTRIAL_BUILDINGS, calendar: 260, left: 0.55 },
  { settlers: 3, workers: 3, army: [['foot', 3], ['ranged', 2], ['mounted', 1], ['siege', 1], ['recon', 1]], gold: 400, policies: 4, pop: 2, buildings: MODERN_BUILDINGS, calendar: 285, left: 0.5 },
  { settlers: 3, workers: 3, army: [['foot', 4], ['ranged', 2], ['mounted', 2], ['siege', 1], ['recon', 1]], gold: 500, policies: 5, pop: 3, buildings: ATOMIC_BUILDINGS, calendar: 299, left: 0.45 },
];

/** The latest era a game can begin in (the Atomic). */
export const LAST_START = ERA_STARTS.length - 1;

/** A game's starting era (0: Ancient), as its settings have it (none before there were later starts). */
export const startEraOf = (s: Pick<Settings, 'startEra'>) => Math.max(0, Math.min(LAST_START, Math.floor(s.startEra ?? 0)));
export const eraStartOf = (s: Pick<Settings, 'startEra'>) => ERA_STARTS[startEraOf(s)];

/** A game's turn as its calendar counts it (`year()`): its own, from its era's start (turn 1 of an Atomic start is the 301st), for what goes by how late in history it is. */
export const calendarTurn = (game: { turn: number; settings: Pick<Settings, 'startEra'> }) => game.turn + eraStartOf(game.settings).calendar;

/** The first column of the tech tree in each era (`eraOfCol`). */
const FIRST_COL = [0, 3, 5, 7, 9, 11, 13, 15];

/** Every tech of the eras before `era`. */
export const techsBefore = (era: number): string[] => TECH_LIST.filter((t) => t.col < FIRST_COL[Math.max(0, Math.min(FIRST_COL.length - 1, era))] && t.id !== 'future_tech').map((t) => t.id);

/** A game's starting techs: the eras' before its own, and its scenario's (with whatever they need first). */
export function startTechs(s: Pick<Settings, 'startEra' | 'scenario'>): string[] {
  const known = new Set(techsBefore(startEraOf(s)));
  for (const id of scenarioOf(s)?.techs ?? []) for (const t of pathTo(known, id)) known.add(t);
  return [...known];
}

/**
 * The best unit of a role a civ can field knowing `techs`: the strongest it can build (not made
 * obsolete), foot soldiers only of those needing no strategic resource (the rest may: a Knight
 * needs Horses), the civ's own unique unit in its place. Null: none (no warship before Sailing).
 */
export function bestUnit(civ: string, techs: readonly string[], role: Role): string | null {
  const known = new Set(techs);
  let best: string | null = null;
  let bestMight = -1;
  for (const u of UNIT_LIST) {
    if (u.unbuildable || u.civ || !ROLE_CLASSES[role].includes(u.class)) continue;
    if ((u.tech && !known.has(u.tech)) || (u.obsolete && known.has(u.obsolete))) continue;
    if (role === 'foot' && u.resource) continue;
    const might = u.strength + (u.ranged ?? 0);
    if (might > bestMight) {
      best = u.id;
      bestMight = might;
    }
  }
  return best && unitFor(civ, best, UNITS);
}

/** Of the turn limits the lobby offers, the nearest to `want`. */
const nearestLimit = (want: number) => TURN_CHOICES.reduce((best, n) => (Math.abs(n - want) < Math.abs(best - want) ? n : best), TURN_CHOICES[0]);

/** The turn limit for a game at a speed begun in an era: its share of the usual turns (`TURN_LIMITS`), to the nearest the lobby offers. */
export const eraTurnLimit = (speed: Speed, era: number) => nearestLimit(TURN_LIMITS[speed] * ERA_STARTS[Math.max(0, Math.min(LAST_START, era))].left);

/** The turn limit a game's settings call for at their speed: its scenario's turns, or its era's share of the usual. */
export function turnLimitFor(s: Pick<Settings, 'speed' | 'startEra' | 'scenario'>): number {
  const sc = scenarioOf(s);
  return sc ? nearestLimit((sc.quickTurns * TURN_LIMITS[s.speed]) / TURN_LIMITS.quick) : eraTurnLimit(s.speed, startEraOf(s));
}

/** A start's name in a few words ("an Atomic Era start"). */
export const eraStartName = (era: number) => ERA_NAMES[ERAS[era]];

// -------------------------------------------------------------------------------------------------
// Scenarios
// -------------------------------------------------------------------------------------------------

export interface Scenario {
  id: string;
  name: string;
  /** Its card in the lobby: a glyph and its colour, a line, and in full. */
  glyph: string;
  color: string;
  sub: string;
  text: string;
  /** What it sets up (the rest stays as the host had it). */
  settings: { startEra: number; size?: MapSize; type?: MapType; speed?: Speed; barbarians?: boolean; cityStates?: number; victories?: Settings['victories'] };
  /** Turns it lasts at Quick speed (more at the slower speeds, as the usual turn limits are). */
  quickTurns: number;
  /** Seats at the table (people and bots), if not the map's. */
  players?: number;
  /** Techs every civ knows besides its era's (and what they need first). */
  techs?: string[];
  /** More army than its era's start gives. */
  army?: [Role, number][];
  /** Buildings in each civ's capital as it's founded, and units that wait there (the Cold War's bombs). */
  capitalBuildings?: string[];
  capitalUnits?: string[];
  /** Every civ at war with every other from the first turn (but its teammates): peace is made, not had. */
  war?: boolean;
  /** What it says to each person on the first turn, after their start's word. */
  brief: string;
}

export const SCENARIO_LIST: Scenario[] = [
  {
    id: 'cold_war',
    name: 'Cold War',
    glyph: 'missile',
    color: '#c8463a',
    sub: 'Atomic Era, the bomb ready',
    text: '1950. Every civ begins in the Atomic Era with the bomb: Nuclear Fission known, the Manhattan Project standing in its capital and two Atomic Bombs ready there, beside an army of the age. Win the race to space, or end it the other way.',
    settings: { startEra: 6, size: 'small', type: 'continents', barbarians: false, victories: { domination: true, science: true, culture: false, diplomatic: true, score: true } },
    quickTurns: 150,
    techs: ['nuclear_fission'],
    brief: 'Your capital will hold the Manhattan Project and two Atomic Bombs as soon as it’s founded.',
    capitalBuildings: ['manhattan_project'],
    capitalUnits: ['atomic_bomb', 'atomic_bomb'],
  },
  {
    id: 'ancient_rivals',
    name: 'Ancient Rivals',
    glyph: 'sword',
    color: '#c8963a',
    sub: '1 v 1, a small shared land',
    text: 'Two civilizations on one small continent from the first turn: no room to hide and no time to waste. Take their capital, or have the better score when 150 turns are up.',
    settings: { startEra: 0, size: 'duel', type: 'pangaea', speed: 'quick', cityStates: 2, barbarians: true, victories: { domination: true, science: false, culture: false, diplomatic: false, score: true } },
    quickTurns: 150,
    players: 2,
    brief: 'One rival shares your land: find them before they find you.',
  },
  {
    id: 'island_kings',
    name: 'Island Kings',
    glyph: 'anchor',
    color: '#3a78c8',
    sub: 'Islands, the age of sail',
    text: 'A world of islands, in the Renaissance: every civ knows Astronomy and begins with a Caravel and a Galleass beside its settlers, and the sea is the only road. Rule the waves.',
    settings: { startEra: 3, size: 'small', type: 'archipelago', barbarians: true, victories: { domination: true, science: true, culture: true, diplomatic: true, score: true } },
    quickTurns: 200,
    techs: ['astronomy'],
    army: [['navy', 1], ['warship', 1]],
    brief: 'Your ships wait off the shore: the sea is the only road.',
  },
  {
    id: 'world_war',
    name: 'World War',
    glyph: 'tank',
    color: '#7f8a3a',
    sub: 'Modern Era, all at war',
    text: '1915, and the world is at war: every civ begins in the Modern Era at war with every other, with twice the army of the age in the field. Peace has to be made, one rival at a time. Only conquest wins, or the best score at the end.',
    settings: { startEra: 5, size: 'standard', type: 'continents', barbarians: false, victories: { domination: true, science: false, culture: false, diplomatic: false, score: true } },
    quickTurns: 150,
    army: [['foot', 3], ['ranged', 2], ['mounted', 1], ['siege', 2]],
    war: true,
    brief: 'You are at war with every other civilization: make peace one rival at a time, or take their capitals.',
  },
];

export const SCENARIOS: Record<string, Scenario> = Object.fromEntries(SCENARIO_LIST.map((s) => [s.id, s]));
export const scenarioOf = (s: Pick<Settings, 'scenario'>): Scenario | undefined => (s.scenario ? SCENARIOS[s.scenario] : undefined);

/**
 * Settings with a scenario set up (the rest as they were): its era, map, ways to win and the rest,
 * and its turns at the settings' speed (or the scenario's own); its map's size only if it has room
 * for the `people` playing.
 */
export function withScenario(s: Settings, sc: Scenario, people = 1): Settings {
  const { size, victories, ...rest } = sc.settings;
  const out: Settings = { ...s, ...rest, scenario: sc.id, victories: { ...(victories ?? s.victories) } };
  if (size && MAP_SIZES[size].players >= people) out.size = size;
  out.turnLimit = turnLimitFor(out);
  return out;
}

/** A game's start in a few words, for its line in the lobby and on the way in: its scenario, or a later era's start (nothing for an Ancient one). */
export function startWords(s: Pick<Settings, 'startEra' | 'scenario'>): string {
  const sc = scenarioOf(s);
  if (sc) return sc.name;
  const era = startEraOf(s);
  return era ? `${eraStartName(era)} start` : '';
}
