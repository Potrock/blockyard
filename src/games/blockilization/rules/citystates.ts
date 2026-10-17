import { aName, atWar, capitalOf, cityById, citiesOf, endWars, has, knowsOf, note, noteAll, random, speed, spawnUnit } from './core';
import { cityStrength } from './combat';
import type { Effects } from './effects';
import { cityReligion } from './faith';
import { questsTurn } from './quests';
import { pledged, pledgeOffended, pledgesTurn, PLEDGE_REST } from './pledges';
import { spiesOf } from './trade';
import { distance, neighbours, within } from './hex';
import { policyEffects } from './policies';
import { beliefEffects } from './religion';
import type { Game, Player, Unit } from './state';
import { RESOURCES } from './terrain';
import { isGreatPerson, isMilitary, UNITS, UNIT_LIST } from './units';

/**
 * City-states, Civ V's way: each civ has influence with each (gold gifts and services raise it, it
 * drifts back to rest each turn); at 30 they're friends, and the friend with the most, at 60 or more,
 * is their ally. Friends and allies get what their kind gives: maritime food, cultured culture,
 * militaristic gifts of units, mercantile happiness, religious faith; an ally shares their luxuries and
 * strategic resources too, and their vote (the diplomatic victory).
 */

export const FRIEND = 30;
export const ALLY = 60;
/** Influence a civ is left with at most by declaring war on a city-state (Civ V's). */
export const CS_WAR_INFLUENCE = -60;

export const cityStates = (game: Game) => game.players.filter((p) => p.cityState && p.alive);
export const influenceOf = (p: Player, cs: number) => p.influence[cs] ?? 0;

/** The civ allied with a city-state (most influence, 60 or more, and not at war with it), or -1. */
export function allyOf(game: Game, cs: number): number {
  let best = -1;
  let most = ALLY - 1;
  for (const p of game.players) {
    if (p.cityState || p.civ === 'barbarian' || !p.alive || atWar(game, p.index, cs)) continue;
    const v = influenceOf(p, cs);
    if (v > most) {
      most = v;
      best = p.index;
    }
  }
  return best;
}

export type Standing = 'ally' | 'friend' | 'neutral' | 'war';
export function standing(game: Game, p: Player, cs: number): Standing {
  if (atWar(game, p.index, cs)) return 'war';
  if (allyOf(game, cs) === p.index) return 'ally';
  return influenceOf(p, cs) >= FRIEND ? 'friend' : 'neutral';
}

/** What being a friend or ally of each city-state is worth this turn: food in every city, happiness. */
export function cityStateBonus(game: Game, p: Player): { food: number; happiness: number } {
  let food = 0;
  let happiness = 0;
  for (const cs of cityStates(game)) {
    const s = standing(game, p, cs.index);
    if (s !== 'friend' && s !== 'ally') continue;
    const k = cs.cityState!.kind;
    if (k === 'maritime') food += s === 'ally' ? 2 : 1;
    if (k === 'mercantile') happiness += s === 'ally' ? 3 : 2;
  }
  return { food, happiness };
}

/** Luxuries an ally gets from its city-states. */
export function alliedLuxuries(game: Game, p: Player): string[] {
  const out: string[] = [];
  for (const cs of cityStates(game)) {
    if (allyOf(game, cs.index) !== p.index) continue;
    game.tiles.forEach((t) => {
      if (t.owner === cs.index && t.resource && RESOURCES[t.resource].kind === 'luxury') out.push(t.resource);
    });
  }
  return out;
}

/** Strategic resources an ally gets from its city-states' land (by resource, how many). */
export function alliedStrategics(game: Game, p: Player): Record<string, number> {
  const out: Record<string, number> = {};
  for (const cs of cityStates(game)) {
    if (allyOf(game, cs.index) !== p.index) continue;
    for (const t of game.tiles) if (t.owner === cs.index && t.resource && RESOURCES[t.resource].kind === 'strategic') out[t.resource] = (out[t.resource] ?? 0) + (t.amount ?? 1);
  }
  return out;
}

/** What a civ's policies and beliefs say about city-states (wonders say nothing about them). */
const dealings = (game: Game, p: Player): Effects[] => [...policyEffects(p, game), ...beliefEffects(game, p)];
/**
 * Where a civ's influence with a city-state drifts back to: 0, or higher with Consulates (20), with
 * Papal Primacy if the city-state follows the civ's religion (15), and with Gunboat Diplomacy while
 * one of the civ's military units is within 3 tiles of it (20), and pledged to protect it (`PLEDGE_REST`).
 */
