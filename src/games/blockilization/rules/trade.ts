import { BUILDINGS, SPACESHIP_PARTS } from './buildings';
import { aName, atWar, cityById, cityAt, citiesOf, civOf, knows, nameTo, note, noteAll, random, speed, techCost } from './core';
import { cityEffects, cityYields, civEffects, has, landBodies, waterBodies } from './economy';
import type { Effects } from './effects';
import { embargoed } from './congress';
import { remember } from './diplomacy';
import { cityReligion } from './faith';
import { distance, neighbours } from './hex';
import type { City, Game, Player, Unit } from './state';
import { sideName, teammates } from './teams';
import { TECHS } from './techs';
import { UNITS } from './units';

/**
 * Trade, tourism and the long game: trade routes (a caravan or cargo ship sent from one of your cities
 * to another, yours or a foreign one: gold to you, science when they know more, food to a city of your
 * own), tourism (great works and some wonders) against each civ's lifetime of culture (the culture
 * victory), the spaceship (the science victory), the United Nations' vote for World Leader (the
 * diplomatic victory), and spies stealing technology (or, in a city-state, rigging its elections).
 */

export interface Route {
  from: number;
  to: number;
  turns: number;
  sea: boolean;
  /** To one of your own cities: what it carries (food unless production was chosen). */
  cargo?: 'food' | 'prod';
}

/** Techs that each allow another trade route (Civ V's, roughly), and effects that add more. */
const ROUTE_TECHS = ['animal_husbandry', 'sailing', 'currency', 'compass', 'banking', 'refrigeration', 'penicillin', 'the_internet'];
export function maxRoutes(game: Game, p: Player): number {
  const fromTechs = ROUTE_TECHS.filter((t) => knows(p, t)).length;
  return fromTechs + civEffects(game, p).reduce((s, e) => s + (e.tradeRoutes ?? 0), 0);
}

export const routesOf = (p: Player): Route[] => ((p as Player & { routes?: Route[] }).routes ??= []);

/** A civ's caravans and cargo ships waiting to set off on a route. */
export const tradeUnitsWaiting = (game: Game, p: Player) => game.units.filter((u) => u.owner === p.index && UNITS[u.type]?.abilities?.includes('trade_route')).length;

/** Why a civ can't train another caravan or cargo ship (every route it can have running or spoken for by one waiting), if it can't. */
export function routesFull(game: Game, p: Player): string | undefined {
  const waiting = tradeUnitsWaiting(game, p);
  if (routesOf(p).length + waiting < maxRoutes(game, p)) return undefined;
  return `Every trade route you can have is running${waiting ? ` or has a caravan waiting (${waiting})` : ''}`;
}

/** The effects of a city's own buildings. */
const buildingEffects = (c: City): Effects[] => c.buildings.map((b) => BUILDINGS[b]?.effects).filter((e): e is Effects => !!e);

/** The reach of a route from a city: 10 tiles by land, 20 by sea (half again with a caravansary or harbour). */
/** How far a trade route from a city reaches, by land or sea (more with its caravansary or harbour's effects). */
export const tradeReach = (c: City, sea: boolean) => (sea ? 20 * (has(buildingEffects(c), 'sea_trade_range') ? 1.5 : 1) : 10 * (has(buildingEffects(c), 'land_trade_range') ? 1.5 : 1));

/**
 * Whether a route has a way between two cities: a cargo ship's by water both cities touch (the same
 * sea or lake: no ship sails to a city inland, or from one sea to another), a caravan's over land
 * they share (it doesn't cross the sea).
 */
export function routeWay(game: Game, from: City, to: City, sea: boolean): boolean {
  if (!sea) {
    const land = landBodies(game);
    return land[from.tile] >= 0 && land[from.tile] === land[to.tile];
  }
  const water = waterBodies(game);
  const shore = (c: City) => new Set(neighbours(game.grid, c.tile).map((t) => water[t]).filter((w) => w >= 0));
  const ours = shore(from);
  return [...shore(to)].some((w) => ours.has(w));
}

