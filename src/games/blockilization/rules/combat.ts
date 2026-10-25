import { formationBonus, formationKind, sizeOf, unitName } from './armies';
import { BUILDINGS } from './buildings';
import { atWar, canStand, cityAt, cityById, note, random, removeUnit, seesUnit, speed, updateVisibility } from './core';
import { assignCitizens, blockaded, cityEffects, civEffects, garrisoned, has, happiness } from './economy';
import type { CombatWhen } from './effects';
import { cityReligion } from './faith';
import { distance, line, neighbours, within } from './hex';
import { campHooks, civiliansAt, occupants } from './movement';
import { fromPromotions, PROMOTIONS, type PromotionWhen } from './promotions';
import type { City, Game, Unit } from './state';
import { FALLOUT, FEATURES, HILLS, IMPROVEMENTS, TERRAINS } from './terrain';
import { canFortify, isGreatPerson, isMilitary, UNITS } from './units';

/**
 * Combat, Civilization V's way: each side's strength (its base, wounds, terrain, fortifying, forts,
 * flanking, rivers and landings from the sea, great generals near, promotions and policies, and an
 * unhappy empire's weakness), damage from the ratio of strengths (about 30 each at even odds, more
 * to the weaker), melee fighters trading blows and ranged ones firing without reply; cities with
 * strength and hit points of their own, firing at what's near, taken when brought down by a melee
 * unit. Fights earn experience, and land fights (sea fights) great general (admiral) points.
 * Pillaging, citadels and nuclear strikes are here too.
 */

export interface CombatResult {
  attacker: number;
  /** Damage each side took, and whether the defender (or the attacker) was destroyed or the city taken. */
  dealt: number;
  taken: number;
  killed: boolean;
  died: boolean;
  captured?: boolean;
  at: number;
}

/**
 * A city's combat strength (Civ V's way): a base, its people and the age it lives in (slow at first,
 * faster as the eras go), then its walls and the rest, its garrison (a quarter of the unit's), its
 * hill; more with Goddess of Protection and the Kremlin. `firing`, its walls and garrison are left
 * out and it's three quarters of the rest: they make a city hard to take, not deadly to stand near
 * (a catapult outlives two of its shots).
 */
export function cityStrength(game: Game, c: City, firing = false): number {
  const p = game.players[c.owner];
  const effects = cityEffects(game, c);
  let s = 8 + c.pop * 0.4 + (p.techs.length * p.techs.length) / 300;
  if (firing) s *= 0.75;
  else {
    for (const e of effects) s += e.defense ?? 0;
    const garrison = occupants(game, c.tile).military;
    if (garrison) s += (UNITS[garrison.type].strength / 4) * (1 + formationBonus(sizeOf(garrison)) / 100);
  }
  if (game.tiles[c.tile].elevation === 'hills') s *= 1.25;
  s *= 1 + effects.reduce((x, e) => x + (e.cityStrength ?? 0), 0) / 100;
  return Math.round(s * 10) / 10;
}

/** A city's strength when it fires (without its walls and garrison: see `cityStrength`), half again with a garrison under Oligarchy. */
export function cityFireStrength(game: Game, c: City): number {
  const oligarchy = garrisoned(game, c) && has(civEffects(game, game.players[c.owner]), 'garrison_city_strike');
  return cityStrength(game, c, true) * (oligarchy ? 1.5 : 1);
}

/**
 * What a city heals as its turn ends: 20, but 8 if it was attacked since its last turn, and nothing
 * if it's surrounded (every tile round it held by an enemy soldier or one no one can stand on): a
 * siege that keeps up its fire wears the walls down. Blockaded from the sea (`blockaded`), half.
 */
export function cityHeal(game: Game, c: City): number {
  const surrounded = neighbours(game.grid, c.tile).every((t) => {
    const tile = game.tiles[t];
    if (tile.elevation === 'mountain' || tile.feature === 'ice') return true;
    const m = occupants(game, t).military;
    return !!m && atWar(game, m.owner, c.owner);
  });
  const heal = surrounded ? 0 : c.attacked ? 8 : 20;
  return blockaded(game, c) ? Math.floor(heal / 2) : heal;
}

/** A city's hit points at full health: 200, and more with walls and the rest. */
export const cityMaxHp = (_game: Game, c: City) => 200 + c.buildings.reduce((s, b) => s + (BUILDINGS[b]?.effects.hp ?? 0), 0);

