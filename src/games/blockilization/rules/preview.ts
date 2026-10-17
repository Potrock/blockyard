import { airTarget, isAircraft } from './air';
import { canFire, cityFireStrength, cityMaxHp, cityStrength, damageFor, rangeOf, strength, type Modifier } from './combat';
import { atWar, cityAt } from './core';
import { distance, neighbours } from './hex';
import { occupants } from './movement';
import type { City, Game, Unit } from './state';
import { isMilitary, UNITS } from './units';

/**
 * What an attack would come to, worked out before it's ordered (Civ V's combat preview): each side's
 * strength and what changes it, the damage each would take at the luckiest and unluckiest rolls, and
 * the chance each is destroyed (or the city taken). The same rules as the fight itself (`combat.ts`),
 * without touching the game's random numbers.
 */

/** One side of a fight as the preview tells it. */
export interface PreviewSide {
  /** A unit's type, or a city's id. */
  unit?: string;
  city?: number;
  owner: number;
  strength: number;
  hp: number;
  maxHp: number;
  mods: Modifier[];
  /** Damage it would take, at the least and at the most. */
  damage: [number, number];
  /** The chance it's destroyed (0 to 1). */
  dies: number;
}

export interface CombatPreview {
  attacker: PreviewSide;
  defender: PreviewSide;
  /** A ranged attack (no reply), and a lone civilian taken without a fight. */
  ranged: boolean;
  /** An air strike: the target's reply hurts the striker, and an interception may come first (not counted here). */
  air?: boolean;
  capture?: boolean;
  /** The chance the city falls to this attack. */
  takes?: number;
  /** Why the attack can't be made now, though it would be in reach (a siege unit not set up). */
  blocked?: string;
}

/** The lowest and highest rolls of the damage formula. */
const ROLLS: [number, number] = [24, 36];

/** The chance a hit from `mine` against `theirs` does at least `need` damage (rolls are even between 24 and 36). */
function chanceAtLeast(mine: number, theirs: number, need: number): number {
  if (need <= 1) return 1;
  if (need > 100) return 0;
  const ratio = Math.max(mine, theirs) / Math.min(mine, theirs);
  const factor = (Math.pow((ratio + 3) / 4, 4) + 1) / 2;
  const k = mine >= theirs ? factor : 1 / factor;
  // Rounded damage reaches `need` from this roll up.
  const roll = (need - 0.5) / k;
  return Math.max(0, Math.min(1, (ROLLS[1] - roll) / (ROLLS[1] - ROLLS[0])));
}

const range = (mine: number, theirs: number): [number, number] => [damageFor(mine, theirs, ROLLS[0]), damageFor(mine, theirs, ROLLS[1])];
const round = (n: number) => Math.round(n * 10) / 10;

function unitSide(u: Unit, s: number, mods: Modifier[]): PreviewSide {
  return { unit: u.type, owner: u.owner, strength: round(s), hp: u.hp, maxHp: 100, mods, damage: [0, 0], dies: 0 };
}

/** A city's side of a fight: defending (walls and garrison count), or firing (see `cityFireStrength`). */
function citySide(game: Game, c: City, firing = false): PreviewSide {
  const garrison = occupants(game, c.tile).military;
  const mods: Modifier[] = [];
  if (game.tiles[c.tile].elevation === 'hills') mods.push({ label: 'Hills', percent: 25 });
  const s = firing ? cityFireStrength(game, c) : cityStrength(game, c);
  // A garrison adds to a city's defence, and to its fire only under Oligarchy.
  if (garrison && !firing) mods.push({ label: `Garrison (${UNITS[garrison.type].name})`, percent: 0 });
  else if (garrison && s > cityStrength(game, c, true)) mods.push({ label: 'Garrison (Oligarchy)', percent: 50 });
  return { city: c.id, owner: c.owner, strength: round(s), hp: c.hp, maxHp: cityMaxHp(game, c), mods, damage: [0, 0], dies: 0 };
}

/** Why a unit can't attack this turn, as the attack order would say (undefined: it can). */
function spent(u: Unit): string | undefined {
  const twice = u.promotions.includes('blitz') || u.promotions.includes('logistics');
  if ((u.attacks ?? 0) >= (twice ? 2 : 1)) return 'It has attacked this turn';
  if (u.moves <= 0 && !(twice && UNITS[u.type].ranged && (u.attacks ?? 0) === 1)) return 'No moves left this turn';
  return undefined;
}

/** A unit's attack on a tile, as it would go now, or charged from `from` next to it (null: there's nothing there it could attack). */
export function previewAttack(game: Game, u: Unit, target: number, from?: number): CombatPreview | null {
  // (A charge is fought from the tile it moves to first, out of any fortifying.)
  const preview = previewFight(game, from === undefined ? u : { ...u, tile: from, fortified: 0, stance: undefined }, target);
  const why = preview && spent(u);
  return preview && why ? { ...preview, blocked: why } : preview;
}

