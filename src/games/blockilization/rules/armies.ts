/**
 * Corps and armies, Civilization VI's: two units of one kind side by side join as a corps (a fleet,
 * at sea), and a corps and a third as an army (an armada). It's one unit on the map, much stronger
 * than either was (Civ VI's +10 and +17 strength, in this game's terms), that still costs what its
 * units did: their upkeep, their strategic resources, its upgrade. Corps come with Military Science,
 * armies with Replaceable Parts. A formation never comes apart again (one that can't be paid for loses
 * a unit at a time).
 */
import { knows, note, removeUnit } from './core';
import { distance } from './hex';
import type { Game, Player, Unit } from './state';
import { isMilitary, UNITS } from './units';

/** The techs for a corps (or fleet) and for an army (or armada). */
export const CORPS_TECH = 'military_science';
export const ARMY_TECH = 'replaceable_parts';
/** Strength, percent, a corps and an army add. */
export const CORPS_BONUS = 75;
export const ARMY_BONUS = 125;

/** How many units a unit is (1, or 2 for a corps, 3 for an army). */
export const sizeOf = (u: { size?: number }) => u.size ?? 1;

/** The strength a formation of this size adds (percent): 0 for a lone unit. */
export const formationBonus = (size: number) => (size >= 3 ? ARMY_BONUS : size === 2 ? CORPS_BONUS : 0);

/** What a formation of this size of this kind of unit is called: Corps or Army on land, Fleet or Armada at sea (null for a lone unit). */
export function formationKind(type: string, size: number): 'Corps' | 'Army' | 'Fleet' | 'Armada' | null {
  if (size < 2) return null;
  const sea = UNITS[type]?.domain === 'sea';
  return size >= 3 ? (sea ? 'Armada' : 'Army') : sea ? 'Fleet' : 'Corps';
}

const PLURAL = { Corps: 'Corps', Army: 'Armies', Fleet: 'Fleets', Armada: 'Armadas' };

/** A name with its article: a Rifleman Corps, an Infantry Army. */
export const article = (name: string) => `${/^[AEIOU]/.test(name) ? 'An' : 'A'} ${name}`;

/** A unit's name, as a formation if it is one: Rifleman, Rifleman Corps, Frigate Armada. */
export function unitName(u: { type: string; size?: number }): string {
  const name = UNITS[u.type]?.name ?? u.type;
  const kind = formationKind(u.type, sizeOf(u));
  return kind ? `${name} ${kind}` : name;
}

/** Whether units of this kind form corps: soldiers and warships (not aircraft, missiles, carriers or anyone who isn't a fighter). */
export function forms(type: string): boolean {
  const t = UNITS[type];
  return !!t && isMilitary(t) && t.domain !== 'air' && !['carrier', 'missile', 'great', 'civilian', 'religious', 'trade'].includes(t.class);
}

/** Whether a civ can form corps of anything yet. */
export const canFormCorps = (p: Player) => knows(p, CORPS_TECH);

/** Why `u` can't take `other` into it now (null: it can). */
export function mergeProblem(game: Game, p: Player, u: Unit, other: Unit | undefined): string | null {
  if (!other || other === u) return 'Choose another unit of yours beside it';
  if (u.owner !== p.index || other.owner !== p.index) return 'Only your own units join together';
  if (!forms(u.type)) return "This kind of unit doesn't form corps";
  if (other.type !== u.type) return `Only units of one kind join together: this is a ${UNITS[u.type].name}, that a ${UNITS[other.type]?.name ?? other.type}`;
  if (u.embarked || other.embarked) return 'Not while either is at sea';
  if (distance(game.grid, u.tile, other.tile) !== 1) return 'The other unit must be beside it';
  if (u.moves <= 0) return 'It needs a move left';
  const size = sizeOf(u) + sizeOf(other);
  if (size > 3) return `${article(formationKind(u.type, 3)!)} is as big as a formation gets`;
  if (size === 2 && !knows(p, CORPS_TECH)) return `${PLURAL[formationKind(u.type, 2)!]} need Military Science`;
  if (size === 3 && !knows(p, ARMY_TECH)) return `${PLURAL[formationKind(u.type, 3)!]} need Replaceable Parts`;
  return null;
}

/** The units of its kind beside `u` (of `pool`: all of them, by default), best first (the healthiest, then the most experienced). */
export function besides(game: Game, u: Unit, pool = game.units): Unit[] {
  return pool
    .filter((o) => o !== u && o.owner === u.owner && o.type === u.type && distance(game.grid, u.tile, o.tile) === 1)
    .sort((a, b) => b.hp * sizeOf(b) - a.hp * sizeOf(a) || b.xp - a.xp || a.id - b.id);
}

/** Those it could take into it now, best first. */
export const partners = (game: Game, p: Player, u: Unit, pool = game.units) => besides(game, u, pool).filter((o) => !mergeProblem(game, p, u, o));

/**
 * `u` takes `other` into it (checked with `mergeProblem`): one unit where `u` stands, as big as both,
 * their hit points shared out, the more experienced one's experience and promotions; it has spent its
 * turn doing it.
 */
export function merge(game: Game, u: Unit, other: Unit) {
  const size = sizeOf(u) + sizeOf(other);
  u.hp = Math.round((u.hp * sizeOf(u) + other.hp * sizeOf(other)) / size);
  const vet = other.xp > u.xp || (other.xp === u.xp && other.promotions.length > u.promotions.length) ? other : u;
  u.xp = vet.xp;
  u.promotions = [...vet.promotions];
  u.name ??= other.name;
  u.size = size;
  u.moves = 0;
  for (const k of ['stance', 'fortified', 'path', 'sighted', 'skip', 'auto', 'work', 'setUp'] as const) delete u[k];
  removeUnit(game, other);
  note(game, u.owner, { text: `${article(unitName(u))} has formed: +${formationBonus(size)}% strength.`, at: u.tile, kind: 'good' });
}

/** A formation that can't be paid for loses one of its units (true), rather than all of them at once. */
export function shrink(u: Unit): boolean {
  if (sizeOf(u) < 2) return false;
  u.size = sizeOf(u) - 1 > 1 ? sizeOf(u) - 1 : undefined;
  return true;
}