/** Hills, forest, jungle and marsh: rough ground (for Drill, Barrage and the rest). */
const roughAt = (game: Game, t: number) => {
  const tile = game.tiles[t];
  return tile.elevation === 'hills' || tile.feature === 'forest' || tile.feature === 'jungle' || tile.feature === 'marsh';
};

/** Whether another military unit of the same owner stands next to a tile. */
const besideFriend = (game: Game, u: Unit, t: number) => neighbours(game.grid, t).some((n) => game.units.some((o) => o !== u && o.tile === n && o.owner === u.owner && isMilitary(UNITS[o.type]) && !o.embarked));

/** Whether a tile belongs to a city following a religion. */
const faithfulLand = (game: Game, t: number, religion: string | undefined) => {
  const tile = game.tiles[t];
  const city = tile.city !== undefined ? cityById(game, tile.city) : undefined;
  return !!religion && !!city && cityReligion(city) === religion;
};

/**
 * The bonus great people give units near them (Civ V's): +15% for land units within two tiles of
 * their owner's Great General (China's: +30%), and for ships near a Great Admiral.
 */
export function leadership(game: Game, u: Unit, at: number): number {
  const domain = UNITS[u.type].domain;
  const leader = game.units.find((g) => g.owner === u.owner && UNITS[g.type]?.abilities?.includes('combat_bonus_aura') && UNITS[g.type].domain === domain && distance(game.grid, g.tile, at) <= 2);
  if (!leader) return 0;
  return has(civEffects(game, game.players[u.owner]), 'generals_stronger') ? 30 : 15;
}

/** Something that changes a unit's strength in a fight, by a percentage (for the combat preview). */
export interface Modifier {
  label: string;
  percent: number;
}

/**
 * A unit's strength on a tile, for attacking or defending, with everything that changes it (each
 * modifier that applies is added to `why`, when given).
 */
export function strength(game: Game, u: Unit, role: 'attack' | 'defend' | 'ranged', against: Unit | City | null, at: number, why?: Modifier[]): number {
  const type = UNITS[u.type];
  const p = game.players[u.owner];
  let base = role === 'ranged' ? (type.ranged ?? 0) : type.strength;
  let pct = 0;
  const add = (label: string, n: number) => {
    if (!n) return;
    pct += n;
    why?.push({ label, percent: n });
  };
  const civ = civEffects(game, p);
  // A corps or an army: its units as one.
  add(formationKind(u.type, sizeOf(u)) ?? '', formationBonus(sizeOf(u)));
  // Wounds: up to half its strength gone at death's door (Civ V's); none for Japan's.
  if (!has(civ, 'no_wound_penalty')) add('Wounded', -(100 - u.hp) / 2);
  const tile = game.tiles[at];
  const vsUnit = against && 'type' in against ? against : null;
  const vsCity = against && !('type' in against) ? against : null;
  // Where the fight is: the defender's tile (a ranged unit's target, a melee unit's).
  const target = role === 'defend' ? at : vsUnit ? vsUnit.tile : vsCity ? vsCity.tile : at;
  // Attacked by fire: a ranged unit (they always fire) or a city.
  const fired = role === 'defend' && (!!vsCity || (!!vsUnit && (UNITS[vsUnit.type].ranged ?? 0) > 0));
  if (role === 'defend') {
    // Terrain (bonuses not for mounted units and armour, Civ V's), fortifying (not in cities), forts and citadels.
    // Terrain (bonuses not for mounted units and armour, Civ V's), fortifying (not in cities), forts and citadels.
    const ground = (n: number) => (type.abilities?.includes('no_terrain_defense') ? Math.min(0, n) : n);
    if (tile.elevation === 'hills') add('Hills', ground(HILLS.defense));
    if (tile.feature) add(FEATURES[tile.feature].name, ground(FEATURES[tile.feature].defense));
    if (u.stance === 'fortify' && canFortify(type) && !u.embarked && !cityAt(game, at)) add('Fortified', 25 * Math.min(2, u.fortified ?? 0));
    if (tile.improvement && !tile.pillaged && tile.owner === u.owner) add(IMPROVEMENTS[tile.improvement].name, tile.improvement === 'citadel' ? 100 : tile.improvement === 'fort' ? 50 : 0);
    // At sea, a land unit is all but defenceless (it grows with the era).
    if (u.embarked) {
      base = Math.min(base, 3 + p.techs.length * 0.2);
      why?.push({ label: 'Embarked', percent: 0 });
    }
  }
  // Against mounted: spearmen and pikemen double. Against cities: siege doubles, horses lose a third.
  if (vsUnit && UNITS[vsUnit.type].class === 'mounted' && type.abilities?.includes('bonus_vs_mounted')) add('Against mounted', 100);
  if (vsCity && role !== 'defend') {
    if (type.abilities?.includes('bonus_vs_cities')) add('Against cities', 100);
    if (type.abilities?.includes('penalty_vs_cities')) add('Against cities', -33);
  }
  // A melee attack: +10% for each other unit of the attacker's next to the defender (flanking), -20%
  // into a river from outside it, -50% from the sea (Civ V's).
  if (role === 'attack' && against) {
    if (vsUnit) add('Flanking', 10 * neighbours(game.grid, vsUnit.tile).filter((n) => n !== u.tile && occupants(game, n).military?.owner === u.owner).length);
    if (game.tiles[target].river && !tile.river && !u.embarked) add('Across a river', -20);
    if (u.embarked) add('From the sea', -50);
  }
  // Promotions.
  for (const id of u.promotions) {
    const c = PROMOTIONS[id]?.combat;
    if (c && promotionCounts(c.when, game, role, target, fired, vsUnit, vsCity)) add(PROMOTIONS[id].name, c.percent);
  }
  // Effects (policies, wonders, beliefs, the civ's ability).
  let effects = 0;
  for (const e of civ)
    for (const c of e.combat ?? []) {
      if (c.classes && !c.classes.includes(type.class)) continue;
      if (combatCounts(c.when ?? 'always', game, u, role, at, target, vsUnit, vsCity)) effects += c.percent;
    }
  add('Policies, wonders and beliefs', effects);
  // Persia's golden ages; great generals and admirals near; jaguars in the woods.
  if (p.goldenTurns > 0 && has(civ, 'golden_age_moves_combat')) add('Golden age', 10);
  add(type.domain === 'sea' ? 'Great Admiral' : 'Great General', leadership(game, u, at));
  if (type.abilities?.includes('jungle_fighter') && (game.tiles[target].feature === 'forest' || game.tiles[target].feature === 'jungle')) add('Jungle fighter', 33);
  // An unhappy empire fights worse (Civ V: -2% a point below zero, down to -90%).
  if (!p.cityState && p.civ !== 'barbarian') {
    const mood = happiness(game, p);
    if (mood < 0) add('Unhappiness', -Math.min(90, -2 * mood));
  }
  return Math.max(0.5, base * (1 + pct / 100));
}

