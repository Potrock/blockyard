import { BUILDINGS } from './buildings';
import { CITY_STATES, CIVS, unitFor } from './civs';
import { handicapEffects, handicapOf } from './difficulty';
import type { Effects } from './effects';
import { clear, distance, neighbours, ray, within, type Grid, type Ray } from './hex';
import { generate, placeVolcanoes, Rng } from './mapgen';
import { FIRST_FINDER_GOLDEN, FOUND_HAPPINESS, NATURAL_WONDERS, wondersBeside } from './nature';
import { policyEffects } from './policies';
import { fromPromotions } from './promotions';
import { beliefEffects } from './religion';
import { earthSize, MAP_SIZES, SPEEDS, type City, type Game, type Note, type Player, type Settings, type Unit } from './state';
import { bestUnit, eraStartOf, scenarioOf, startEraOf, startTechs } from './starts';
import { RESOURCES, seeFromLevel, seeThroughLevel, TERRAINS } from './terrain';
import { bindTeams, teammates, teamOf } from './teams';
import { baseTechCost, ERA_NAMES, ERAS, TECHS } from './techs';
import { UNITS } from './units';

/**
 * A game's beginning and the lookups the rest of the rules share: who's where, what each civ knows,
 * what each player can see (the fog), the game's random numbers, and the notes each player gets.
 */

export interface Seat {
  user: string | null;
  name: string;
  civ: string;
  bot: boolean;
  /** Their team (`teams.ts`), if they're on one. */
  team?: number;
}

export const emptyDiplomacy = (players: number) => ({
  war: Array(players).fill(false),
  peaceTurns: Array(players).fill(0),
  openBorders: Array(players).fill(0),
  embassy: Array(players).fill(false),
  research: Array(players).fill(0),
  friends: Array(players).fill(0),
  denounced: Array(players).fill(0),
  pacts: Array(players).fill(0),
});

export function newPlayer(index: number, seat: Seat, tiles: number, players: number): Player {
  return {
    index,
    user: seat.user,
    name: seat.name,
    civ: seat.civ,
    bot: seat.bot,
    alive: true,
    ready: false,
    gold: 0,
    techs: [],
    research: {},
    researching: null,
    techQueue: [],
    culture: 0,
    policies: [],
    faith: 0,
    goldenPoints: 0,
    goldenTurns: 0,
    goldenAges: 0,
    greatPoints: {},
    greatCount: {},
    explored: Array(tiles).fill(0),
    visible: Array(tiles).fill(0),
    diplomacy: emptyDiplomacy(players),
    influence: {},
    futureTechs: 0,
    spaceship: [],
    tourism: {},
    lifetimeCulture: 0,
    notes: [],
    ruins: 0,
  };
}

/** How many of the world's city-states a game with barbarians keeps out of it, for barbarian clans to become (`clans.ts`). */
export const CLAN_STATES = 2;

