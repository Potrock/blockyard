import { cityStrength, damage, die, gain, rangeOf, strength, type CombatResult } from './combat';
import { atWar, cityAt, note, removeUnit, seesUnit } from './core';
import { distance } from './hex';
import { occupants } from './movement';
import { fromPromotions } from './promotions';
import type { City, Game, Unit } from './state';
import { isMilitary, UNITS } from './units';

/**
 * Aircraft, Civ V's way (the basics). They live in their civ's cities (six to a city) and aboard its
 * ships that carry them (`CARGO`: a Carrier's fighters and bombers, a Missile Cruiser's or a Nuclear
 * Submarine's missiles, carried where it sails), rebase between them (up to twice their range), and
 * strike what's within range instead of moving (no line of sight needed). Before a strike lands the
 * defence may intercept it: the strongest of an enemy fighter on patrol with the target in its range,
 * or an enemy anti-aircraft unit within two tiles of it, fires on the striker first (each once a turn).
 * A striker that comes through takes something from the target's reply (more from a city's guns); a
 * Guided Missile is spent in its strike. A city taken or a ship sunk loses the aircraft there.
 */

export const CITY_AIRCRAFT = 6;

/**
 * The ships that carry aircraft, and how many (Civ V's): a Carrier, fighters and bombers (not the
 * Stealth Bomber) and the Atomic Bomb a bomber drops; a Missile Cruiser or a Nuclear Submarine,
 * Guided and Nuclear Missiles.
 */
export const CARGO: Record<string, { room: number; missiles: boolean }> = {
  carrier: { room: 3, missiles: false },
  missile_cruiser: { room: 3, missiles: true },
  nuclear_submarine: { room: 2, missiles: true },
};

export const isAircraft = (u: Unit) => UNITS[u.type]?.domain === 'air';

/** A missile (not the Atomic Bomb: a bomber's load, as `combat.ts` has it). */
const isMissile = (type: string) => UNITS[type]?.class === 'missile' && type !== 'atomic_bomb';

/** Whether a ship of this type carries aircraft of that type (with `aircraft` unknown, whether it carries any). */
export function carries(ship: string, aircraft?: string): boolean {
  const cargo = CARGO[ship];
  if (!cargo) return false;
  if (aircraft === undefined) return true;
  return cargo.missiles ? isMissile(aircraft) : !isMissile(aircraft) && aircraft !== 'stealth_bomber';
}

/** Where an aircraft of `owner` could be based on a tile (not counting `self`): its city there, a ship of its there with room for it, or nowhere (null). */
export function airBase(game: Game, owner: number, t: number, self?: Unit): { carrier?: Unit } | null {
  const city = cityAt(game, t);
  if (city?.owner === owner && game.units.filter((a) => a !== self && a.tile === t && a.owner === owner && isAircraft(a) && a.carrier === undefined).length < CITY_AIRCRAFT) return {};
  const carrier = carrierWithRoom(game, owner, t, self);
  return carrier ? { carrier } : null;
}

/** A ship of `owner`'s on a tile that carries `self`'s kind, with room for one more (not counting `self`). */
const carrierWithRoom = (game: Game, owner: number, t: number, self?: Unit) =>
  game.units.find((c) => c.tile === t && c.owner === owner && carries(c.type, self?.type) && game.units.filter((a) => a !== self && a.carrier === c.id).length < CARGO[c.type].room);

/** How far an aircraft rebases: twice its strike range. */
export const rebaseRange = (u: Unit) => rangeOf(u) * 2;

/**
 * Where an aircraft could be based on a tile it rebases to (null: nowhere). Where it is already, only
 * the other kind of base there: from a city to a ship in its port, or from the ship to the city.
 */
function rebaseSpot(game: Game, u: Unit, to: number): { carrier?: Unit } | null {
  if (to !== u.tile) return airBase(game, u.owner, to, u);
  if (u.carrier === undefined) {
    const ship = carrierWithRoom(game, u.owner, to, u);
    return ship ? { carrier: ship } : null;
  }
  const city = cityAt(game, to);
  return city?.owner === u.owner && game.units.filter((a) => a !== u && a.tile === to && a.owner === u.owner && isAircraft(a) && a.carrier === undefined).length < CITY_AIRCRAFT ? {} : null;
}

/** The tiles an aircraft could rebase to now (its own cities and ships with room for it, in reach), for the screens to show. */
export function rebaseSpots(game: Game, u: Unit): number[] {
  if (!isAircraft(u) || u.moves <= 0) return [];
  const reach = rebaseRange(u);
  const tiles = new Set<number>();
  for (const c of game.cities) if (c.owner === u.owner) tiles.add(c.tile);
  for (const s of game.units) if (s.owner === u.owner && carries(s.type, u.type)) tiles.add(s.tile);
  return [...tiles].filter((t) => distance(game.grid, u.tile, t) <= reach && !!rebaseSpot(game, u, t));
}

/** An aircraft flies to another of its civ's cities or ships (why it can't, if it can't). */
export function rebase(game: Game, u: Unit, to: number): string | null {
  if (u.moves <= 0) return 'It has no moves left this turn';
  if (distance(game.grid, u.tile, to) > rebaseRange(u)) return `Too far: aircraft rebase up to ${rebaseRange(u)} tiles`;
  const base = rebaseSpot(game, u, to);
  if (!base) {
    if (to === u.tile) return 'It is based there already';
    return isMissile(u.type)
      ? 'Only to one of your cities (six aircraft), Missile Cruisers (three missiles) or Nuclear Submarines (two) with room'
      : `Only to one of your cities (six aircraft)${u.type === 'stealth_bomber' ? '' : ' or Carriers (three)'} with room`;
  }
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
    // (Evasion takes some of it off.)
    taken = Math.round(damage(game, guard.power, evade) * (1 - Math.min(100, fromPromotions(u, 'evasion')) / 100));
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
  // A Guided Missile is spent in its strike (it takes no reply, and learns nothing from it).
  if (UNITS[u.type].class === 'missile') {
    removeUnit(game, u);
    return { attacker: u.id, dealt, taken, killed, died: true, at: target };
  }
  u.hp -= reply;
  taken += reply;
  gain(game, u, 3, aim.city?.owner ?? aim.unit!.owner);
  const died = u.hp <= 0;
  if (died) die(game, u, null);
  return { attacker: u.id, dealt, taken, killed, died, at: target };
}

/** A ship's aircraft go where it goes. */
export function carry(game: Game, carrier: Unit) {
  for (const a of game.units) if (a.carrier === carrier.id) a.tile = carrier.tile;
}

/** Aircraft left with no base (their city taken or burnt, their ship sunk) are lost. */
export function strandedAircraft(game: Game) {
  for (const a of game.units.filter(isAircraft)) {
    const based = a.carrier !== undefined ? game.units.some((c) => c.id === a.carrier && c.owner === a.owner) : cityAt(game, a.tile)?.owner === a.owner;
    if (based) continue;
    removeUnit(game, a);
    note(game, a.owner, { text: `Your ${UNITS[a.type].name} was lost with its base.`, at: a.tile, kind: 'bad' });
  }
}