/** Whether a promotion's bonus counts in a fight. */
function promotionCounts(when: PromotionWhen, game: Game, role: 'attack' | 'defend' | 'ranged', target: number, fired: boolean, vsUnit: Unit | null, vsCity: City | null): boolean {
  switch (when) {
    case 'open':
      return !roughAt(game, target);
    case 'rough':
      return roughAt(game, target);
    case 'ranged_open':
      return role === 'ranged' && !roughAt(game, target);
    case 'ranged_rough':
      return role === 'ranged' && roughAt(game, target);
    case 'vs_ranged':
      return fired;
    case 'vs_mounted':
      return !!vsUnit && UNITS[vsUnit.type].class === 'mounted';
    case 'vs_ships':
      return !!vsUnit && UNITS[vsUnit.type].domain === 'sea';
    case 'vs_cities':
      return !!vsCity && role !== 'defend';
    case 'always':
      return true;
  }
}

/** Whether a policy's (wonder's, belief's) combat bonus counts in a fight: where it's fought (the defender's tile) for the land, beside the unit for its friends. */
function combatCounts(when: CombatWhen, game: Game, u: Unit, role: 'attack' | 'defend' | 'ranged', at: number, target: number, vsUnit: Unit | null, vsCity: City | null): boolean {
  const p = game.players[u.owner];
  const owner = game.tiles[target].owner;
  switch (when) {
    case 'always':
      return true;
    case 'attacking':
      return role !== 'defend';
    case 'defending':
      return role === 'defend';
    case 'friendly_land':
      return owner === u.owner;
    case 'vs_cities':
      return !!vsCity && role !== 'defend';
    case 'vs_barbarians':
      return !!vsUnit && game.players[vsUnit.owner]?.civ === 'barbarian';
    case 'vs_city_states':
      return !!game.players[(vsUnit ?? vsCity)?.owner ?? -1]?.cityState;
    case 'beside_friend':
      return besideFriend(game, u, at);
    case 'faithful_land':
      return owner === u.owner && faithfulLand(game, target, p.religion);
    case 'faithful_enemy_land':
      return owner >= 0 && atWar(game, u.owner, owner) && faithfulLand(game, target, p.religion);
  }
}