/** A new game: the map made, each seat given a civ's start (a Settler and a Warrior, Civ V's; more begun in a later era, `beginInEra`), the fog drawn. */
export function createGame(settings: Settings, seats: Seat[], seed: number): Game {
  // (The Earth in its own proportions, `earthSize`; a new world wraps round east to west unless the lobby said not.)
  const size = settings.type === 'earth' ? earthSize(settings.size) : MAP_SIZES[settings.size];
  const grid: Grid = { width: size.width, height: size.height, ...(settings.wrap === false ? {} : { wrap: true }) };
  const cityStates = CITY_STATES.slice(0, Math.max(0, Math.min(CITY_STATES.length, settings.cityStates)));
  // (And those kept for the clans: not on the map until one settles, `clans.ts`.)
  const unsettled = settings.barbarians ? CITY_STATES.slice(cityStates.length, cityStates.length + CLAN_STATES) : [];
  // (On the Earth, with true starts, each seat's civ and each city-state's own, to start where it began.)
  // (True starts unless the lobby chose fair ones: the Earth's point.)
  const trueStarts = settings.type === 'earth' && settings.trueStarts !== false ? [...seats.map((s) => s.civ), ...cityStates.map((cs) => cs.civ.id)] : undefined;
  const { tiles, starts } = generate(grid, seed, settings.type, seats.length, cityStates.length, trueStarts);
  // (The volcanoes after the rest, the world as the seed made it before there were any: `disasters.ts`.)
  if (settings.disasters) placeVolcanoes(grid, tiles, seed, starts);
  const game: Game = {
    version: 1,
    seed,
    rng: (seed ^ 0x5bd1e995) >>> 0,
    turn: 1,
    settings,
    grid,
    tiles,
    players: [],
    units: [],
    cities: [],
    nextId: 1,
    wonders: {},
    religions: {},
    worksMade: 0,
    turnStarted: 0,
  };
  // (Begun in a later era, or with a scenario's army: each civ's start is the age's, `beginInEra`.)
  const later = startEraOf(settings) > 0 || !!scenarioOf(settings)?.army;
  // Everyone at the table: the civs, then the city-states (those kept for the clans last), then the barbarians.
  const all: (Seat & { cityState?: (typeof cityStates)[number]; unsettled?: true })[] = [
    ...seats,
    ...cityStates.map((cs) => ({ user: null, name: cs.civ.name, civ: cs.civ.id, bot: true, cityState: cs })),
    ...unsettled.map((cs) => ({ user: null, name: cs.civ.name, civ: cs.civ.id, bot: true, cityState: cs, unsettled: true as const })),
    ...(settings.barbarians ? [{ user: null, name: 'Barbarians', civ: 'barbarian', bot: true }] : []),
  ];
  all.forEach((seat, i) => {
    const p = newPlayer(i, seat, tiles.length, all.length);
    if (seat.cityState) p.cityState = { kind: seat.cityState.kind, personality: 'friendly' };
    else if (seat.team !== undefined && seat.civ !== 'barbarian') p.team = seat.team;
    game.players.push(p);
    if (seat.civ === 'barbarian') return;
    const at = seat.unsettled ? undefined : starts[i];
    if (seat.unsettled) p.unsettled = true;
    if (at === undefined) {
      p.alive = false;
      return;
    }
    // A game begun in a later era: the techs of the eras before (`starts.ts`), city-states' too.
    if (later) p.techs = startTechs(settings);
    if (startEraOf(settings) > 0) p.startEra = startEraOf(settings);
    if (!later) {
      spawnUnit(game, 'settler', i, at);
      const beside = within(grid, at, 1).find((t) => t !== at && canStand(game, 'warrior', t)) ?? at;
      spawnUnit(game, 'warrior', i, beside);
    } else beginInEra(game, p, at);
    // (A person told, on the first turn, how a later era's start or a scenario begins.)
    if (later || scenarioOf(settings)) note(game, i, { text: startNote(settings), kind: 'info' });
    // The difficulty's head start: more units by the first (in a later era, its soldiers the age's).
    for (const type of handicapOf(settings, p).start) {
      const role = type === 'warrior' ? 'foot' : type === 'archer' ? 'ranged' : null;
      const id = (later && role && bestUnit(p.civ, p.techs, role)) || unitFor(p.civ, type, UNITS);
      const free = within(grid, at, 2).find((t) => canStand(game, id, t) && !game.units.some((u) => u.tile === t && (UNITS[u.type].strength > 0) === (UNITS[id].strength > 0)));
      if (free !== undefined) spawnUnit(game, id, i, free);
    }
  });
  // The barbarians are at war with everyone.
  const b = game.players.findIndex((p) => p.civ === 'barbarian');
  if (b >= 0)
    for (const p of game.players) {
      p.diplomacy.war[b] = p.index !== b;
      game.players[b].diplomacy.war[p.index] = p.index !== b;
    }
  // A scenario of total war (World War): every civ at war with every other from the first turn, but its teammates (the city-states stay out of it).
  if (scenarioOf(settings)?.war) {
    const majors = game.players.filter((p) => !p.cityState && p.civ !== 'barbarian');
    for (const p of majors) for (const o of majors) if (p !== o && !teammates(game, p.index, o.index)) p.diplomacy.war[o.index] = true;
  }
  bindTeams(game);
  updateAllVisibility(game);
  return game;
}

/** The first turn's word on a game begun in a later era, or a scenario: where to begin, and its twist. */
function startNote(s: Settings): string {
  const sc = scenarioOf(s);
  const start = eraStartOf(s);
  const era = ERA_NAMES[ERAS[startEraOf(s)]];
  const begin = startEraOf(s) ? ` You begin in ${era.startsWith('Ren') ? 'the Renaissance' : `the ${era}`}: found your cities with your ${start.settlers === 1 ? 'Settler' : `${start.settlers} Settlers`}${start.pop ? `, each begun with ${start.pop + 1} citizens and the buildings of the age` : ''}.` : '';
  return `${sc ? `${sc.name}.` : ''}${begin}${sc ? ` ${sc.brief}` : ''}`.trim();
}