export function restingInfluence(game: Game, p: Player, cs: number): number {
  const effects = dealings(game, p);
  const home = capitalOf(game, cs);
  let rest = has(effects, 'influence_rest_20') ? 20 : 0;
  if (home && p.religion && cityReligion(home) === p.religion && has(effects, 'papal_primacy')) rest += 15;
  if (home && has(effects, 'gunboat') && game.units.some((u) => u.owner === p.index && isMilitary(UNITS[u.type]) && distance(game.grid, u.tile, home.tile) <= 3)) rest += 20;
  if (pledged(game, p.index, cs)) rest += PLEDGE_REST;
  return rest;
}

/** Influence a gift of gold buys (Civ V's grows a little slower than the gold). */
export const giftInfluence = (gold: number) => Math.floor(Math.pow(gold, 0.9) / 4);

/** Influence a gift of gold buys a civ: `giftInfluence`, a quarter more with Philanthropy, three tenths with Charitable Missions. */
export function giftWorth(game: Game, p: Player, gold: number): number {
  const effects = dealings(game, p);
  const more = 1 + (has(effects, 'gifts_25') ? 0.25 : 0) + (has(effects, 'charitable_missions') ? 0.3 : 0);
  return Math.floor(giftInfluence(gold) * more);
}

/** What a city-state gives a civ at a standing (friend or ally), in words. */
export function cityStateGives(game: Game, p: Player, cs: Player, as: 'friend' | 'ally'): string {
  const ally = as === 'ally';
  const era = 1 + Math.floor(p.techs.length / 10);
  const often = has(dealings(game, p), 'cs_units_often') ? 2 : 1;
  const gives = (() => {
    switch (cs.cityState?.kind) {
      case 'maritime':
        return `+${ally ? 2 : 1} food in every city`;
      case 'cultured':
        return `+${(ally ? 6 : 3) * era} culture a turn`;
      case 'militaristic':
        return `a unit about every ${Math.round((ally ? 14 : 20) / often)} turns`;
      case 'mercantile':
        return `+${ally ? 3 : 2} happiness`;
      case 'religious':
        return `+${ally ? 4 : 2} faith a turn`;
      default:
        return '';
    }
  })();
  return ally ? `${gives}; their luxuries, strategic resources and vote` : gives;
}

/** A gold gift to a city-state. */
export function gift(game: Game, p: Player, cs: number, gold: number): string | null {
  const c = game.players[cs];
  if (!c?.cityState || !c.alive) return 'Not a city-state';
  if (atWar(game, p.index, cs)) return "You're at war with them";
  if (!Number.isFinite(gold) || gold <= 0 || p.gold < gold) return `Not enough gold (you have ${Math.floor(p.gold)})`;
  const was = standing(game, p, cs);
  p.gold -= gold;
  p.influence[cs] = influenceOf(p, cs) + giftWorth(game, p, gold);
  const now = standing(game, p, cs);
  if (now !== was) note(game, p.index, { text: `${c.name} is now your ${now}.`, kind: 'good' });
  return null;
}

/** Influence a military unit given to a city-state buys: a fifth of its cost, at the game's speed (twice that with Arsenal of Democracy). */
export const unitGiftInfluence = (game: Game, p: Player, u: Unit) => Math.floor((UNITS[u.type].cost * speed(game)) / 5) * (has(dealings(game, p), 'unit_gifts_more') ? 2 : 1);

/** A military unit given to a city-state: it must stand in or next to the city-state's land. */
export function giftUnit(game: Game, p: Player, u: Unit, cs: number): string | null {
  const c = game.players[cs];
  if (!c?.cityState || !c.alive) return 'Not a city-state';
  if (atWar(game, p.index, cs)) return "You're at war with them";
  if (!isMilitary(UNITS[u.type]) || isGreatPerson(u.type)) return 'Only military units can be given';
  if (![u.tile, ...neighbours(game.grid, u.tile)].some((t) => game.tiles[t].owner === cs)) return "Take it into (or next to) the city-state's land first";
  if (game.cities.some((c) => c.tile === u.tile) || game.units.some((o) => o !== u && o.tile === u.tile)) return 'Not from a city, nor with another unit on its tile';
  const was = standing(game, p, cs);
  p.influence[cs] = influenceOf(p, cs) + unitGiftInfluence(game, p, u);
  u.owner = cs;
  u.path = undefined;
  u.work = undefined;
  u.stance = undefined;
  u.moves = 0;
  const now = standing(game, p, cs);
  if (now !== was) note(game, p.index, { text: `${c.name} is now your ${now}.`, kind: 'good' });
  return null;
}

/** Turns a city-state can't be bullied again after paying tribute (twenty, at speed). */
export const tributeTurns = (game: Game) => Math.round(20 * speed(game));