/**
 * The city a trade unit would start its route from: the one of yours it stands in, else one of yours
 * next to it (a city with another civilian in it, a great general say, trains its caravan outside).
 */
export function routeHome(game: Game, p: Player, u: Unit): City | undefined {
  const here = cityAt(game, u.tile);
  if (here) return here.owner === p.index ? here : undefined;
  return neighbours(game.grid, u.tile)
    .map((t) => cityAt(game, t))
    .find((c): c is City => !!c && c.owner === p.index);
}

/** Send a trade unit from the city it's in (or next to) to another city (to one of your own, carrying food or production). */
export function startRoute(game: Game, p: Player, u: Unit, toId: number, cargo: 'food' | 'prod' = 'food'): string | null {
  const type = UNITS[u.type];
  if (!type?.abilities?.includes('trade_route')) return 'Only a Caravan or Cargo Ship';
  const from = routeHome(game, p, u);
  if (!from) return 'Start it in or next to one of your cities';
  const to = cityById(game, toId);
  if (!to || to === from) return 'Choose another city';
  if (atWar(game, p.index, to.owner)) return "You're at war with them";
  if (embargoed(game, p.index, to.owner)) return 'Trade with them is embargoed by the World Congress';
  const sea = type.domain === 'sea';
  if (distance(game.grid, from.tile, to.tile) > tradeReach(from, sea)) return `Too far for a trade route: ${tradeReach(from, sea)} tiles at most from ${from.name}`;
  if (!routeWay(game, from, to, sea)) return sea ? `No way by sea: ${from.name} and ${to.name} must both be on the coast of the same water` : `No way by land: ${to.name} is across the water (a Cargo Ship goes by sea)`;
  const routes = routesOf(p);
  if (routes.length >= maxRoutes(game, p)) return `You have every trade route you can (${maxRoutes(game, p)})`;
  if (routes.some((r) => r.from === from.id && r.to === to.id)) return 'There is a route between them already';
  routes.push({ from: from.id, to: to.id, turns: Math.round(30 * speed(game)), sea, ...(to.owner === p.index && cargo === 'prod' ? { cargo } : {}) });
  game.units.splice(game.units.indexOf(u), 1);
  note(game, p.index, { text: `A trade route from ${from.name} to ${to.name} is open.`, at: to.tile, kind: 'good' });
  return null;
}

/**
 * What a route brings this turn: to another civ's city, gold (and science from one further ahead);
 * to one of your own, food (3, and one for every four people in the city it comes from) or, if it
 * carries production, production (2, and the same).
 */
export function routeYield(game: Game, p: Player, r: Route): { gold: number; science: number; food: number; prod: number } {
  const from = cityById(game, r.from);
  const to = cityById(game, r.to);
  if (!from || !to) return { gold: 0, science: 0, food: 0, prod: 0 };
  if (to.owner === p.index) return r.cargo === 'prod' ? { gold: 0, science: 0, food: 0, prod: 2 + Math.floor(from.pop / 4) } : { gold: 0, science: 0, food: 3 + Math.floor(from.pop / 4), prod: 0 };
  const them = game.players[to.owner];
  const civ = civEffects(game, p);
  let gold = 3 + Math.floor(to.pop / 2) + (r.sea ? 2 : 0) + (has(civ, 'trade_gold_2') ? 2 : 0);
  if (r.sea && has(civ, 'sea_trade_gold_2')) gold += 2;
  if (them.cityState && has(civ, 'cs_trade_gold_3')) gold += 3;
  if (p.ideology && them.ideology === p.ideology && has(civ, 'ideology_trade_gold')) gold += 3;
  const science = Math.max(0, Math.floor((them.techs.length - p.techs.length) / 3));
  return { gold, science, food: 0, prod: 0 };
}

