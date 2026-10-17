import { atWar, citiesOf, knowsOf, nameTo, noteAll, spawnUnit, updateAllVisibility } from './core';
import { assignCitizens } from './economy';
import { remember, relationsOf } from './diplomacy';
import { within, distance } from './hex';
import { canEnter } from './movement';
import type { City, Game, Player } from './state';
import { UNIT_LIST } from './units';

/**
 * Liberating cities, Civ V's (Brave New World): a city taken from a civ that hadn't founded it (it
 * was taken from its founder before) may be given back to its founder instead of being annexed,
 * kept as a puppet or razed. Its founder never forgets it (a lasting memory, for the bots'
 * opinions); a city-state given back its city makes its liberator its friend and most likely its
 * ally. A founder that had been destroyed comes back to life with it, Civ V's resurrection: alive
 * again, at peace with its liberator, its relations with the world started afresh. An original
 * capital given back counts again as its founder's for the domination victory (whoever holds every
 * original capital wins: the liberator no longer does).
 */

/** Influence a city-state's liberator gains with it (from at least nothing): enough to make it its ally, as a rule. */
export const LIBERATE_INFLUENCE = 90;

/** Who a city could be liberated to now, and whether that would bring them back to life; null if it can't be. */
export function liberation(game: Game, c: City): { to: number; revive: boolean } | null {
  const founder = game.players[c.founder];
  if (!founder || founder.civ === 'barbarian' || c.takenFrom === undefined) return null;
  // (Only a city taken from someone who hadn't founded it, and not yet annexed: a puppet, as every city taken starts.)
  if (c.founder === c.owner || c.founder === c.takenFrom || !c.puppet || c.razing !== undefined) return null;
  if (founder.alive && atWar(game, c.owner, founder.index)) return null;
  return { to: founder.index, revive: !founder.alive };
}

/** A city given back to its founder by its owner (`cityChoice` 'liberate'). */
export function liberate(game: Game, c: City): string | null {
  const how = liberation(game, c);
  if (!how) return `${c.name} can only be liberated if it was taken from someone who hadn't founded it, and isn't annexed yet`;
  const by = game.players[c.owner];
  const to = game.players[how.to];
  c.owner = to.index;
  c.puppet = undefined;
  c.occupied = undefined;
  c.resistance = 0;
  c.takenFrom = undefined;
  c.queue = [];
  c.locked = [];
  for (const tile of game.tiles) if (tile.city === c.id) tile.owner = to.index;
  for (const w of c.wonders ?? []) game.wonders[w] = to.index;
  // (Its liberator's soldiers step out: it's another's city now, and no one stands in another's city in peace.)
  for (const u of game.units.filter((x) => x.tile === c.tile && x.owner !== to.index)) {
    const out = within(game.grid, c.tile, 3)
      .filter((t) => t !== c.tile && canEnter(game, u, t))
      .sort((a, b) => distance(game.grid, c.tile, a) - distance(game.grid, c.tile, b))[0];
    if (out === undefined) game.units.splice(game.units.indexOf(u), 1);
    else Object.assign(u, { tile: out, path: undefined, stance: undefined, fortified: 0 });
  }
  if (how.revive) revive(game, to, by, c);
  // Its original capital (its first city), or its only one: its seat again.
  const original = game.cities.filter((x) => x.founder === to.index).sort((a, b) => a.id - b.id)[0] === c;
  const seats = citiesOf(game, to.index).filter((x) => x.capital);
  if (original || !seats.length) {
    for (const s of seats) {
      s.capital = undefined;
      s.buildings = s.buildings.filter((b) => b !== 'palace');
    }
    c.capital = true;
    if (!c.buildings.includes('palace')) c.buildings.push('palace');
  }
  if (to.cityState) by.influence[to.index] = Math.max(0, by.influence[to.index] ?? 0) + LIBERATE_INFLUENCE;
  remember(game, 'liberate', by.index, to.index);
  if (!by.met?.includes(to.index)) (by.met ??= []).push(to.index);
  if (!to.met?.includes(by.index)) (to.met ??= []).push(by.index);
  noteAll(game, (r) =>
    r === by
      ? { text: `You have liberated ${c.name}: it is ${to.name}'s again${how.revive ? `, and ${to.name} lives again` : ''}${to.cityState ? ` (+${LIBERATE_INFLUENCE} influence)` : ''}.`, at: c.tile, kind: 'good' }
      : r === to
        ? { text: `${by.name} has liberated ${c.name} and given it back to you${how.revive ? ': your people live again!' : '.'}`, at: c.tile, kind: 'good' }
        : knowsOf(r, by) || knowsOf(r, to)
          ? { text: `${nameTo(r, by, true)} has liberated ${c.name}, giving it back to ${nameTo(r, to)}${how.revive ? `, who live${to.cityState ? 's' : ''} again` : ''}.`, at: r.explored[c.tile] ? c.tile : undefined, kind: 'info', topic: 'wars' }
          : null,
  );
  assignCitizens(game, c);
  updateAllVisibility(game);
  return null;
}

/**
 * A destroyed civ (or city-state) back to life with a city given back (Civ V's resurrection): at war
 * with no one but the barbarians, at peace with its liberator (a treaty), what the world remembered
 * of it forgotten, a soldier to hold the city.
 */
function revive(game: Game, p: Player, by: Player, c: City) {
  p.alive = true;
  p.ready = false;
  p.ai = undefined;
  for (const o of game.players) {
    if (o === p) continue;
    const barbarian = o.civ === 'barbarian';
    p.diplomacy.war[o.index] = o.diplomacy.war[p.index] = barbarian;
    for (const [x, y] of [[p, o], [o, p]]) {
      x.diplomacy.peaceTurns[y.index] = 0;
      x.diplomacy.denounced[y.index] = 0;
      x.diplomacy.friends[y.index] = 0;
      x.diplomacy.pacts[y.index] = 0;
      x.diplomacy.openBorders[y.index] = 0;
    }
    // (A city-state starts afresh with everyone: no one's influence carried from before it fell.)
    if (p.cityState) o.influence[p.index] = 0;
  }
  p.diplomacy.peaceTurns[by.index] = by.diplomacy.peaceTurns[p.index] = 10;
  const rel = relationsOf(game);
  rel.events = rel.events.filter((e) => e.by !== p.index && e.to !== p.index);
  if (p.cityState) {
    p.cityState.quests = [];
    p.cityState.tributeAt = undefined;
    p.cityState.pledges = undefined;
  }
  // A soldier to hold it: the strongest land unit it knows how to build.
  const best = UNIT_LIST.filter((u) => u.domain === 'land' && !u.civ && !u.unbuildable && u.strength > 0 && !u.ranged && (!u.tech || p.techs.includes(u.tech)) && !(u.obsolete && p.techs.includes(u.obsolete)) && !u.resource).sort((a, b) => b.strength - a.strength)[0];
  if (best) spawnUnit(game, best.id, p.index, c.tile);
}