/** Influence a tribute costs: gold, 30; a worker, 50. */
export const TRIBUTE_COST = { gold: 30, worker: 50 } as const;

/** The gold a city-state pays a civ that bullies it: 40, and 20 more for each era of the civ's (by its techs, as its gifts go), at speed. */
export const tributeGold = (game: Game, p: Player) => Math.round((40 + 20 * Math.floor(p.techs.length / 10)) * speed(game));

/**
 * Why a civ can't demand tribute of a city-state now, if it can't (Civ V's bullying): at war with
 * it, or it paid tribute lately, or the civ's soldiers within three tiles of its city aren't
 * stronger than the city and its own soldiers there.
 */
export function cannotBully(game: Game, p: Player, cs: number): string | null {
  const c = game.players[cs];
  const home = capitalOf(game, cs);
  if (!c?.cityState || !c.alive || !home) return 'Not a city-state';
  if (atWar(game, p.index, cs)) return "You're at war with them";
  const since = c.cityState.tributeAt;
  if (since !== undefined && game.turn - since < tributeTurns(game)) return `It paid tribute lately (again in ${tributeTurns(game) - (game.turn - since)} turns)`;
  const near = (owner: number) => game.units.filter((u) => u.owner === owner && isMilitary(UNITS[u.type]) && !isGreatPerson(u.type) && distance(game.grid, u.tile, home.tile) <= 3).reduce((s, u) => s + UNITS[u.type].strength, 0);
  const mine = near(p.index);
  const theirs = cityStrength(game, home) + near(cs);
  if (mine <= theirs) return `Your soldiers within three tiles of ${home.name} (strength ${mine}) must outmatch it (${Math.round(theirs)})`;
  return null;
}

/** A tribute demanded of a city-state: its gold, or a worker; influence lost, and none can bully it for a while. */
export function tribute(game: Game, p: Player, cs: number, take: 'gold' | 'worker', spawn: (type: string, owner: number, at: number) => unknown): string | null {
  const why = cannotBully(game, p, cs);
  if (why) return why;
  const c = game.players[cs];
  const home = capitalOf(game, cs)!;
  if (take === 'gold') p.gold += tributeGold(game, p);
  else spawn('worker', p.index, home.tile);
  p.influence[cs] = influenceOf(p, cs) - TRIBUTE_COST[take];
  c.cityState!.tributeAt = game.turn;
  // (Its protectors are offended; a protector bullying it breaks its own pledge.)
  pledgeOffended(game, p.index, cs);
  note(game, p.index, { text: `${c.name} pays tribute: ${take === 'gold' ? `${tributeGold(game, p)} gold` : 'a worker'} (-${TRIBUTE_COST[take]} influence).`, at: home.tile, kind: 'good' });
  noteAll(game, (r) => (r !== p && !r.cityState && knowsOf(r, c) && knowsOf(r, p) ? { text: `${p.name} has bullied ${c.name} into paying tribute.`, at: home.tile, kind: 'info' } : null));
  return null;
}

/**
 * A coup's chance (Civ V's): a spy of a civ's in a city-state allied to another overthrows the ally
 * half the time when their influence is even, a percent less for each point the ally's is ahead
 * (a percent more for each behind), at least a tenth and at most nine tenths.
 */
export function coupChance(game: Game, p: Player, cs: number): number {
  const ally = allyOf(game, cs);
  if (ally < 0) return 0;
  return Math.max(0.1, Math.min(0.9, 0.5 + (influenceOf(p, cs) - influenceOf(game.players[ally], cs)) / 100));
}

/** Why a spy can't attempt a coup, if it can't: it must be in a city-state that's another civ's ally, at peace with it, since before this turn. */
export function cannotCoup(game: Game, p: Player, spyId: number): string | null {
  const spy = spiesOf(p).find((s) => s.id === spyId);
  if (!spy || spy.city === null) return 'Send a spy to a city-state first';
  const c = cityById(game, spy.city);
  const cs = c ? game.players[c.owner] : undefined;
  if (!c || !cs?.cityState) return 'A coup is made in a city-state';
  if (atWar(game, p.index, cs.index)) return "You're at war with them";
  if (spy.arrived === game.turn) return 'Your spy has only just arrived: a coup can be tried from next turn';
  const ally = allyOf(game, cs.index);
  if (ally < 0) return `${cs.name} has no ally to overthrow`;
  if (ally === p.index) return `${cs.name} is your ally already`;
  return null;
}

