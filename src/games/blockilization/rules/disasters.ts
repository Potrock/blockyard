import { isAircraft } from './air';
import { die } from './combat';
import { cityAt, noteAll, speed } from './core';
import { assignCitizens } from './economy';
import { distance, neighbour, neighbours, within } from './hex';
import { Rng } from './mapgen';
import { naturalWonderOf } from './nature';
import type { Game, Note, Player, Storm, Tile, WorldEvent } from './state';
import { addYields, TERRAINS, type Yields } from './terrain';
import { UNITS } from './units';

/**
 * A living world, Civilization VI's Gathering Storm kept small: the seasons turning, volcanoes that
 * now and then erupt (hurting what's next to them, and leaving the land round them rich with ash),
 * rivers that flood (wrecking the farms on their banks, and leaving silt that feeds them better after),
 * and storms that blow across the sea (battering the ships and the coasts in their way). The rising sea
 * of a world that burns coal and oil is `climate.ts`'s.
 *
 * Its chances are drawn from a stream of random numbers of its own, made afresh each turn from the
 * game's seed and the turn: a saved game goes on as it would have, the same seed has the same
 * disasters, and what the rest of the rules draw (fights, ruins) isn't moved along by them, so a game
 * with disasters off plays exactly as it did before there were any.
 */