/**
 * A civ's start in a game begun in a later era (`starts.ts`): its era's Settlers (the first on the
 * start), Workers and army (its scenario's too), each the best of its kind the civ can field, round
 * the start, and its gold. A city-state has its Settler and two of the age's soldiers to guard it.
 * (The rest comes as its cities are founded: `foundCity`.)
 */
function beginInEra(game: Game, p: Player, at: number) {
  const start = eraStartOf(game.settings);
  const units = ['settler'];
  if (p.cityState) units.push(...Array<string>(2).fill(bestUnit(p.civ, p.techs, 'foot') ?? 'warrior'));
  else {
    units.push(...Array<string>(start.settlers - 1).fill('settler'), ...Array<string>(start.workers).fill('worker'));
    for (const [role, n] of [...start.army, ...(scenarioOf(game.settings)?.army ?? [])]) {
      const id = bestUnit(p.civ, p.techs, role);
      if (id) units.push(...Array<string>(n).fill(id));
    }
    p.gold = Math.round(start.gold * speed(game));
  }
  // Each on the nearest tile free for it (one soldier and one civilian to a tile; ships on the water), the first Settler on the start.
  const near = within(game.grid, at, 3).sort((a, b) => distance(game.grid, at, a) - distance(game.grid, at, b));
  for (const id of units) {
    const soldier = UNITS[id].strength > 0;
    const t = id === 'settler' && !game.units.some((u) => u.owner === p.index) ? at : near.find((x) => canStand(game, id, x) && !cityAt(game, x) && !game.units.some((u) => u.tile === x && (UNITS[u.type].strength > 0) === soldier));
    if (t !== undefined) spawnUnit(game, id, p.index, t);
  }
}

// -------------------------------------------------------------------------------------------------
// Lookups
// -------------------------------------------------------------------------------------------------

export const unitsAt = (game: Game, t: number) => game.units.filter((u) => u.tile === t);
export const cityAt = (game: Game, t: number): City | undefined => game.cities.find((c) => c.tile === t);
export const cityById = (game: Game, id: number) => game.cities.find((c) => c.id === id);
export const unitById = (game: Game, id: number) => game.units.find((u) => u.id === id);
export const citiesOf = (game: Game, p: number) => game.cities.filter((c) => c.owner === p);
export const unitsOf = (game: Game, p: number) => game.units.filter((u) => u.owner === p);
export const knows = (p: Player, tech: string) => p.techs.includes(tech);
export const capitalOf = (game: Game, p: number) => game.cities.find((c) => c.owner === p && c.capital);
export const speed = (game: Game) => SPEEDS[game.settings.speed];
export const civOf = (p: Player) => CIVS[p.civ];
/** A name with its article, for the notes: a Warrior, an Archer, a University; none for what's plural (Walls, Barracks, Fishing Boats). */
export const aName = (name: string) => (/(Walls|Barracks|Boats|Ironworks)$/.test(name) ? name : `${/^[AEIOU]/i.test(name) && !/^(uni|use|eu|one)/i.test(name) ? 'an' : 'a'} ${name}`);

/** Whether a resource is visible to a player (strategic ones once their tech is known). */
export const seesResource = (p: Player, id: string | undefined) => !!id && (!RESOURCES[id].reveal || knows(p, RESOURCES[id].reveal!));

/** Whether one of a list of effects has a special, by name (every one is asked: none goes unread, `tests/effects-coverage.ts`). */
export const has = (effects: Effects[], special: string) => effects.filter((e) => e.special?.includes(special)).length > 0;

/** Everything that applies to all of a civ's cities: its ability, its policies, its religion's beliefs, its buildings' reach over the empire (`empire`), its difficulty's head start. */
export function empireEffects(game: Game, p: Player): Effects[] {
  const out: Effects[] = [civOf(p).ability.effects, ...policyEffects(p, game), ...beliefEffects(game, p), ...handicapEffects(game, p)];
  for (const c of game.cities) if (c.owner === p.index) for (const b of c.buildings) if (BUILDINGS[b]?.effects.empire) out.push(BUILDINGS[b].effects.empire!);
  return out;
}