/** Whether a route still runs: both its cities standing, its own still, no war or embargo between them. */
function running(game: Game, p: Player, r: Route): boolean {
  const from = cityById(game, r.from);
  const to = cityById(game, r.to);
  return !!from && !!to && from.owner === p.index && !atWar(game, p.index, to.owner) && !embargoed(game, p.index, to.owner);
}

/**
 * The gold trade routes bring a civ each turn: its own routes', and one from each of another's that
 * ends in its cities. Part of its income (paid with the rest at its turn's end, `game.ts`), so it
 * isn't shown short, or thought broke, while its caravans keep it in gold.
 */
export function routesGold(game: Game, p: Player): number {
  let gold = 0;
  for (const o of game.players)
    for (const r of routesOf(o)) {
      if (!running(game, o, r)) continue;
      if (o === p) gold += routeYield(game, p, r).gold;
      else if (cityById(game, r.to)?.owner === p.index) gold += 1;
    }
  return gold;
}

/** Each turn: routes bring their science, food and production (their gold comes with the income), and run out. */
function tradeTurn(game: Game) {
  for (const p of game.players) {
    const routes = routesOf(p);
    for (const r of [...routes]) {
      const from = cityById(game, r.from);
      const to = cityById(game, r.to);
      if (!from || !to || !running(game, p, r)) {
        routes.splice(routes.indexOf(r), 1);
        continue;
      }
      const y = routeYield(game, p, r);
      if (p.researching && y.science) p.research[p.researching] = (p.research[p.researching] ?? 0) + y.science;
      to.food += y.food;
      to.prod += y.prod;
      if (--r.turns <= 0) {
        routes.splice(routes.indexOf(r), 1);
        note(game, p.index, { text: `The trade route from ${from.name} to ${to.name} has ended: send another.`, at: from.tile, kind: 'info' });
      }
    }
  }
}

// -------------------------------------------------------------------------------------------------
// Tourism and the culture victory
// -------------------------------------------------------------------------------------------------

/**
 * A city's tourism a turn: its great works (3 each; France's art in its capital, 6), 3 more
 * for each building whose great-work slots (two or more) are all full (Civ V's theming), its
 * buildings' own, and its wonders once the past is studied (Archaeology: 1 each, 2 with Flight),
 * made more by hotels and the like, and by half again with The Internet.
 */
export function cityTourism(game: Game, c: City, effects = cityEffects(game, c)): number {
  const p = game.players[c.owner];
  const doubleArt = c.capital && has(effects, 'capital_art_tourism');
  let t = 0;
  for (const [b, works] of Object.entries(c.works ?? {})) {
    const slots = BUILDINGS[b]?.effects.greatWorks;
    t += works.length * (doubleArt && slots?.kind === 'art' ? 6 : 3);
    if (slots && slots.slots >= 2 && works.length >= slots.slots) t += 3;
  }
  for (const e of effects) t += e.tourism ?? 0;
  if (knows(p, 'archaeology')) t += (c.wonders ?? []).length * (knows(p, 'flight') ? 2 : 1);
  // The Internet: half again (Civ V doubles it; here, with culture the most won victory, half).
  const pct = effects.reduce((s, e) => s + (e.tourismPercent ?? 0), 0) + (knows(p, 'the_internet') ? 50 : 0);
  return t * (1 + pct / 100);
}

/** A civ's tourism a turn: its cities'. */
export function tourismOf(game: Game, p: Player): number {
  return Math.floor(citiesOf(game, p.index).reduce((s, c) => s + cityTourism(game, c), 0));
}

/** Tourism toward another civ, with the bonuses for ties between them (25% each, 40% with Cultural Exchange). */
function tourismToward(game: Game, p: Player, them: Player, tourism = tourismOf(game, p)): number {
  const tie = 25 + (has(civEffects(game, p), 'tourism_ties_15') ? 15 : 0);
  let pct = 0;
  if (p.diplomacy.openBorders[them.index] > 0 || them.diplomacy.openBorders[p.index] > 0) pct += tie;
  if (p.religion && citiesOf(game, them.index).some((c) => cityReligion(c) === p.religion)) pct += tie;
  if (routesOf(p).some((r) => cityById(game, r.to)?.owner === them.index)) pct += tie;
  return tourism * (1 + pct / 100);
}