/** A coup: the spy's civ takes the ally's place (their influence swapped), or the spy is caught and killed. */
export function coup(game: Game, p: Player, spyId: number): string | null {
  const why = cannotCoup(game, p, spyId);
  if (why) return why;
  const spies = spiesOf(p);
  const spy = spies.find((s) => s.id === spyId)!;
  const c = cityById(game, spy.city!)!;
  const cs = game.players[c.owner];
  const was = game.players[allyOf(game, cs.index)];
  if (random(game) < coupChance(game, p, cs.index)) {
    const mine = influenceOf(p, cs.index);
    p.influence[cs.index] = influenceOf(was, cs.index);
    was.influence[cs.index] = mine;
    note(game, p.index, { text: `A coup in ${cs.name}: your spy has made it your ally.`, at: c.tile, kind: 'good' });
    note(game, was.index, { text: `A coup in ${cs.name}: ${knowsOf(was, p) ? p.name : 'foreign'} agents have turned it against you.`, at: c.tile, kind: 'bad' });
  } else {
    spies.splice(spies.indexOf(spy), 1);
    note(game, p.index, { text: `The coup in ${cs.name} failed: your spy was caught and killed.`, at: c.tile, kind: 'bad' });
    note(game, was.index, { text: `A coup in ${cs.name} against you failed${knowsOf(was, p) ? `: ${p.name}'s spy was caught` : ''}.`, at: c.tile, kind: 'info' });
  }
  return null;
}

/** Influence for a service near a city-state (a barbarian camp cleared close by). */
export function service(game: Game, p: Player, near: number, amount: number) {
  for (const cs of cityStates(game)) {
    const home = capitalOf(game, cs.index);
    if (!home || distance(game.grid, home.tile, near) > 8) continue;
    p.influence[cs.index] = influenceOf(p, cs.index) + amount;
    note(game, p.index, { text: `${cs.name} is grateful: +${amount} influence.`, kind: 'good' });
  }
}

/** Influence a civ loses a turn with a city-state while above its rest: one, less with policies that slow it (Treaty Organization and the like). */
export const influenceFall = (game: Game, p: Player) => 1 - Math.min(100, dealings(game, p).reduce((s, e) => s + (e.cityStateInfluence ?? 0), 0)) / 100;

/** Each turn: influence drifts back to rest, friends and allies get their gifts, quests are done and asked (`quests.ts`), pledges lapse (`pledges.ts`). */
export function cityStateTurn(game: Game) {
  questsTurn(game);
  pledgesTurn(game);
  for (const cs of cityStates(game)) {
    for (const p of game.players) {
      if (p.cityState || p.civ === 'barbarian' || !p.alive) continue;
      const rest = restingInfluence(game, p, cs.index);
      const v = influenceOf(p, cs.index);
      const effects = dealings(game, p);
      if (v > rest) p.influence[cs.index] = Math.max(rest, v - influenceFall(game, p));
      else if (v < rest) p.influence[cs.index] = Math.min(rest, v + 1);
      const s = standing(game, p, cs.index);
      if (s !== 'friend' && s !== 'ally') continue;
      const k = cs.cityState!.kind;
      const era = 1 + Math.floor(p.techs.length / 10);
      if (k === 'cultured') p.culture += (s === 'ally' ? 6 : 3) * era;
      if (k === 'religious') p.faith += s === 'ally' ? 4 : 2;
      const often = has(effects, 'cs_units_often') ? 2 : 1;
      if (k === 'militaristic' && game.turn % Math.round((s === 'ally' ? 14 : 20) / often) === cs.index % 7) {
        const home = capitalOf(game, p.index);
        const best = UNIT_LIST.filter((u) => u.domain === 'land' && !u.civ && !u.unbuildable && u.strength > 0 && (!u.tech || p.techs.includes(u.tech)) && !(u.obsolete && p.techs.includes(u.obsolete)) && !u.resource).sort((a, b) => b.strength - a.strength)[0];
        const at = home ? within(game.grid, home.tile, 2).find((t) => !game.units.some((u) => u.tile === t)) : undefined;
        if (best && at !== undefined) {
          spawnUnit(game, best.id, p.index, at);
          note(game, p.index, { text: `${cs.name} has sent you ${aName(UNITS[best.id].name)}.`, at, kind: 'good' });
        }
      }
    }
  }
  // A city-state with no city is gone.
  for (const cs of cityStates(game))
    if (!citiesOf(game, cs.index).length && game.turn > 3 && !game.units.some((u) => u.owner === cs.index && u.type === 'settler')) {
      cs.alive = false;
      endWars(game, cs.index);
      noteAll(game, (r) => (knowsOf(r, cs) ? { text: `${cs.name} is no more.`, kind: 'war' } : null));
    }
}
