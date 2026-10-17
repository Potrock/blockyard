import { cityStrength, damage, die, gain, rangeOf, strength, type CombatResult } from './combat';
import { atWar, cityAt, note, removeUnit, seesUnit } from './core';
import { distance } from './hex';
import { occupants } from './movement';
import type { City, Game, Unit } from './state';
import { isMilitary, UNITS } from './units';

/**
 * Aircraft, Civ V's way (the basics). They live in their civ's cities (six to a city) and aboard its
 * carriers (three to a carrier, carried where it sails), rebase between them (up to twice their
 * range), and strike what's within range instead of moving (no line of sight needed). Before a strike
 * lands the defence may intercept it: the strongest of an enemy fighter on patrol with the target in
 * its range, or an enemy anti-aircraft unit within two tiles of it, fires on the striker first (each
 * once a turn). A striker that comes through takes something from the target's reply (more from a
 * city's guns). A city taken or a carrier sunk loses the aircraft there.
 */

export const CITY_AIRCRAFT = 6;
export const CARRIER_AIRCRAFT = 3;

export const isAircraft = (u: Unit) => UNITS[u.type]?.domain === 'air';

const isCarrier = (u: Unit) => UNITS[u.type]?.class === 'carrier';

/** Where an aircraft of `owner` could be based on a tile (not counting `self`): its city there, a carrier of its there with room, or nowhere (null). */
export function airBase(game: Game, owner: number, t: number, self?: Unit): { carrier?: Unit } | null {
  const city = cityAt(game, t);
  if (city?.owner === owner && game.units.filter((a) => a !== self && a.tile === t && a.owner === owner && isAircraft(a) && a.carrier === undefined).length < CITY_AIRCRAFT) return {};
  const carrier = carrierWithRoom(game, owner, t, self);
  return carrier ? { carrier } : null;
}

/** A carrier of `owner`'s on a tile with room for one more aircraft (not counting `self`). */
const carrierWithRoom = (game: Game, owner: number, t: number, self?: Unit) =>
  game.units.find((c) => c.tile === t && c.owner === owner && isCarrier(c) && game.units.filter((a) => a !== self && a.carrier === c.id).length < CARRIER_AIRCRAFT);

/** How far an aircraft rebases: twice its strike range. */
export const rebaseRange = (u: Unit) => rangeOf(u) * 2;

/** An aircraft flies to another of its civ's cities or carriers (why it can't, if it can't). */
export function rebase(game: Game, u: Unit, to: number): string | null {
  if (u.moves <= 0) return 'It has no moves left this turn';
  if (distance(game.grid, u.tile, to) > rebaseRange(u)) return `Too far: aircraft rebase up to ${rebaseRange(u)} tiles`;
  // (In a port, aboard the carrier there; else to the city or a carrier.)
  const aboard = to === u.tile && u.carrier === undefined ? carrierWithRoom(game, u.owner, to, u) : undefined;
  if (to === u.tile && !aboard) return 'It is based there already';
  const base = aboard ? { carrier: aboard } : airBase(game, u.owner, to, u);
  if (!base) return 'Only to one of your cities (six aircraft) or carriers (three) with room';
  u.tile = to;
  u.carrier = base.carrier?.id;
  u.moves = 0;
  u.stance = undefined;
  return null;
}

/** The strongest interception waiting for a strike on `target`, if any: who, and with what strength. */
function interceptor(game: Game, u: Unit, target: number): { by: Unit; power: number } | null {
  let best: { by: Unit; power: number } | null = null;
  for (const x of game.units) {
    if (x.intercepted === game.turn || !atWar(game, x.owner, u.owner)) continue;
    const type = UNITS[x.type];
    const patrol = type.class === 'fighter' && x.stance === 'alert' && distance(game.grid, x.tile, target) <= rangeOf(x);
    const guns = !!type.abilities?.includes('intercept') && distance(game.grid, x.tile, target) <= 2;
    if (!patrol && !guns) continue;
    const power = patrol ? strength(game, x, 'ranged', u, x.tile) : strength(game, x, 'defend', u, x.tile);
    if (!best || power > best.power) best = { by: x, power };
  }
  return best;
}

