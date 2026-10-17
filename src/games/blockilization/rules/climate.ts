import { BUILDINGS } from './buildings';
import { citiesOf, cityAt, note, noteAll, unitsOf } from './core';
import { disastersOn, worldRng } from './disasters';
import { assignCitizens } from './economy';
import { distance, neighbours, within } from './hex';
import { canEnter } from './movement';
import type { Game, Player, WorldEvent } from './state';
import { TERRAINS } from './terrain';
import { UNITS } from './units';

/**
 * The climate, Gathering Storm's in small: the coal and oil the world's civilizations burn (each
 * Factory's Coal, each ironclad's, each tank's and aircraft's Oil, every turn they have them) adds
 * up, the world over; past each threshold the sea rises a stage. A rise floods the lowest of the
 * coast (flat land by the sea, flood plains and marsh first), its improvements ruined; the next
 * rise takes what it flooded, the land under the sea for good, and floods more. A city's own tile
 * holds out (its people build up its shore), and natural wonders stand above it all.
 */

/** The fuels that warm the world. */
const FUELS = new Set(['coal', 'oil']);

/** The sea rises at most this many times. */
export const MAX_RISES = 4;

/** Carbon for each rise, for every civilization the world began with (a bigger world burns more before it tells). */
export const RISE_EVERY = 75;

/** The share of the low coast each rise floods. */
const FLOOD_SHARE = 0.1;

/** The carbon a civilization burns a turn: a unit for each Coal or Oil its units and buildings use. */
export function emissions(game: Game, p: Player): number {
  let n = 0;
  for (const u of unitsOf(game, p.index)) if (FUELS.has(UNITS[u.type]?.resource ?? '')) n++;
  for (const c of citiesOf(game, p.index)) for (const b of c.buildings) if (FUELS.has(BUILDINGS[b]?.resource ?? '')) n++;
  return n;
}

/** The civilizations the world began with (not city-states or barbarians). */
const majors = (game: Game) => game.players.filter((p) => !p.cityState && p.civ !== 'barbarian');

/** The carbon, all told, at which the sea rises the `n`th time. */
export const riseAt = (game: Game, n: number) => n * RISE_EVERY * Math.max(1, majors(game).length);

/** Land the sea could flood: flat, by the open sea (not a lake), not a city's own tile, a natural wonder's or a volcano's. */
function lowCoast(game: Game, t: number): boolean {
  const tile = game.tiles[t];
  if (TERRAINS[tile.terrain].water || tile.elevation !== 'flat' || tile.wonder || tile.volcano || tile.feature === 'ice' || cityAt(game, t)) return false;
  return neighbours(game.grid, t).some((n) => game.tiles[n].terrain === 'coast' || game.tiles[n].terrain === 'ocean');
}

/**
 * A tile gone under the sea: shallow coast from now on (still its city's, to work as water), with
 * nothing of the land left on it. The land units on it go to the nearest dry land they may stand on
 * (or, with none near, take to the water).
 */
export function submerge(game: Game, t: number) {
  const tile = game.tiles[t];
  tile.terrain = 'coast';
  tile.elevation = 'flat';
  tile.height = 0;
  for (const k of ['feature', 'resource', 'amount', 'river', 'improvement', 'pillaged', 'road', 'ruin', 'camp', 'antiquity', 'hiddenAntiquity', 'soil', 'flooded'] as const) delete tile[k];
  for (const u of game.units.filter((x) => x.tile === t)) {
    if (UNITS[u.type]?.domain !== 'land' || u.embarked) continue;
    const dry = within(game.grid, t, 3)
      .filter((n) => n !== t && !TERRAINS[game.tiles[n].terrain].water && canEnter(game, u, n))
      .sort((a, b) => distance(game.grid, t, a) - distance(game.grid, t, b) || a - b)[0];
    u.path = undefined;
    u.work = undefined;
    u.stance = undefined;
    u.fortified = 0;
    if (dry !== undefined) u.tile = dry;
    else u.embarked = true;
  }
}

/**
 * The sea rises a stage: what it flooded last time goes under, and a share of the low coast left
 * (the lowest first: flood plains and marsh, then as the sea finds it) floods, its improvements ruined.
 */
export function riseSea(game: Game): WorldEvent {
  const rng = worldRng(game, 1);
  // (A city founded on flooded land since holds it: its people build up the shore.)
  for (const c of game.cities) delete game.tiles[c.tile].flooded;
  const drowned = game.tiles.flatMap((tile, t) => (tile.flooded ? [t] : []));
  for (const t of drowned) submerge(game, t);
  const low = game.tiles
    .flatMap((tile, t) => (lowCoast(game, t) ? [{ t, key: rng.next() - (tile.feature === 'floodplains' || tile.feature === 'marsh' ? 1 : 0) }] : []))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.t);
  const flooded = low.slice(0, Math.ceil(low.length * FLOOD_SHARE));
  for (const t of flooded) {
    const tile = game.tiles[t];
    tile.flooded = true;
    if (tile.improvement || tile.road) tile.pillaged = true;
  }
  const rises = game.climate?.rises ?? 0;
  const lost = new Map<number, number>();
  for (const t of drowned) if (game.tiles[t].owner >= 0) lost.set(game.tiles[t].owner, (lost.get(game.tiles[t].owner) ?? 0) + 1);
  const wet = new Map<number, number>();
  for (const t of flooded) if (game.tiles[t].owner >= 0) wet.set(game.tiles[t].owner, (wet.get(game.tiles[t].owner) ?? 0) + 1);
  noteAll(game, (reader) => {
    const gone = lost.get(reader.index);
    const under = wet.get(reader.index);
    const yours = [gone && `${gone} of your tiles ${gone === 1 ? 'is' : 'are'} lost under it`, under && `${under} more ${under === 1 ? 'is' : 'are'} flooded, and will be lost if it rises again`].filter(Boolean).join('; ');
    return { text: `The burning of coal and oil has warmed the world, and the sea has risen (${rises} of ${MAX_RISES})${yours ? `: ${yours}.` : '.'}`, at: drowned.find((t) => game.tiles[t].owner === reader.index) ?? flooded.find((t) => game.tiles[t].owner === reader.index), kind: yours ? 'bad' : 'info', topic: 'disasters' };
  });
  for (const c of game.cities) if ([...drowned, ...flooded].some((t) => distance(game.grid, c.tile, t) <= 3)) assignCitizens(game, c);
  // (A unit that took to the water with nowhere dry to go is told so.)
  for (const u of game.units) if (u.embarked && drowned.includes(u.tile) && UNITS[u.type]?.domain === 'land') note(game, u.owner, { text: `The sea has risen round your ${UNITS[u.type].name}: it has taken to the water.`, at: u.tile, kind: 'bad' });
  return { kind: 'sea', tile: drowned[0] ?? flooded[0] ?? -1, tiles: [...drowned, ...flooded] };
}

/** The climate's turn: the world's carbon added up, and the sea risen if it's passed the next threshold. */
export function climateTurn(game: Game): WorldEvent[] {
  if (!disastersOn(game)) return [];
  let burnt = 0;
  for (const p of majors(game)) if (p.alive) burnt += emissions(game, p);
  if (!burnt) return [];
  const climate = (game.climate ??= { co2: 0, rises: 0 });
  climate.co2 += burnt;
  if (climate.rises >= MAX_RISES || climate.co2 < riseAt(game, climate.rises + 1)) return [];
  climate.rises++;
  return [riseSea(game)];
}