/** How influential a civ is over another: their tourism against its lifetime culture (1: influential). */
export const influence = (p: Player, them: Player) => (them.lifetimeCulture > 0 ? (p.tourism[them.index] ?? 0) / them.lifetimeCulture : 0);

export const majors = (game: Game) => game.players.filter((p) => !p.cityState && p.civ !== 'barbarian');

// -------------------------------------------------------------------------------------------------
// The spaceship
// -------------------------------------------------------------------------------------------------

/** The spaceship parts a city could build: with the Apollo Program done, each part's tech, up to its count. */
export function partsBuildable(game: Game, p: Player): string[] {
  if (!has(civEffects(game, p), 'enables_spaceship')) return [];
  const building = game.cities.filter((c) => c.owner === p.index).flatMap((c) => c.queue.filter((q) => q.kind === 'project').map((q) => q.id));
  return SPACESHIP_PARTS.filter((part) => knows(p, part.tech) && p.spaceship.filter((x) => x === part.id).length + building.filter((x) => x === part.id).length < part.count).map((part) => part.id);
}

export const partCost = (id: string) => SPACESHIP_PARTS.find((x) => x.id === id)?.cost ?? Infinity;
export const spaceshipDone = (p: Player) => SPACESHIP_PARTS.every((part) => p.spaceship.filter((x) => x === part.id).length >= part.count);

// -------------------------------------------------------------------------------------------------
// Spies
// -------------------------------------------------------------------------------------------------

export interface Spy {
  id: number;
  city: number | null;
  progress: number;
  /** Turns it still spends getting to know a civ's city before it works toward a theft. */
  watch?: number;
  /** A diplomat in another civ's capital (it steals nothing): delegates with Globalization, and what it hears of the civ's plans. */
  diplomat?: boolean;
  /** The war plan (by the turn it was made) a diplomat has told of already. */
  told?: number;
  /** The turn it was last sent where it is (a coup waits a turn after). */
  arrived?: number;
}

export const spiesOf = (p: Player): Spy[] => ((p as Player & { spies?: Spy[] }).spies ??= []);

/** A civ's diplomats in other civs' capitals. */
export const diplomatsOf = (game: Game, p: Player): Spy[] => spiesOf(p).filter((s) => s.diplomat && s.city !== null && cityById(game, s.city)?.capital);

/** Why a spy can't be sent to a city as a diplomat, if it can't: only to another civ's capital, not at war. */
export function cannotSendDiplomat(game: Game, p: Player, c: City): string | null {
  const them = game.players[c.owner];
  if (them === p || them.cityState || them.civ === 'barbarian' || !c.capital) return "A diplomat goes to another civ's capital";
  if (atWar(game, p.index, them.index)) return "Not while you're at war with them";
  return null;
}

/** A spy for each era from the Renaissance on (Civ V's), and one more with the National Intelligence Agency. */
export function spyCount(game: Game, p: Player, era: number): number {
  return Math.max(0, era - 2) + (has(civEffects(game, p), 'extra_spy') ? 1 : 0);
}

/**
 * What a theft takes, as a multiple of the tech's cost to the thief. Civ V's is 1.25, but our techs
 * cost a fraction of Civ V's while cities make Civ V's science, so a theft came every 5-8 turns; at
 * 2.5 a spy steals about half as often.
 */
export const THEFT_COST = 2.5;

/** Turns a spy watches a civ's city before it starts toward a theft (Civ V's three, at speed). */
export const surveillanceTurns = (game: Game) => Math.max(1, Math.round(3 * speed(game)));