/**
 * Damage the side whose strength is `mine` does to the side whose strength is `theirs` (Civ V's
 * formula: 24 to 36 at even odds, more the stronger it is, less the weaker).
 */
export const damage = (game: Game, mine: number, theirs: number): number => damageFor(mine, theirs, 24 + random(game) * 12);

/** The damage formula for a given roll (24 to 36): the fight's luck taken out, for previews. */
export function damageFor(mine: number, theirs: number, roll: number): number {
  const ratio = Math.max(mine, theirs) / Math.min(mine, theirs);
  const factor = (Math.pow((ratio + 3) / 4, 4) + 1) / 2;
  const d = mine >= theirs ? roll * factor : roll / factor;
  return Math.max(1, Math.min(100, Math.round(d)));
}

/** Experience from fighting barbarians stops here (Civ V's). */
export const BARBARIAN_XP_CAP = 30;

/**
 * Experience for a fight (Civ V: 5 for attacking, 4 defending, 2 for ranged; more with Military
 * Tradition and Elite Forces, and for the Zulu; against barbarians, only up to 30). A fight against
 * a civ or a city-state also earns its owner great general points (great admiral points at sea).
 */
export function gain(game: Game, u: Unit, xp: number, foe: number) {
  const p = game.players[u.owner];
  const barbarian = game.players[foe]?.civ === 'barbarian';
  if (barbarian && u.xp >= BARBARIAN_XP_CAP) return;
  const civ = civEffects(game, p);
  // (The Zulu's third more is Civ V's quarter less needed for each promotion.)
  const got = xp * (1 + (has(civ, 'double_xp') ? 1 : 0) + (has(civ, 'xp_50') ? 0.5 : 0) + (has(civ, 'xp_33') ? 1 / 3 : 0));
  u.xp += barbarian ? Math.min(got, BARBARIAN_XP_CAP - u.xp) : got;
  if (!barbarian && !p.cityState && p.civ !== 'barbarian') cityHooks.greatPoints(game, u, xp);
}

/** Whether `from` can see `to` for a ranged attack (range, and nothing in the way unless it's next door). */
export function canFire(game: Game, from: number, to: number, range: number): boolean {
  const d = distance(game.grid, from, to);
  if (d < 1 || d > range) return false;
  if (d === 1) return true;
  return line(game.grid, from, to)
    .slice(1, -1)
    .every((t) => {
      const tile = game.tiles[t];
      return tile.elevation !== 'mountain' && !(tile.elevation === 'hills' || tile.feature === 'forest' || tile.feature === 'jungle') || game.tiles[from].elevation === 'hills';
    });
}

/** A unit's range (more with the Range promotion). */
export const rangeOf = (u: Unit) => (UNITS[u.type]?.range ?? 1) + fromPromotions(u, 'range');

/** A melee attack on the tile next door: a unit there, or a city. */
export function melee(game: Game, u: Unit, target: number): CombatResult | null {
  if (!neighbours(game.grid, u.tile).includes(target)) return null;
  const city = cityAt(game, target);
  const def = occupants(game, target).military;
  if (city && atWar(game, u.owner, city.owner)) return attackCity(game, u, city, false);
  if (!def || !atWar(game, u.owner, def.owner) || !seesUnit(game, game.players[u.owner], def)) {
    // Only a civilian there: captured (a settler or a worker), or killed.
    const civ = occupants(game, target).civilian;
    if (civ && atWar(game, u.owner, civ.owner) && !u.embarked) {
      // Taking a civilian is a step onto its tile (Civ V's).
      capture(game, u, civ);
      if (canStand(game, u.type, target) && !occupants(game, target).military) {
        u.tile = target;
        u.stance = undefined;
        u.fortified = 0;
        u.setUp = false;
      }
      u.moves = Math.max(0, u.moves - 1);
      updateVisibility(game, game.players[u.owner]);
      return { attacker: u.id, dealt: 0, taken: 0, killed: true, died: false, at: target };
    }
    return null;
  }
  const a = strength(game, u, 'attack', def, u.tile);
  const d = strength(game, def, 'defend', u, target);
  const dealt = damage(game, a, d);
  const taken = damage(game, d, a);
  def.hp -= dealt;
  u.hp -= taken;
  u.attacked = true;
  // (Attacking breaks fortifying, Civ V's.)
  u.stance = undefined;
  u.fortified = 0;
  u.moves = UNITS[u.type].abilities?.includes('withdraw') || u.promotions.includes('blitz') ? Math.max(0, u.moves - 1) : 0;
  const killed = def.hp <= 0;
  const died = u.hp <= 0;
  if (killed) {
    die(game, def, u);
    // The winner moves in (Civ V: melee units advance into the tile), taking any civilian there;
    // not past a soldier still holding it (one embarked beside a ship that fell, or a ship behind one).
    if (!died) {
      if (UNITS[u.type].abilities?.includes('kill_heal')) u.hp = Math.min(100, u.hp + 25);
      const left = occupants(game, target);
      if (left.civilian && left.civilian.owner !== u.owner && !left.military) capture(game, u, left.civilian);
      if (!left.military && canStand(game, u.type, target)) {
        u.tile = target;
        u.embarked = false;
        u.setUp = false;
        campHooks.onCamp(game, u);
      }
    }
  }
  if (died) die(game, u, def);
  // Experience (and great general points) for those still standing, once the dust has settled.
  if (!died) gain(game, u, 5, def.owner);
  if (!killed) gain(game, def, 4, u.owner);
  updateVisibility(game, game.players[u.owner]);
  return { attacker: u.id, dealt, taken, killed, died, at: target };
}