/** Everything that belongs to the civ as a whole: the empire's effects, and every building's in every one of its cities. */
export function civEffects(game: Game, p: Player): Effects[] {
  const out = empireEffects(game, p);
  for (const c of game.cities) if (c.owner === p.index) for (const b of c.buildings) if (BUILDINGS[b]) out.push(BUILDINGS[b].effects);
  return out;
}

/** A player gone from the game is at war with no one. */
export function endWars(game: Game, p: number) {
  for (const o of game.players) o.diplomacy.war[p] = game.players[p].diplomacy.war[o.index] = false;
}

/** Whether two players are at war (a city-state or barbarians count by the same table). */
export const atWar = (game: Game, a: number, b: number) => a !== b && (game.players[a]?.diplomacy.war[b] ?? false);

/** The game's random number (0..1), carried in the state so a save goes on the same way. */
export function random(game: Game): number {
  const r = new Rng(game.rng);
  const v = r.next();
  game.rng = r.state;
  return v;
}

export function note(game: Game, p: number, n: Note) {
  const player = game.players[p];
  if (player && !player.bot) player.notes.push(n);
}

/**
 * Tell every person playing: the same note, or one worded for each reader (`n` of the reader; null
 * for a reader it isn't news to, or who hasn't met who it's about).
 */
export function noteAll(game: Game, n: Note | ((reader: Player) => Note | null)) {
  for (const p of game.players) {
    if (p.bot) continue;
    const x = typeof n === 'function' ? n(p) : n;
    if (x) p.notes.push(x);
  }
}

/** Whether a reader knows of a player: is them, or has met them. */
export const knowsOf = (reader: Player, who: Player) => reader === who || !!reader.met?.includes(who.index);

/** A player as the news names them to a reader: by name if met, else as unknown (capitalised to begin a sentence). */
export const nameTo = (reader: Player, who: Player, start = false) => (knowsOf(reader, who) ? who.name : `${start ? 'A' : 'a'} civilization you haven't met`);

// -------------------------------------------------------------------------------------------------
// Units: where they can be, putting them on the map
// -------------------------------------------------------------------------------------------------

/** Whether a unit of this type could stand on a tile at all (terrain, not who's there). */
export function canStand(game: Game, type: string, t: number): boolean {
  const u = UNITS[type];
  const tile = game.tiles[t];
  if (!u || !tile) return false;
  if (tile.elevation === 'mountain' || tile.feature === 'ice') return u.domain === 'air';
  const water = TERRAINS[tile.terrain].water;
  // Ships: at sea, or in a city by the water.
  if (u.domain === 'sea') return water || (!!cityAt(game, t) && neighbours(game.grid, t).some((n) => TERRAINS[game.tiles[n].terrain].water));
  if (u.domain === 'land') return !water;
  return true;
}

export function spawnUnit(game: Game, type: string, owner: number, tile: number, extra: Partial<Unit> = {}): Unit {
  const u: Unit = { id: game.nextId++, type, owner, tile, moves: UNITS[type]?.moves ?? 2, hp: 100, xp: 0, promotions: [], ...extra };
  game.units.push(u);
  return u;
}

export function removeUnit(game: Game, u: Unit) {
  const i = game.units.indexOf(u);
  if (i >= 0) game.units.splice(i, 1);
}

// -------------------------------------------------------------------------------------------------
// Fog of war
// -------------------------------------------------------------------------------------------------

/**
 * The tiles within `radius` of a tile, each with the way a line of sight takes to it: the grid's alone
 * (a map of that size always has the same), so worked out once for each tile and radius.
 */
const viewLines = new Map<string, Map<number, { t: number; way: Ray }[]>>();
function linesOfSight(g: Grid, from: number, radius: number): { t: number; way: Ray }[] {
  const size = `${g.width}x${g.height}${g.wrap ? 'w' : ''}`;
  const lines = viewLines.get(size) ?? new Map<number, { t: number; way: Ray }[]>();
  viewLines.set(size, lines);
  const key = from * 16 + radius;
  let out = lines.get(key);
  if (!out) {
    out = within(g, from, radius).map((t) => ({ t, way: ray(g, from, t) }));
    lines.set(key, out);
  }
  return out;
}