/** A counterspy's chance of catching a spy as it steals (more with the policies that train them). */
export const catchChance = (game: Game, defender: Player) => (has(civEffects(game, defender), 'spies_defend') ? 0.75 : 0.5);

/**
 * What a civ's spy in a city could steal, and how fast (Civ V's way): only from a civ ahead of its
 * own (more techs), only a tech it could research now, the dearest of those; the theft takes
 * `THEFT_COST` times what that tech costs the spy's civ, gathered at the city's science a turn (faster
 * with Covert Action and Industrial Espionage, a quarter slower for each Constabulary or Police
 * Station there). Or why it can steal nothing there.
 */
export function theft(game: Game, p: Player, c: City): { tech: string; need: number; rate: number } | { why: string } {
  const them = game.players[c.owner];
  if (them === p || teammates(game, p.index, them.index)) return { why: 'A city of your own side' };
  if (has(civEffects(game, them), 'tech_steal_immune')) return { why: 'Its technology is safe from spies' };
  if (them.techs.length <= p.techs.length) return { why: `${them.name} isn't ahead of you in technology` };
  const stealable = Object.keys(TECHS).filter((t) => them.techs.includes(t) && !p.techs.includes(t) && TECHS[t].needs.every((n) => p.techs.includes(n)));
  if (!stealable.length) return { why: 'Nothing known there that you could learn yet' };
  const tech = stealable.sort((a, b) => techCost(game, p, b) - techCost(game, p, a))[0];
  const mine = civEffects(game, p);
  const pace = (1 + (has(mine, 'spies_faster') ? 0.25 : 0) + (has(mine, 'spies_steal_faster') ? 0.25 : 0)) * Math.pow(0.75, c.buildings.filter((b) => BUILDINGS[b]?.effects.special?.includes('slow_spies')).length);
  return { tech, need: techCost(game, p, tech) * THEFT_COST, rate: Math.max(1, cityYields(game, c).science) * pace };
}

function spyTurn(game: Game, eraOf: (p: Player) => number) {
  for (const p of majors(game)) {
    if (!p.alive) continue;
    const spies = spiesOf(p);
    while (spies.length < spyCount(game, p, eraOf(p))) {
      spies.push({ id: game.nextId++, city: null, progress: 0 });
      note(game, p.index, { text: 'A spy has joined your service: send it to a city (Espionage).', kind: 'info' });
    }
    for (const s of [...spies]) {
      const c = s.city !== null ? cityById(game, s.city) : undefined;
      if (!c || c.owner === p.index) continue;
      const them = game.players[c.owner];
      // A diplomat: sent home by a war; else it hears of the civ's plans for war (a bot's, once each).
      if (s.diplomat) {
        if (atWar(game, p.index, them.index)) {
          s.city = null;
          s.diplomat = undefined;
          note(game, p.index, { text: `Your diplomat has left ${c.name}: you're at war with ${them.name}.`, kind: 'bad' });
          continue;
        }
        const plan = them.ai?.plan;
        if (plan && plan.target !== p.index && s.told !== plan.since && game.players[plan.target]) {
          s.told = plan.since;
          note(game, p.index, { text: `Your diplomat in ${c.name} reports: ${them.name} is preparing a war on ${nameTo(p, game.players[plan.target])}.`, at: c.tile, kind: 'info' });
        }
        continue;
      }
      // In a city-state, it rigs its elections.
      if (them.cityState) {
        if (++s.progress < electionTurns(game)) continue;
        s.progress = 0;
        rigElection(game, p, them);
        continue;
      }
      if (s.watch) {
        s.watch--;
        continue;
      }
      const plan = theft(game, p, c);
      if ('why' in plan) continue;
      s.progress += plan.rate;
      if (s.progress < plan.need) continue;
      s.progress = 0;
      // A defending spy may catch it: it's killed, and its civ is known for what it tried.
      if (spiesOf(them).some((d) => d.city === c.id) && random(game) < catchChance(game, them)) {
        spies.splice(spies.indexOf(s), 1);
        remember(game, 'spy', p.index, them.index);
        note(game, p.index, { text: `Your spy in ${c.name} was caught and killed.`, at: c.tile, kind: 'bad' });
        note(game, them.index, { text: `Your counterspy caught ${aName(civOf(p).adjective)} spy in ${c.name}.`, at: c.tile, kind: 'good' });
        continue;
      }
      stolen.learn(game, p, plan.tech);
      note(game, p.index, { text: `Your spy stole ${TECHS[plan.tech].name} from ${c.name}!`, at: c.tile, kind: 'tech' });
      // Half the time the theft is traced to its civ.
      if (random(game) < 0.5) {
        remember(game, 'spy', p.index, them.index);
        note(game, them.index, { text: `${civOf(p).adjective} spies stole ${TECHS[plan.tech].name} from ${c.name}.`, at: c.tile, kind: 'bad' });
      } else note(game, them.index, { text: `Someone stole ${TECHS[plan.tech].name} from ${c.name}.`, at: c.tile, kind: 'bad' });
    }
  }
}