/** A ranged attack on a military unit or a city it can see: no reply, and it doesn't advance. Not from a boat. */
export function ranged(game: Game, u: Unit, target: number): CombatResult | null {
  const type = UNITS[u.type];
  if (!type.ranged || u.embarked || !canFire(game, u.tile, target, rangeOf(u))) return null;
  if (type.abilities?.includes('must_setup') && !u.setUp) return null;
  const p = game.players[u.owner];
  if (!(p.visible[target] > 0)) return null;
  const city = cityAt(game, target);
  if (city && atWar(game, u.owner, city.owner)) return attackCity(game, u, city, true);
  const def = occupants(game, target).military;
  if (!def || !atWar(game, u.owner, def.owner) || !seesUnit(game, p, def)) return null;
  const a = strength(game, u, 'ranged', def, u.tile);
  const d = strength(game, def, 'defend', u, target);
  const dealt = damage(game, a, d);
  def.hp -= dealt;
  u.attacked = true;
  u.moves = 0;
  u.stance = undefined;
  u.fortified = 0;
  gain(game, u, 2, def.owner);
  const killed = def.hp <= 0;
  if (killed) die(game, def, u);
  return { attacker: u.id, dealt, taken: 0, killed, died: false, at: target };
}

/** An attack on a city: melee units trade blows with it, ranged ones don't. Brought to 0 by melee (not from the air), it's taken. */
function attackCity(game: Game, u: Unit, c: City, isRanged: boolean): CombatResult {
  const a = strength(game, u, isRanged ? 'ranged' : 'attack', c, u.tile);
  const d = cityStrength(game, c);
  const dealt = damage(game, a, d);
  // Barbarians raid cities but never take them.
  const barbarian = game.players[u.owner].civ === 'barbarian';
  c.hp = Math.max(isRanged || barbarian ? 1 : 0, c.hp - dealt);
  c.attacked = true;
  let taken = 0;
  if (!isRanged) {
    taken = damage(game, d, a);
    u.hp -= taken;
  }
  u.attacked = true;
  u.moves = 0;
  u.stance = undefined;
  u.fortified = 0;
  const owner = c.owner;
  const died = u.hp <= 0;
  if (died) die(game, u, null, `attacking ${c.name}`);
  const captured = !isRanged && !died && c.hp <= 0 && UNITS[u.type].domain !== 'air' && UNITS[u.type].class !== 'helicopter';
  if (captured) {
    const garrison = occupants(game, c.tile).military;
    if (garrison) die(game, garrison, u);
    // (The civilians in it are taken with it.)
    for (const civ of civiliansAt(game, c.tile)) if (civ.owner !== u.owner) capture(game, u, civ);
    u.tile = c.tile;
    u.embarked = false;
    cityHooks.captured(game, c, u.owner);
  }
  if (!died) gain(game, u, isRanged ? 2 : 5, owner);
  if (!captured) underAttack(game, c, u);
  return { attacker: u.id, dealt, taken, killed: captured, died, captured, at: c.tile };
}