/** The fight a unit's attack on a tile would be, whether or not it could attack this turn. */
function previewFight(game: Game, u: Unit, target: number): CombatPreview | null {
  const type = UNITS[u.type];
  if (!type || !isMilitary(type) || type.abilities?.includes('no_attack')) return null;
  const next = neighbours(game.grid, u.tile).includes(target);
  const city = cityAt(game, target);
  const enemyCity = city && atWar(game, u.owner, city.owner) ? city : undefined;
  const here = occupants(game, target);
  const military = here.military && atWar(game, u.owner, here.military.owner) ? here.military : undefined;
  const civilian = here.civilian && atWar(game, u.owner, here.civilian.owner) ? here.civilian : undefined;
  // (Units with a ranged attack always fire, next door too, as the attack order has them: mounted archers as well.)
  const fires = !!type.ranged;
  if (fires) {
    if (!(isAircraft(u) ? airTarget(game, u, target) : canFire(game, u.tile, target, rangeOf(u)))) return null;
    // (A siege unit not set up sets up as it fires, with two moves left: one to set up, one to fire.)
    const blocked = type.abilities?.includes('must_setup') && !u.setUp && u.moves < 2 ? 'Too few moves to set up and fire: set it up now, it fires next turn' : undefined;
    const why: Modifier[] = [];
    // (An aircraft takes a share of the target's reply: `air.ts`.)
    const reply = (att: PreviewSide, d: number, a: number, share: number) => {
      const [low, high] = range(d, a);
      att.damage = [Math.round(low * share), Math.round(high * share)];
      return att;
    };
    if (enemyCity) {
      const a = strength(game, u, 'ranged', enemyCity, u.tile, why);
      const d = citySide(game, enemyCity);
      d.damage = range(a, d.strength);
      // A city is never brought below 1 by fire.
      if (isAircraft(u)) return { attacker: reply(unitSide(u, a, why), d.strength, a, 0.5), defender: d, ranged: true, air: true, blocked };
      return { attacker: unitSide(u, a, why), defender: d, ranged: true, blocked };
    }
    const def = military ?? civilian;
    if (!def) return null;
    const dwhy: Modifier[] = [];
    const a = strength(game, u, 'ranged', def, u.tile, why);
    const d = isMilitary(UNITS[def.type]) ? strength(game, def, 'defend', u, target, dwhy) : 1;
    const side = unitSide(def, d, dwhy);
    side.damage = range(a, d);
    side.dies = chanceAtLeast(a, d, def.hp);
    if (isAircraft(u)) return { attacker: reply(unitSide(u, a, why), d, a, isMilitary(UNITS[def.type]) ? 0.3 : 0), defender: side, ranged: true, air: true, blocked };
    return { attacker: unitSide(u, a, why), defender: side, ranged: true, blocked };
  }
  if (!next) return null;
  const why: Modifier[] = [];
  if (enemyCity) {
    const a = strength(game, u, 'attack', enemyCity, u.tile, why);
    const d = citySide(game, enemyCity);
    const att = unitSide(u, a, why);
    d.damage = range(a, d.strength);
    att.damage = range(d.strength, a);
    att.dies = chanceAtLeast(d.strength, a, u.hp);
    // Barbarians raid cities but never take them; aircraft and helicopters can't either (as `combat.ts` has it). Mounted units and ships can.
    const canTake = game.players[u.owner].civ !== 'barbarian' && type.domain !== 'air' && type.class !== 'helicopter';
    const takes = canTake ? chanceAtLeast(a, d.strength, enemyCity.hp) * (1 - att.dies) : 0;
    return { attacker: att, defender: d, ranged: false, takes };
  }
  if (!military) {
    if (!civilian) return null;
    // A lone civilian: taken (or killed) without a fight.
    const side = unitSide(civilian, 0, []);
    side.dies = 1;
    return { attacker: unitSide(u, strength(game, u, 'attack', civilian, u.tile, why), why), defender: side, ranged: false, capture: true };
  }
  const dwhy: Modifier[] = [];
  const a = strength(game, u, 'attack', military, u.tile, why);
  const d = strength(game, military, 'defend', u, target, dwhy);
  const att = unitSide(u, a, why);
  const def = unitSide(military, d, dwhy);
  att.damage = range(d, a);
  def.damage = range(a, d);
  att.dies = chanceAtLeast(d, a, u.hp);
  def.dies = chanceAtLeast(a, d, military.hp);
  return { attacker: att, defender: def, ranged: false };
}

/** A city's ranged attack on a tile within two (null: nothing there it could hit). */
export function previewCityFire(game: Game, c: City, target: number): CombatPreview | null {
  if (distance(game.grid, c.tile, target) > 2) return null;
  const here = occupants(game, target);
  const def = here.military ?? here.civilian;
  if (!def || !atWar(game, c.owner, def.owner)) return null;
  const a = cityFireStrength(game, c);
  const dwhy: Modifier[] = [];
  const d = isMilitary(UNITS[def.type]) ? strength(game, def, 'defend', c, target, dwhy) : 1;
  const side = unitSide(def, d, dwhy);
  side.damage = range(a, d);
  side.dies = chanceAtLeast(a, d, def.hp);
  return { attacker: citySide(game, c, true), defender: side, ranged: true, blocked: c.fired ? 'It has fired this turn' : undefined };
}