/** What an aircraft can strike on a tile: an enemy city, else an enemy unit, that its owner sees (null: nothing). */
export function airTarget(game: Game, u: Unit, target: number): { city?: City; unit?: Unit } | null {
  if (target === u.tile || distance(game.grid, u.tile, target) > rangeOf(u)) return null;
  const p = game.players[u.owner];
  if (!(p?.visible[target] > 0)) return null;
  const city = cityAt(game, target);
  if (city && atWar(game, u.owner, city.owner)) return { city };
  const here = occupants(game, target);
  const unit = [here.military, here.civilian].find((x) => x && atWar(game, u.owner, x.owner) && seesUnit(game, p, x));
  return unit ? { unit } : null;
}

/** An air strike on a tile (null: nothing there to strike, or out of range, or the aircraft has flown this turn). */
export function airStrike(game: Game, u: Unit, target: number): CombatResult | null {
  // (Once a turn, and not after rebasing: a strike takes its move.)
  if (u.moves <= 0 || u.attacked) return null;
  const aim = airTarget(game, u, target);
  if (!aim) return null;
  u.moves = 0;
  u.attacked = true;
  u.stance = undefined;
  // The interception, first.
  let taken = 0;
  const guard = interceptor(game, u, target);
  if (guard) {
    guard.by.intercepted = game.turn;
    // (A bomber is a bigger, slower mark than a fighter.)
    const evade = strength(game, u, 'ranged', guard.by, u.tile) * (UNITS[u.type].class === 'fighter' ? 1 : 0.6);
    taken = damage(game, guard.power, evade);
    u.hp -= taken;
    gain(game, guard.by, 2, u.owner);
    note(game, guard.by.owner, { text: `Your ${UNITS[guard.by.type].name} intercepted ${game.players[u.owner].name}'s ${UNITS[u.type].name}.`, at: guard.by.tile, kind: 'good' });
    note(game, u.owner, { text: `Your ${UNITS[u.type].name} was intercepted by ${game.players[guard.by.owner].name}'s ${UNITS[guard.by.type].name} (${taken} damage).`, at: target, kind: 'bad' });
    if (u.hp <= 0) {
      die(game, u, guard.by);
      return { attacker: u.id, dealt: 0, taken, killed: false, died: true, at: target };
    }
  }
  const a = strength(game, u, 'ranged', aim.city ?? aim.unit!, u.tile);
  let dealt: number;
  let reply = 0;
  let killed = false;
  if (aim.city) {
    const d = cityStrength(game, aim.city);
    dealt = damage(game, a, d);
    aim.city.hp = Math.max(1, aim.city.hp - dealt);
    aim.city.attacked = true;
    reply = Math.round(damage(game, d, a) * 0.5);
  } else {
    const v = aim.unit!;
    const military = isMilitary(UNITS[v.type]);
    const d = military ? strength(game, v, 'defend', u, target) : 1;
    dealt = damage(game, a, d);
    v.hp -= dealt;
    if (military) reply = Math.round(damage(game, d, a) * 0.3);
    killed = v.hp <= 0;
    if (killed) die(game, v, u);
  }
  u.hp -= reply;
  taken += reply;
  gain(game, u, 3, aim.city?.owner ?? aim.unit!.owner);
  const died = u.hp <= 0;
  if (died) die(game, u, null);
  return { attacker: u.id, dealt, taken, killed, died, at: target };
}

/** A carrier's aircraft go where it goes. */
export function carry(game: Game, carrier: Unit) {
  for (const a of game.units) if (a.carrier === carrier.id) a.tile = carrier.tile;
}

/** Aircraft left with no base (their city taken, their carrier sunk) are lost. */
export function strandedAircraft(game: Game) {
  for (const a of game.units.filter(isAircraft)) {
    const based = a.carrier !== undefined ? game.units.some((c) => c.id === a.carrier && c.owner === a.owner) : cityAt(game, a.tile)?.owner === a.owner;
    if (based) continue;
    removeUnit(game, a);
    note(game, a.owner, { text: `Your ${UNITS[a.type].name} was lost with its base.`, at: a.tile, kind: 'bad' });
  }
}
