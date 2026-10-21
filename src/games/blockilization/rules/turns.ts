import { atWar } from './core';
import type { Order } from './game';
import type { Game, Player } from './state';
import { sideOf } from './teams';

/**
 * Hybrid turns, Civilization V's: everyone plays at once, but people at war with each other take
 * their turns one side at a time, so a war isn't a race of clicks. Each turn the people at war with
 * another person are put in order (a side a segment: teammates, and a master and its vassals, play
 * theirs together), the order turning round a place each turn so no one always moves first. The side whose segment it is plays;
 * the others at war wait (their cities, research and diplomacy are theirs meanwhile, not their units).
 * Everyone else, and the bots, play at once as before. A side's segment ends when each of it has
 * ended the turn (or gone); the turn ends when the last segment has, and everyone else is done.
 */

/** Orders that wait for a side's segment: anything a unit does, a city's fire, buying, and war. */
const WAITS = new Set<Order['t']>(['cityFire', 'buy', 'buyTile', 'war', 'ready']);

/** Whether a player is a person still in the game (not a bot, a city-state or the barbarians). */
const person = (p: Player) => p.alive && !p.bot && !p.cityState && p.civ !== 'barbarian';

/** The people at war with another person now. */
export function warringPeople(game: Game): number[] {
  // (Turned off in the lobby: everyone plays at once, war or not.)
  if (game.settings.hybridTurns === false) return [];
  const people = game.players.filter(person);
  return people.filter((p) => people.some((o) => atWar(game, p.index, o.index))).map((p) => p.index);
}

/** The sides those people are on, in the order they play this turn (turned round a place each turn). */
function sidesInOrder(game: Game, warring: number[], first?: number): number[][] {
  const sides: number[][] = [];
  for (const i of warring) {
    if (sides.some((s) => s.includes(i))) continue;
    sides.push(sideOf(game, i).filter((m) => warring.includes(m.index)).map((m) => m.index));
  }
  if (first !== undefined) {
    const at = sides.findIndex((s) => s.includes(first));
    return at < 0 ? sides : [...sides.slice(at), ...sides.slice(0, at)];
  }
  const turn = sides.length ? game.turn % sides.length : 0;
  return [...sides.slice(turn), ...sides.slice(0, turn)];
}

/** A turn begins: the people at war with each other put in order (none: everyone plays at once). */
export function startSequence(game: Game) {
  const warring = warringPeople(game);
  game.sequence = warring.length ? { sides: sidesInOrder(game, warring), at: 0 } : undefined;
  skipFinished(game);
}

/**
 * A war declared during a turn: whoever it puts at war with a person takes their turns in order from
 * now. With no order yet, the side that declared plays on first and the others wait their segment;
 * an order already running has the new sides put at its end.
 */
export function warBegun(game: Game, by: number) {
  const warring = warringPeople(game);
  if (!warring.length) return;
  if (!game.sequence) {
    game.sequence = { sides: sidesInOrder(game, warring, warring.includes(by) ? by : undefined), at: 0 };
    // (Those still to play their segment play it in full: a turn ended before the war isn't theirs to lose.)
    for (const s of game.sequence.sides.slice(1)) for (const i of s) game.players[i].ready = false;
    skipFinished(game);
    return;
  }
  const placed = new Set(game.sequence.sides.flat());
  for (const s of sidesInOrder(game, warring.filter((i) => !placed.has(i)))) {
    game.sequence.sides.push(s);
    for (const i of s) game.players[i].ready = false;
  }
}

/** The side whose segment it is (null: no one's waiting on anyone, or every side has played). */
export function activeSide(game: Game): number[] | null {
  const s = game.sequence;
  return s && s.at < s.sides.length ? s.sides[s.at] : null;
}

/** Whom a player waits on (the side playing its segment), or null: their turn's theirs to play now. */
export function waitingOn(game: Game, i: number): number[] | null {
  const s = game.sequence;
  const active = activeSide(game);
  // (Those whose segment is done wait too: their turn's over, until the next.)
  if (!s || !active || active.includes(i) || !s.sides.some((x) => x.includes(i))) return null;
  return active;
}

/** Why an order waits, or null: it can be given now. */
export function waitsFor(game: Game, by: number, o: Order): string | null {
  if (!('unit' in o) && !('spy' in o) && !WAITS.has(o.t)) return null;
  const on = waitingOn(game, by);
  if (!on) return null;
  const names = on.map((i) => game.players[i].name);
  return `Wait for ${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]} to finish their turn: at war with another person, you take your turns one after the other`;
}

/** Whether every player of the side playing now has ended their turn, or can't (gone from the game, or away: `away`). */
function sideDone(game: Game, side: number[], away: (i: number) => boolean): boolean {
  return side.every((i) => !game.players[i].alive || game.players[i].ready || away(i));
}

/** Past the sides that have nothing to play: those fallen, and those done. */
function skipFinished(game: Game, away: (i: number) => boolean = () => false) {
  const s = game.sequence;
  if (!s) return;
  while (s.at < s.sides.length && sideDone(game, s.sides[s.at], away)) s.at++;
}

/**
 * On to the next side, when the one playing is done (each of it has ended the turn, fallen or gone,
 * by `away`), or when `force`d (its clock run out). Whether it moved on (a new segment's clock starts).
 */
export function advanceSequence(game: Game, away: (i: number) => boolean, force = false): boolean {
  const s = game.sequence;
  const side = activeSide(game);
  if (!s || !side) return false;
  if (!force && !sideDone(game, side, away)) return false;
  // (Their turn's over: as ended, whether they ended it or the clock did.)
  for (const i of side) game.players[i].ready = true;
  s.at++;
  skipFinished(game, away);
  return true;
}

/** Whether every side at war has played its segment (or no one's at war with a person). */
export const sequenceDone = (game: Game) => !activeSide(game);