/** Tells a city's owner it's under attack, with its defences left: one note for it at a time (a later blow's replaces it). */
function underAttack(game: Game, c: City, by: Unit) {
  const p = game.players[c.owner];
  if (!p || p.bot) return;
  const about = `${c.name} is under attack`;
  p.notes = p.notes.filter((n) => !(n.at === c.tile && n.text.startsWith(about)));
  note(game, c.owner, { text: `${about} by ${game.players[by.owner].name}: its defences are down to ${Math.round(c.hp)} of ${cityMaxHp(game, c)}.`, at: c.tile, kind: 'war' });
}

/** A city fires at a military unit it can see within two tiles (once a turn). */
export function cityFire(game: Game, c: City, target: number): CombatResult | null {
  if (c.fired || distance(game.grid, c.tile, target) > 2) return null;
  const p = game.players[c.owner];
  const def = occupants(game, target).military;
  if (!def || !atWar(game, c.owner, def.owner) || !seesUnit(game, p, def)) return null;
  const a = cityFireStrength(game, c);
  const d = strength(game, def, 'defend', c, target);
  const dealt = damage(game, a, d);
  def.hp -= dealt;
  c.fired = true;
  const killed = def.hp <= 0;
  if (killed) die(game, def, null, `the walls of ${c.name}`);
  return { attacker: -c.id, dealt, taken: 0, killed, died: false, at: target };
}