/** Turns between a city-state's elections (Civ V's fifteen, at speed). */
export const electionTurns = (game: Game) => Math.max(5, Math.round(15 * speed(game)));

/**
 * A spy rigs a city-state's election (Civ V's): its civ wins 20 influence there, and every other civ
 * loses 10 (none falling below nothing for it).
 */
function rigElection(game: Game, p: Player, cs: Player) {
  for (const o of majors(game)) {
    if (o === p || !o.alive) continue;
    const v = o.influence[cs.index] ?? 0;
    if (v > 0) o.influence[cs.index] = Math.max(0, v - 10);
  }
  p.influence[cs.index] = (p.influence[cs.index] ?? 0) + 20;
  const home = citiesOf(game, cs.index)[0];
  note(game, p.index, { text: `Your spy rigged the election in ${cs.name}: +20 influence.`, at: home?.tile, kind: 'good' });
}

/** How a stolen tech is learned (`game.ts` sets it: its `learn`). */
export const stolen: { learn: (game: Game, p: Player, tech: string) => void } = { learn: () => {} };

// -------------------------------------------------------------------------------------------------
// The turn, and the victories these bring
// -------------------------------------------------------------------------------------------------

/**
 * The United Nations' vote for World Leader, Civ V's way: each civ's two delegates for the candidate
 * it names (itself unless it says otherwise), two more for the United Nations' builder, each
 * city-state's one for its ally (one with no ally abstains). A World Leader needs half of the
 * delegates the world began with (each civ's two and each city-state's one, though some are gone
 * since, and the UN's two), and more than any other candidate: on a small map the UN's builder with
 * three city-states of four, on a larger one with every city-state or friends' votes besides.
 * (Counting only those still voting, the UN and fewer city-states won most small games once a civ or
 * a city-state had fallen; needing more than half, once the bots worked against a leader, too few.)
 * A team's delegates stand together (as it wins together): what its civs are given goes to the one
 * of them given most; and in a game of teams a World Leader needs more than two thirds of them (a
 * team's pooled votes alone shouldn't carry it).
 */