/** Whether `from` sees the end of a ray from it past what's between (`hex.ts`'s `clear`): only what stands higher than `from` blocks (`seeThroughLevel`). */
export function inSight(game: Game, from: number, way: Ray): boolean {
  const eye = seeFromLevel(game.tiles[from]);
  return clear(way, (x) => seeThroughLevel(game.tiles[x]) > eye);
}

/** The tiles a unit or city on `from` sees within `radius` (from higher ground, over more of what blocks). */
export function sight(game: Game, from: number, radius: number): number[] {
  const out: number[] = [];
  for (const { t, way } of linesOfSight(game.grid, from, radius)) if (inSight(game, from, way)) out.push(t);
  return out;
}

/** Each unit's sight (2, Civ V's; more for some units, with promotions, for ships with Exploration and the Great Lighthouse, and beside the Sky Pillar); its owner's effects can be given, worked out once for many units. */
export function unitSight(game: Game, u: Unit, civ = game.players[u.owner] ? civEffects(game, game.players[u.owner]) : []): number {
  const type = UNITS[u.type];
  let s = (type?.sight ?? 2) + fromPromotions(u, 'sight');
  if (type?.abilities?.includes('extra_sight')) s += 1;
  // (Polynesia's Wayfinding: further at sea.)
  if (u.embarked && game.players[u.owner] && civOf(game.players[u.owner]).ability.effects.special?.includes('wayfinding')) s += 1;
  if (type) for (const e of civ) for (const x of e.sight ?? []) if (x.domain === type.domain) s += x.sight;
  for (const w of wondersBeside(game, u.tile)) s += w.sight ?? 0;
  return s;
}

/** A unit's moves at the start of a turn: its type's, more with promotions and effects (Persia's golden ages too); at sea, a land unit's 2 (3 with the Compass). */
export function maxMoves(game: Game, u: Unit): number {
  const type = UNITS[u.type];
  const p = game.players[u.owner];
  if (!type || !p) return 0;
  // (Denmark's Viking Fury: a move more at sea.)
  if (u.embarked) return (knows(p, 'compass') ? 3 : 2) + (civOf(p).ability.effects.special?.includes('viking_fury') ? 1 : 0);
  const civ = civEffects(game, p);
  let moves = type.moves + fromPromotions(u, 'moves');
  for (const e of civ) for (const m of e.moves ?? []) if (m.domain === type.domain && (!m.classes || m.classes.includes(type.class))) moves += m.moves;
  if (p.goldenTurns > 0 && has(civ, 'golden_age_moves_combat')) moves += 1;
  return moves;
}

/** Whether a player sees a unit: on a tile they see (a submarine only from next to it, or from a ship that hunts them within two tiles). */
export function seesUnit(game: Game, p: Player, u: Unit): boolean {
  if (u.owner === p.index) return true;
  if (!(p.visible[u.tile] > 0)) return false;
  if (!UNITS[u.type]?.abilities?.includes('invisible')) return true;
  const near = (t: number, d: number) => distance(game.grid, t, u.tile) <= d;
  return game.units.some((o) => o.owner === p.index && (near(o.tile, 1) || (UNITS[o.type]?.abilities?.includes('see_submarines') && near(o.tile, 2)))) || game.cities.some((c) => c.owner === p.index && near(c.tile, 1));
}

/**
 * Work out what a player sees now, and add it to what they've seen. A team sees together: each of
 * them sees what any of them does (all of them worked out at once, returned).
 */
export function updateVisibility(game: Game, p: Player): Player[] {
  if (!p.alive) {
    p.visible.fill(0);
    return [p];
  }
  const team = teamOf(game, p.index);
  for (const m of team) ownSight(game, m);
  if (team.length > 1) {
    const all = team[0].visible.map((_, t) => team.reduce((n, m) => n + m.visible[t], 0));
    for (const m of team) for (let t = 0; t < all.length; t++) m.visible[t] = all[t];
  }
  for (const m of team) {
    m.visible.forEach((n, t) => n > 0 && (m.explored[t] = 1));
    meetSeen(game, m);
    findWonders(game, m);
  }
  return team;
}

/** What a player's own units and cities see now (how many of them see each tile). */
function ownSight(game: Game, p: Player) {
  // Satellites: the whole map.
  const vis = p.visible.fill(knows(p, 'satellites') ? 1 : 0);
  const civ = civEffects(game, p);
  for (const u of game.units) if (u.owner === p.index) for (const t of sight(game, u.tile, unitSight(game, u, civ))) vis[t]++;
  const cities = new Set<number>();
  for (const c of game.cities)
    if (c.owner === p.index) {
      cities.add(c.id);
      for (const t of sight(game, c.tile, 2)) vis[t]++;
    }
  // Its cities' land, too.
  if (cities.size) game.tiles.forEach((tile, t) => tile.city !== undefined && cities.has(tile.city) && vis[t]++);
}