/** A unit is destroyed (by someone, or nobody; `how` says by what when no unit did it: a city's walls, a citadel). */
export function die(game: Game, u: Unit, by: Unit | null, how?: string) {
  removeUnit(game, u);
  // A carrier sunk loses the aircraft aboard (however it was sunk: a unit, a city's fire, a strike, a citadel).
  for (const a of game.units.filter((x) => x.carrier === u.id && x.owner === u.owner)) {
    removeUnit(game, a);
    note(game, a.owner, { text: `Your ${UNITS[a.type].name} was lost with its base.`, at: a.tile, kind: 'bad' });
  }
  note(game, u.owner, { text: `Your ${unitName(u)} was destroyed${by ? ` by ${game.players[by.owner].name}'s ${unitName(by)}` : how ? ` by ${how}` : ''}.`, at: u.tile, kind: 'bad' });
  cityHooks.killed(game, u, by);
}

/** Whether an enemy's civilian of this type is taken when caught (workers, settlers), not killed (great people, missionaries, caravans). */
export const takenAlive = (type: string) => !isGreatPerson(type) && !['missionary', 'inquisitor', 'caravan', 'cargo_ship'].includes(type);

/**
 * A civilian taken by a military unit: settlers become workers (Civ V's), workers change hands. One
 * the barbarians take is led back to their camp (`barbarians.ts`), for anyone to take back on the
 * way there or by clearing the camp.
 */
export function capture(game: Game, by: Unit, civ: Unit) {
  const name = UNITS[civ.type].name;
  if (!takenAlive(civ.type)) {
    removeUnit(game, civ);
    note(game, civ.owner, { text: `Your ${name} was killed by ${game.players[by.owner].name}'s ${UNITS[by.type].name}.`, at: civ.tile, kind: 'bad' });
    return;
  }
  const barbarians = game.players[by.owner].civ === 'barbarian';
  note(game, civ.owner, { text: barbarians ? `Your ${name} was captured by barbarians, who are taking it back to their camp: catch it on the way, or clear the camp, to free it.` : `Your ${name} was captured.`, at: civ.tile, kind: 'bad' });
  if (game.players[civ.owner].civ === 'barbarian') note(game, by.owner, { text: `You have freed a ${name} from the barbarians.`, at: civ.tile, kind: 'good' });
  civ.owner = by.owner;
  civ.type = civ.type === 'settler' ? 'worker' : civ.type;
  // (Taken by a clan's raider, it's that clan's, and goes to its camp; taken from them, no one's.)
  civ.clan = by.clan;
  civ.moves = 0;
  civ.path = undefined;
  civ.work = undefined;
  civ.auto = undefined;
  civ.stance = undefined;
  civ.site = undefined;
  if (TERRAINS[game.tiles[civ.tile].terrain].water) removeUnit(game, civ);
}

// -------------------------------------------------------------------------------------------------
// Pillaging, citadels, the bomb
// -------------------------------------------------------------------------------------------------

/**
 * Whether a unit can pillage where it stands (Civ V's): a military unit with a move left, on an
 * improvement or road that isn't pillaged already, in the land of someone it's at war with or in no
 * one's land, and not a city.
 */
export function canPillage(game: Game, u: Unit): boolean {
  const type = UNITS[u.type];
  const tile = game.tiles[u.tile];
  if (!type || !tile || !isMilitary(type) || type.domain === 'air' || u.embarked || u.moves <= 0) return false;
  if ((!tile.improvement && !tile.road) || tile.pillaged || cityAt(game, u.tile)) return false;
  return tile.owner < 0 || atWar(game, u.owner, tile.owner);
}

/** Gold for pillaging an improvement (roads give none): 10, and 5 more an era, at the game's speed. */
export const pillageGold = (game: Game, era: number) => Math.floor((10 + 5 * era) * speed(game));

/** Pillage: the improvement and road stop working until a worker repairs them; the unit heals 25 and spends a move, and an improvement gives gold. */
export function pillage(game: Game, u: Unit, era: number): number {
  const tile = game.tiles[u.tile];
  tile.pillaged = true;
  u.hp = Math.min(100, u.hp + 25);
  u.moves = Math.max(0, u.moves - 1);
  u.stance = undefined;
  u.fortified = 0;
  const gold = tile.improvement ? pillageGold(game, era) : 0;
  game.players[u.owner].gold += gold;
  const what = tile.improvement ? IMPROVEMENTS[tile.improvement].name : 'road';
  note(game, u.owner, { text: `Your ${unitName(u)} has pillaged the ${what}${gold ? `: +${gold} gold` : ''}, and healed.`, at: u.tile, kind: 'good' });
  if (tile.owner >= 0) note(game, tile.owner, { text: `${game.players[u.owner].name} has pillaged your ${tile.improvement ? IMPROVEMENTS[tile.improvement].name : 'road'}.`, at: u.tile, kind: 'war' });
  return gold;
}

/** Each turn, a citadel hurts the enemy units next to it: 30 damage (Civ V's). */
export function citadelTurn(game: Game) {
  game.tiles.forEach((tile, t) => {
    if (tile.improvement !== 'citadel' || tile.pillaged || tile.owner < 0) return;
    for (const n of neighbours(game.grid, t)) {
      const enemy = occupants(game, n).military;
      if (!enemy || !atWar(game, tile.owner, enemy.owner)) continue;
      enemy.hp -= 30;
      if (enemy.hp <= 0) die(game, enemy, null, 'a citadel');
    }
  });
}

/** Each turn, fallout hurts every unit that ends its turn in it (Civ V's, `FEATURES.fallout.hurts`). */
export function falloutTurn(game: Game) {
  const hurts = FEATURES.fallout.hurts ?? 0;
  for (const u of [...game.units]) {
    if (game.tiles[u.tile]?.feature !== 'fallout' || !game.units.includes(u)) continue;
    u.hp -= hurts;
    if (u.hp <= 0) die(game, u, null, 'nuclear fallout');
  }
}

/**
 * Where a nuclear blast leaves fallout (Civ V's): on the blast's land, its forests, jungles and
 * marshes burnt away, and fallout on each tile by `FALLOUT.chance` (not on a city, a mountain, a
 * natural wonder, or under flood plains, an oasis, ice or an atoll). The tiles it fell on.
 */
export function falloutFrom(game: Game, area: number[]): number[] {
  const out: number[] = [];
  for (const t of area) {
    const tile = game.tiles[t];
    if (TERRAINS[tile.terrain].water || tile.elevation === 'mountain' || tile.wonder || cityAt(game, t)) continue;
    if (tile.feature && FALLOUT.burns.includes(tile.feature)) tile.feature = undefined;
    if (tile.feature || random(game) >= FALLOUT.chance) continue;
    tile.feature = 'fallout';
    out.push(t);
  }
  return out;
}

/**
 * Who a nuclear strike on a tile would hit (the owners of the units and the land in its blast, not
 * the striker), or null if it can't be made: not a nuclear weapon, out of range, or someone it would
 * hit isn't at war with its owner. (The bots ask before they strike.)
 */
export function nukeHits(game: Game, u: Unit, target: number): number[] | null {
  const type = UNITS[u.type];
  if (!type?.abilities?.includes('nuke') || target < 0 || target >= game.tiles.length || distance(game.grid, u.tile, target) > rangeOf(u)) return null;
  const hit = new Set<number>();
  for (const t of within(game.grid, target, type.blast ?? 1)) {
    for (const o of game.units) if (o.tile === t && o.owner !== u.owner) hit.add(o.owner);
    const owner = game.tiles[t].owner;
    if (owner >= 0 && owner !== u.owner) hit.add(owner);
  }
  return [...hit].some((o) => !atWar(game, u.owner, o)) ? null : [...hit];
}

/**
 * Whether an Atomic Bomb (a bomber's load, not a missile) is shot down on its way (Civ V's): an enemy
 * fighter on patrol with the target in its range, or an anti-aircraft unit within two tiles of it, may
 * down it, by a chance that grows with its strength (each interceptor once a turn). The interceptor, if so.
 */
export function bombShotDown(game: Game, u: Unit, target: number): Unit | null {
  if (u.type !== 'atomic_bomb') return null;
  let best: { by: Unit; power: number } | null = null;
  for (const x of game.units) {
    if (x.intercepted === game.turn || x.owner === u.owner || !atWar(game, x.owner, u.owner)) continue;
    const type = UNITS[x.type];
    const patrol = type.class === 'fighter' && x.stance === 'alert' && distance(game.grid, x.tile, target) <= rangeOf(x);
    const guns = !!type.abilities?.includes('intercept') && distance(game.grid, x.tile, target) <= 2;
    if (!patrol && !guns) continue;
    const power = Math.max(type.ranged ?? 0, type.strength) * (0.4 + (0.6 * x.hp) / 100);
    if (!best || power > best.power) best = { by: x, power };
  }
  if (!best) return null;
  best.by.intercepted = game.turn;
  return random(game) < bombInterceptChance(best.power) ? best.by : null;
}

/** The chance an interceptor of this strength (its best, less for its wounds) downs an Atomic Bomb (`bombShotDown`). */
export const bombInterceptChance = (power: number) => Math.min(0.75, power / (power + 70));

/**
 * A nuclear strike on a tile in range: every unit in the blast is badly hurt or destroyed (civilians
 * destroyed), every city loses half its people and its hit points, every improvement is ruined, and
 * fallout is left on much of its land (`falloutFrom`); the weapon is spent. Only where everyone it
 * would hit is at war with its owner (`nukeHits`). An Atomic Bomb may be shot down first
 * (`bombShotDown`). The world remembers it (`cityHooks.nuked`).
 */
export function nuke(game: Game, u: Unit, target: number): CombatResult | null {
  const type = UNITS[u.type];
  const hits = nukeHits(game, u, target);
  if (!hits) return null;
  const area = within(game.grid, target, type.blast ?? 1);
  removeUnit(game, u);
  const downed = bombShotDown(game, u, target);
  if (downed) {
    gain(game, downed, 5, u.owner);
    note(game, downed.owner, { text: `Your ${UNITS[downed.type].name} shot down ${game.players[u.owner].name}'s ${type.name}!`, at: downed.tile, kind: 'good' });
    note(game, u.owner, { text: `Your ${type.name} was shot down by ${game.players[downed.owner].name}'s ${UNITS[downed.type].name}.`, at: target, kind: 'bad' });
    return { attacker: u.id, dealt: 0, taken: 100, killed: false, died: true, at: target };
  }
  let dealt = 0;
  let killed = false;
  for (const t of area) {
    for (const o of game.units.filter((x) => x.tile === t)) {
      const harm = isMilitary(UNITS[o.type]) ? 60 + Math.floor(random(game) * 41) : 100;
      dealt += harm;
      o.hp -= harm;
      if (o.hp <= 0) {
        killed = true;
        die(game, o, null, 'a nuclear blast');
      }
    }
    const city = cityAt(game, t);
    if (city) {
      city.hp = Math.max(1, Math.floor(city.hp / 2));
      city.attacked = true;
      city.pop = Math.max(1, city.pop - Math.ceil(city.pop / 2));
      note(game, city.owner, { text: `${city.name} has been struck by a nuclear weapon!`, at: t, kind: 'war' });
    } else if (game.tiles[t].improvement || game.tiles[t].road) game.tiles[t].pillaged = true;
  }
  falloutFrom(game, area);
  for (const c of game.cities) if (within(game.grid, c.tile, 3).some((t) => area.includes(t))) assignCitizens(game, c);
  cityHooks.nuked(game, u.owner, hits, target);
  return { attacker: u.id, dealt, taken: 0, killed, died: true, at: target };
}

/** What the rest of the rules do when a city's taken, a unit's killed, or a fight earns great general points (set up by `game.ts`). */
export const cityHooks: { captured: (game: Game, c: City, by: number) => void; killed: (game: Game, u: Unit, by: Unit | null) => void; greatPoints: (game: Game, u: Unit, points: number) => void; nuked: (game: Game, by: number, hit: number[], at: number) => void } = {
  captured: () => {},
  nuked: () => {},
  killed: () => {},
  greatPoints: () => {},
};