export function unVote(game: Game, allyOf: (game: Game, cs: number) => number): { votes: Map<number, number>; needed: number } {
  const living = majors(game).filter((p) => p.alive);
  const un = game.wonders['united_nations'];
  const cityStates = game.players.filter((x) => x.cityState && x.alive);
  const votes = new Map<number, number>();
  for (const p of living) {
    const named = (p as Player & { vote?: number }).vote;
    const vote = named !== undefined && game.players[named]?.alive ? named : p.index;
    votes.set(vote, (votes.get(vote) ?? 0) + 2 + (has(civEffects(game, p), 'extra_delegates') ? 2 : 0));
  }
  for (const cs of cityStates) {
    const ally = allyOf(game, cs.index);
    if (ally >= 0) votes.set(ally, (votes.get(ally) ?? 0) + 1);
  }
  if (living.some((p) => p.team !== undefined)) {
    const given = new Map(votes);
    votes.clear();
    for (const [candidate, n] of given) {
      const side = living.filter((o) => o.index === candidate || teammates(game, candidate, o.index));
      const lead = side.sort((a, b) => (given.get(b.index) ?? 0) - (given.get(a.index) ?? 0) || a.index - b.index)[0]?.index ?? candidate;
      votes.set(lead, (votes.get(lead) ?? 0) + n);
    }
  }
  const total = majors(game).length * 2 + (un !== undefined && un >= 0 ? 2 : 0) + game.players.filter((x) => x.cityState).length;
  const teams = living.some((p) => p.team !== undefined);
  return { votes, needed: teams ? Math.floor((total * 2) / 3) + 1 : Math.ceil(total / 2) };
}

/** The era (its index: the Industrial) from which a cultural victory can be won. */
export const CULTURE_ERA = 4;

/** Each turn: trade routes, tourism, spies, the UN's vote; and whether anyone's won by them. */
export function longGameTurn(game: Game, eraOf: (p: Player) => number, allyOf: (game: Game, cs: number) => number) {
  tradeTurn(game);
  const living = majors(game).filter((p) => p.alive);
  for (const p of living) {
    const tourism = tourismOf(game, p);
    for (const them of living) if (them !== p) p.tourism[them.index] = (p.tourism[them.index] ?? 0) + tourismToward(game, p, them, tourism);
  }
  spyTurn(game, eraOf);
  if (game.over) return;
  const v = game.settings.victories;
  // Culture: influential over every other civ (its teammates aside: a team wins together), from the
  // Industrial Era (before it, a civ's sway over neighbours who make little culture would win the world
  // too early).
  if (v.culture && living.length > 1)
    for (const p of living)
      if (eraOf(p) >= CULTURE_ERA && living.some((them) => them !== p && !teammates(game, p.index, them.index)) && living.every((them) => them === p || teammates(game, p.index, them.index) || influence(p, them) >= 1)) {
        game.over = { winner: p.index, how: 'culture' };
        noteAll(game, { text: `${p.name}'s culture has conquered the world: a cultural victory${p.team === undefined ? '' : ` for ${sideName(p)}`}!`, kind: 'good' });
        return;
      }
  // Science: the spaceship built.
  if (v.science)
    for (const p of living)
      if (spaceshipDone(p)) {
        game.over = { winner: p.index, how: 'science' };
        noteAll(game, { text: `${p.name}'s spaceship has left for the stars: a science victory${p.team === undefined ? '' : ` for ${sideName(p)}`}!`, kind: 'good' });
        return;
      }
  // Diplomatic: while the United Nations stands (not razed), a vote for World Leader every ten turns.
  const un = game.wonders['united_nations'];
  if (v.diplomatic && un !== undefined && un >= 0 && game.turn % 10 === 0) {
    const { votes, needed } = unVote(game, allyOf);
    const [[winner, n], runnerUp] = [...votes.entries()].sort((a, b) => b[1] - a[1]).concat([[-1, 0], [-1, 0]]);
    noteAll(game, { text: `The United Nations votes for World Leader: ${[...votes.entries()].map(([k, x]) => `${game.players[k].name}: ${x} vote${x === 1 ? '' : 's'}`).join(', ')} (${needed} needed).`, kind: 'info' });
    // (Half the world's delegates, and more than anyone else: two at half each is no one's.)
    if (winner >= 0 && n >= needed && n > runnerUp[1]) {
      game.over = { winner, how: 'diplomatic' };
      noteAll(game, { text: `${game.players[winner].name} is elected World Leader: a diplomatic victory${game.players[winner].team === undefined ? '' : ` for ${sideName(game.players[winner])}`}!`, kind: 'good' });
    }
  }
}