// -------------------------------------------------------------------------------------------------
// Seasons
// -------------------------------------------------------------------------------------------------

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];
export const SEASON_NAMES: Record<Season, string> = { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' };
/** Turns a season lasts at standard speed (a year is four of them): fewer at a quicker one, more at a slower. */
export const SEASON_TURNS = 5;

/** Turns a season lasts at a game's speed (`SPEEDS`' factor: 1 standard). */
export const seasonTurns = (pace = 1) => Math.max(1, Math.round(SEASON_TURNS * pace));

/** The season of a turn, at a speed: worked out from the turn alone, so nothing need be kept (the first turns are spring). */
export const seasonAt = (turn: number, pace = 1): Season => SEASONS[Math.floor((Math.max(1, turn) - 1) / seasonTurns(pace)) % SEASONS.length];

/** A game's season now. */
export const seasonOf = (game: Game): Season => seasonAt(game.turn, speed(game));

/** Whether a game has disasters (unset, a game saved before them: it hasn't). */
export const disastersOn = (game: Game) => game.settings.disasters === true;

/** No disasters before this turn: a young civilization has enough to do. */
export const DISASTERS_FROM = 15;

/** The disasters' random numbers for a turn: the same for the same seed and turn, whatever else has been drawn. */
export function worldRng(game: Game, salt = 0): Rng {
  let h = Math.imul(game.seed ^ 0x2c1b3c6d, 0x9e3779b1) ^ Math.imul(game.turn + 1, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  return new Rng((h ^ (h >>> 15)) >>> 0);
}

// -------------------------------------------------------------------------------------------------
// Soil
// -------------------------------------------------------------------------------------------------

/** The most rich soil a tile can have, however many times the ash or the floods come. */
export const SOIL_MAX: Yields = { food: 2, prod: 1 };

/** Rich soil added to a tile (up to `SOIL_MAX`); whether it took any. */
export function enrich(tile: Tile, more: Yields): boolean {
  const soil = addYields(tile.soil ?? {}, more);
  let took = false;
  for (const k of Object.keys(soil) as (keyof Yields)[]) {
    soil[k] = Math.min(SOIL_MAX[k] ?? 0, soil[k] ?? 0);
    if ((soil[k] ?? 0) > (tile.soil?.[k] ?? 0)) took = true;
    if (!soil[k]) delete soil[k];
  }
  if (Object.keys(soil).length) tile.soil = soil;
  return took;
}

/** Land that can take rich soil: not the sea, a mountain, ice or a natural wonder. */
const fertile = (tile: Tile) => !TERRAINS[tile.terrain].water && tile.elevation !== 'mountain' && tile.feature !== 'ice' && !tile.wonder;

// -------------------------------------------------------------------------------------------------
// Volcanoes
// -------------------------------------------------------------------------------------------------

/** A volcano's chance of erupting each turn (at standard speed: about once in two hundred and fifty turns). */
export const ERUPTION_CHANCE = 0.004;

/** Hurt a unit by a disaster (a storm leaves it a little at least: `floor`); gone at none. */
function harm(game: Game, u: Game['units'][number], damage: number, how: string, floor = 0) {
  u.hp = Math.max(Math.min(u.hp, floor), u.hp - damage);
  if (u.hp <= 0) die(game, u, null, how);
}

/** A tile's improvement (and road) wrecked by a disaster, if it has one standing (not a city's); whether it was. */
function wreck(game: Game, t: number): boolean {
  const tile = game.tiles[t];
  if ((!tile.improvement && !tile.road) || tile.pillaged || cityAt(game, t)) return false;
  tile.pillaged = true;
  return true;
}

/** The disaster news, told to each person who knows the place (and worded for those it touched). */
function tell(game: Game, at: number, news: string, touched: Map<number, string[]>, kind: Note['kind'] = 'bad') {
  noteAll(game, (reader: Player) => {
    const own = touched.get(reader.index);
    if (own?.length) return { text: `${news} ${own.join(' ')}`, at, kind, topic: 'disasters' };
    return reader.explored[at] ? { text: news, at, kind: 'info', topic: 'disasters' } : null;
  });
}

/** Say something to a player about what a disaster did to them (said with the news, `tell`). */
const touch = (touched: Map<number, string[]>, p: number, what: string) => {
  if (p < 0) return;
  const list = touched.get(p) ?? [];
  if (!list.includes(what)) list.push(what);
  touched.set(p, list);
};

/**
 * An eruption: the units beside the volcano are hurt (some killed), the cities beside it lose a
 * citizen, the improvements round it are wrecked and the woods burnt, and the land round it is the
 * richer for good for the ash (more food, and often production).
 */
export function erupt(game: Game, v: number, rng: Rng) {
  const touched = new Map<number, string[]>();
  for (const n of neighbours(game.grid, v)) {
    const tile = game.tiles[n];
    for (const u of game.units.filter((x) => x.tile === n && !isAircraft(x))) {
      touch(touched, u.owner, 'Your units nearby have been hurt.');
      harm(game, u, 25 + Math.floor(rng.next() * 30), 'a volcano’s eruption');
    }
    const city = cityAt(game, n);
    if (city && city.pop > 1) {
      city.pop--;
      touch(touched, city.owner, `${city.name} has lost a citizen.`);
    }
    if (rng.chance(0.6) && wreck(game, n)) touch(touched, tile.owner, 'Improvements have been buried in ash.');
    if ((tile.feature === 'forest' || tile.feature === 'jungle') && !city && rng.chance(0.5)) tile.feature = undefined;
    if (fertile(tile) && enrich(tile, rng.chance(0.5) ? { food: 1, prod: 1 } : { food: 1 })) touch(touched, tile.owner, 'The ash will make the land round it rich.');
  }
  tell(game, v, 'A volcano has erupted!', touched);
  for (const c of game.cities) if (distance(game.grid, c.tile, v) <= 4) assignCitizens(game, c);
}

// -------------------------------------------------------------------------------------------------
// River floods
// -------------------------------------------------------------------------------------------------

/** A river flood's chance each turn, the world over (at standard speed), by season: mostly as the snow melts in spring, never in winter. */
export const FLOOD_CHANCE: Record<Season, number> = { spring: 0.04, summer: 0.013, autumn: 0.013, winter: 0 };

/** Land a river can flood: flat river land (flood plains most of all). */
const floodable = (tile: Tile) => !!tile.river && tile.elevation === 'flat' && fertile(tile);

/**
 * A river floods: from a tile on its banks (flood plains likelier), along its flat river land up to two
 * tiles off. The improvements there may be wrecked; the silt it leaves is food there for good (on flood
 * plains always, on other banks often).
 */
export function flood(game: Game, from: number, rng: Rng) {
  const touched = new Map<number, string[]>();
  const reached = [from];
  for (let i = 0; i < reached.length && reached.length < 5; i++)
    for (const n of neighbours(game.grid, reached[i]))
      if (!reached.includes(n) && floodable(game.tiles[n]) && distance(game.grid, from, n) <= 2 && reached.length < 5) reached.push(n);
  for (const t of reached) {
    const tile = game.tiles[t];
    if (rng.chance(0.4) && wreck(game, t)) touch(touched, tile.owner, 'Improvements on its banks have been washed away.');
    if ((tile.feature === 'floodplains' || rng.chance(0.5)) && enrich(tile, { food: 1 })) touch(touched, tile.owner, 'The silt it leaves will feed the land.');
  }
  tell(game, from, 'A river has burst its banks!', touched);
  for (const c of game.cities) if (reached.some((t) => distance(game.grid, c.tile, t) <= 3)) assignCitizens(game, c);
  return reached;
}

// -------------------------------------------------------------------------------------------------
// Storms at sea
// -------------------------------------------------------------------------------------------------

/** A storm's chance of rising each turn (at standard speed), by season: most in summer and autumn. */
export const STORM_CHANCE: Record<Season, number> = { spring: 0.03, summer: 0.06, autumn: 0.07, winter: 0.025 };
/** Storms at once at most, by the map's size (its tiles over this). */
const STORM_ROOM = 400;

/** Sea a storm can blow over: open water without ice (not a lake). */
const stormy = (tile: Tile | undefined) => !!tile && (tile.terrain === 'ocean' || tile.terrain === 'coast') && tile.feature !== 'ice';

/**
 * A storm's turn where it is: the ships and embarked units within a tile of it are battered (a storm
 * doesn't sink them: it leaves them a little), and the coast's improvements and the sea's fishing boats
 * and platforms within that tile may be wrecked.
 */
export function batter(game: Game, s: Storm, rng: Rng) {
  const touched = new Map<number, string[]>();
  for (const t of within(game.grid, s.tile, 1)) {
    const water = TERRAINS[game.tiles[t].terrain].water;
    if (water)
      for (const u of game.units.filter((x) => x.tile === t && !isAircraft(x) && !cityAt(game, t))) {
        const type = UNITS[u.type];
        if (!type || (type.domain !== 'sea' && !u.embarked)) continue;
        touch(touched, u.owner, 'Your ships at sea have been battered.');
        harm(game, u, (u.embarked ? 20 : 12) + Math.floor(rng.next() * 15), 'a storm', 10);
      }
    if (rng.chance(0.25) && wreck(game, t)) touch(touched, game.tiles[t].owner, water ? 'It has wrecked improvements at sea.' : 'It has wrecked improvements on the coast.');
  }
  if (touched.size) tell(game, s.tile, 'A storm has swept in from the sea.', touched);
}

/** A storm blows on a tile (or veers, round the land); false: it's blown itself out on the coast. */
function blow(game: Game, s: Storm, rng: Rng): boolean {
  if (rng.chance(0.3)) s.dir = (s.dir + (rng.chance(0.5) ? 1 : 5)) % 6;
  for (const turn of [0, 1, 5, 2, 4]) {
    const d = (s.dir + turn) % 6;
    const n = neighbour(game.grid, s.tile, d);
    if (n >= 0 && stormy(game.tiles[n])) {
      s.tile = n;
      s.dir = d;
      return true;
    }
  }
  return false;
}

// -------------------------------------------------------------------------------------------------
// The turn
// -------------------------------------------------------------------------------------------------

/**
 * The world's own turn, at the end of everyone's: volcanoes, floods and storms (each now and then),
 * what they did kept in `game.events` for the screens. Nothing with disasters off, or so early on.
 */
export function disasterTurn(game: Game): WorldEvent[] {
  const events: WorldEvent[] = [];
  if (!disastersOn(game)) return events;
  const rng = worldRng(game);
  const season = seasonOf(game);
  // (Storms keep blowing whenever they rose; new disasters only once the game's under way.)
  const storms = game.storms ?? [];
  const born: Storm[] = [];
  if (game.turn >= DISASTERS_FROM) {
    game.tiles.forEach((tile, t) => {
      if (!tile.volcano || !rng.chance(ERUPTION_CHANCE / speed(game))) return;
      erupt(game, t, rng);
      events.push({ kind: 'eruption', tile: t });
    });
    if (rng.chance(FLOOD_CHANCE[season] / speed(game))) {
      const banks = game.tiles.flatMap((tile, t) => (floodable(tile) ? [t] : []));
      // (Flood plains four times as likely as other banks.)
      const weight = (t: number) => (game.tiles[t].feature === 'floodplains' ? 4 : 1);
      let roll = rng.next() * banks.reduce((s, t) => s + weight(t), 0);
      const from = banks.find((t) => (roll -= weight(t)) < 0);
      if (from !== undefined) events.push({ kind: 'flood', tile: from, tiles: flood(game, from, rng) });
    }
    if (storms.length < Math.max(1, Math.round(game.tiles.length / STORM_ROOM)) && rng.chance(STORM_CHANCE[season] / speed(game))) {
      const sea = game.tiles.flatMap((tile, t) => (tile.terrain === 'ocean' && tile.feature !== 'ice' && !naturalWonderOf(tile) ? [t] : []));
      if (sea.length) born.push({ tile: sea[Math.floor(rng.next() * sea.length)], dir: Math.floor(rng.next() * 6), turns: 4 + Math.floor(rng.next() * 4) });
    }
  }
  // Each storm blows on (a new one stays where it rose) and batters what's round it; spent, it's gone.
  game.storms = [...storms.filter((s) => blow(game, s, rng)), ...born].filter((s) => {
    batter(game, s, rng);
    events.push({ kind: 'storm', tile: s.tile, ...(born.includes(s) ? { rose: true } : {}) });
    return --s.turns > 0;
  });
  if (!game.storms.length) delete game.storms;
  return events;
}