/** Whoever's units or land a player sees now, they've met, and been met by (contact goes both ways); met stays met once out of sight. */
function meetSeen(game: Game, p: Player) {
  const vis = p.visible;
  const met = (p.met ??= []);
  const meet = (o: number) => {
    if (o < 0 || o === p.index || met.includes(o)) return;
    met.push(o);
    const them = game.players[o];
    if (them && !(them.met ??= []).includes(p.index)) them.met.push(p.index);
  };
  for (const u of game.units) if (vis[u.tile] > 0) meet(u.owner);
  vis.forEach((n, t) => n > 0 && meet(game.tiles[t].owner));
}

/** A name for the middle of a sentence ("the Sky Pillar"). */
export const inSentence = (name: string) => name.replace(/^The /, 'the ');

/** Gold Spain has for finding a natural wonder (before the game's speed; three times as much for the first to find it). */
export const SEVEN_CITIES_GOLD = 100;

/**
 * Natural wonders a civilization has come to know of, however it did (its units' sight, a map from
 * ruins, satellites), found for good: happier for each (`natureHappiness`), and the first civ to find
 * each has golden-age points (and the Gilded Peak's gold). City-states and barbarians find nothing.
 */
function findWonders(game: Game, p: Player) {
  if (p.cityState || p.civ === 'barbarian') return;
  for (let t = 0; t < game.tiles.length; t++) {
    const w = game.tiles[t].wonder && p.explored[t] ? NATURAL_WONDERS[game.tiles[t].wonder!] : undefined;
    if (!w) continue;
    const found = ((game.found ??= {})[w.id] ??= { tile: t, by: [] });
    if (found.by.includes(p.index)) continue;
    found.by.push(p.index);
    // (Spain's Seven Cities of Gold: gold for each, three times as much for the first; and twice the happiness.)
    const spain = civOf(p).ability.effects.special ?? [];
    const cheer = FOUND_HAPPINESS * (spain.includes('natural_wonders_double') ? 2 : 1);
    const treasure = spain.includes('natural_wonder_gold') ? Math.floor(SEVEN_CITIES_GOLD * (found.by.length > 1 ? 1 : 3) * speed(game)) : 0;
    p.gold += treasure;
    if (found.by.length > 1) {
      note(game, p.index, { text: `You have found ${inSentence(w.name)}, a natural wonder: +${cheer} happiness for good${treasure ? ` and ${treasure} gold` : ''}.`, at: t, kind: 'wonder' });
      continue;
    }
    const golden = Math.floor(FIRST_FINDER_GOLDEN * speed(game));
    const gold = Math.floor((w.finderGold ?? 0) * speed(game));
    p.goldenPoints += golden;
    p.gold += gold;
    note(game, p.index, { text: `You are the first to find ${inSentence(w.name)}: +${cheer} happiness for good, ${golden} golden age points${gold + treasure ? ` and ${gold + treasure} gold` : ''}.`, at: t, kind: 'wonder' });
  }
}

export function updateAllVisibility(game: Game) {
  // (A team's worked out once, for all of them.)
  const done = new Set<Player>();
  for (const p of game.players) if (!done.has(p)) for (const m of updateVisibility(game, p)) done.add(m);
}

/** Tech cost for a player: the tech's (`baseTechCost`), at the game's speed, 5% more for each city past the first (Civ V's). */
export function techCost(game: Game, p: Player, id: string): number {
  const t = TECHS[id];
  if (!t) return Infinity;
  // A team researches together (`shareResearch`): its cities all count, and each civ past the first adds half again.
  const team = p.team === undefined ? [p] : teamOf(game, p.index);
  const cities = team.reduce((n, m) => n + citiesOf(game, m.index).length, 0);
  const members = 1 + 0.5 * (team.length - 1);
  return Math.round(baseTechCost(t) * speed(game) * (1 + 0.05 * Math.max(0, cities - 1)) * members * (id === 'future_tech' ? 1 + p.futureTechs * 0.1 : 1));
}
