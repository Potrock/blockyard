import { BUILDINGS } from '../buildings';
import { citiesOf } from '../core';
import { cityYields } from '../economy';
import { cannotHold, isProject, openProject, PROJECT_IDS, projectTotal, type ProjectId, type Tier, TIERS } from '../projects';
import type { City, Game, Player, Production } from '../state';
import { teammates } from '../teams';
import { majors } from '../trade';
import type { Ctx } from './context';
import { threatTo } from './production';
import { yieldsOf } from './value';

/**
 * The bots and the World Congress's international projects. A bot reckons where it would come in a
 * project (what it has put in, and what its three strongest cities could put in besides, against the
 * other civs'): it proposes and votes for one it would take gold or silver at (or one its aim wants,
 * culture the World's Fair and the Games, science the Space Station, where it would place), and
 * against one a rival it fears would win while it came nowhere. Once one is open, it plans for it
 * (`projectPlan`): the tier worth the most for the cities it takes, and those of its cities that can
 * spare their production put it in (switching to it, their builds kept), and move on once they've
 * done their part; never one in danger, and one at most at war.
 */

/** What a civ could put into a project in a turn: its three strongest cities' production (worked out once a turn). */
const capacities = new WeakMap<Game, { turn: number; of: Map<number, number> }>();
function capacity(game: Game, p: Player): number {
  let memo = capacities.get(game);
  if (!memo || memo.turn !== game.turn) capacities.set(game, (memo = { turn: game.turn, of: new Map() }));
  let n = memo.of.get(p.index);
  if (n === undefined) {
    const prods = citiesOf(game, p.index).filter((c) => !c.puppet).map((c) => cityYields(game, c, 0).prod).sort((a, b) => b - a);
    memo.of.set(p.index, (n = prods.slice(0, 3).reduce((s, x) => s + x, 0)));
  }
  return n;
}

/** Where each civ would likely place in a project (open or not): what it's put in, and ten turns of its strongest cities besides. */
function standings(game: Game, id: ProjectId): number[] {
  const put = openProject(game, id)?.put ?? {};
  return majors(game)
    .filter((o) => o.alive)
    .map((o) => ({ i: o.index, n: (put[o.index] ?? 0) + capacity(game, o) * 10 }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((e) => e.i);
}

/** The tier the bot expects at a project (null: not in the top three, or it hasn't the cities). */
export function expectedTier(game: Game, p: Player, id: ProjectId): Tier | null {
  const rank = standings(game, id).indexOf(p.index);
  return rank < 0 ? null : (TIERS[rank] ?? null);
}

/** Whether a project's aim is the bot's: culture the World's Fair and the Games, science the Space Station. */
const aimed = (p: Player, id: ProjectId) => (id === 'space_station' ? p.ai?.aim === 'science' : p.ai?.aim === 'culture');

/** Whether a project would serve the bot: gold or silver for it, or bronze at one its aim wants. */
export function projectServes(game: Game, p: Player, id: ProjectId): boolean {
  const tier = expectedTier(game, p, id);
  return tier === 'gold' || tier === 'silver' || (tier === 'bronze' && aimed(p, id));
}

/** Whether a project would hurt the bot: a rival it fears (`feared`) would take gold, and it nothing better than bronze. */
export function projectHurts(game: Game, p: Player, id: ProjectId, feared: (o: Player) => boolean): boolean {
  const first = game.players[standings(game, id)[0]];
  if (!first || first === p || teammates(game, p.index, first.index)) return false;
  return feared(first) && !projectServes(game, p, id);
}

/** The projects the bot might put to the session, those it would do well at first. */
export function projectProposals(game: Game, p: Player): ProjectId[] {
  return PROJECT_IDS.filter((id) => !cannotHold(game, id) && projectServes(game, p, id)).sort((a, b) => TIERS.indexOf(expectedTier(game, p, a)!) - TIERS.indexOf(expectedTier(game, p, b)!));
}

/** What each civ's cities on an open project put into it a turn (worked out once a turn). */
const rates = new WeakMap<Game, { turn: number; of: Map<string, number> }>();
function rateOf(game: Game, o: Player, id: ProjectId): number {
  let memo = rates.get(game);
  if (!memo || memo.turn !== game.turn) rates.set(game, (memo = { turn: game.turn, of: new Map() }));
  const key = `${o.index}:${id}`;
  let n = memo.of.get(key);
  if (n === undefined) memo.of.set(key, (n = citiesOf(game, o.index).filter((c) => onProject(c, id)).reduce((s, c) => s + cityYields(game, c, 0).prod, 0)));
  return n;
}

const onProject = (c: City, id: string) => c.queue[0]?.kind === 'project' && c.queue[0].id === id;

/** Whether a city is busy with something grand of its own: a world wonder, the Apollo Program, a spaceship part, another project. */
const grandBusy = (c: City, id: string) => {
  const q = c.queue[0];
  return !!q && !onProject(c, id) && (q.kind === 'project' || (q.kind === 'building' && (BUILDINGS[q.id]?.kind === 'world' || q.id === 'apollo_program')));
};

/** The turns a bot will wait for the others to finish a project it puts nothing more into, to have its reward. */
const PROJECT_HORIZON = 30;

/** What each tier is worth to the bot, against what each city it puts in costs it. */
const TIER_WORTH: Record<Tier, number> = { gold: 4, silver: 2.5, bronze: 1 };

/** The bot's plan for an open project: the tier it goes for, and the cities that put production into it (none: it's not worth it, or it has its tier already). */
export interface ProjectPlan {
  tier: Tier | null;
  cities: City[];
}

/**
 * How the bot goes about an open project, as Civ V's leaders weigh one: where it would finish with
 * each number of its cities on it (its best that can spare their production: not one in danger, of
 * little production, or busy with a wonder) against the others (what they've put in, and what their
 * cities on it put in a turn, until it's done); the tier worth the most for the cities it takes. So
 * the civs race for gold and silver, and the rest drop out once they can't win them. Bronze needs but
 * a twentieth of the cost: one city, until it has it; gold and silver a few, more for a project its
 * aim wants (a third of its cities, a half for its aim); at war, one city at most. Cities already on
 * it cost less to keep there.
 */
export function projectPlan(ctx: Ctx, id: ProjectId): ProjectPlan {
  const plans = (ctx.cache.projects ??= new Map());
  const known = plans.get(id);
  if (known) return known;
  const { game, p } = ctx;
  const x = openProject(game, id);
  const plan: ProjectPlan = { tier: null, cities: [] };
  plans.set(id, plan);
  if (!x || p.cityState) return plan;
  const own = ctx.cities.filter((c) => !c.puppet);
  const best = Math.max(0, ...own.map((c) => yieldsOf(ctx, c).prod));
  const ready = own
    .filter((c) => yieldsOf(ctx, c).prod >= best / 5 && !grandBusy(c, id) && threatTo(ctx, c) <= 0.2)
    .sort((a, b) => yieldsOf(ctx, b).prod * (onProject(b, id) ? 1.25 : 1) - yieldsOf(ctx, a).prod * (onProject(a, id) ? 1.25 : 1));
  const left = Math.max(0, x.cost - projectTotal(x));
  const bronze = x.cost / 20;
  const others = majors(game)
    .filter((o) => o.alive && o !== p)
    .map((o) => ({ put: x.put[o.index] ?? 0, rate: rateOf(game, o, id) }));
  const othersRate = others.reduce((s, o) => s + o.rate, 0);
  const n = own.length;
  const cap = ctx.wars.length ? 1 : aimed(p, id) ? Math.ceil(n / 2) : Math.max(1, Math.ceil(n / 3));
  const mine = x.put[ctx.me] ?? 0;
  let worth = -Infinity;
  let rate = 0;
  let cost = 0;
  for (let k = 0; k <= Math.min(cap, ready.length); k++) {
    if (k > 0) {
      const c = ready[k - 1];
      rate += yieldsOf(ctx, c).prod;
      cost += onProject(c, id) ? 0.35 : ctx.wars.length ? 1.5 : 0.7;
    }
    // (Nobody putting anything in: never done.)
    const turns = othersRate + rate > 0 ? left / (othersRate + rate) : Infinity;
    const end = mine + (rate > 0 ? rate * turns : 0);
    const theirs = others.map((o) => o.put + (o.rate > 0 ? o.rate * turns : 0));
    const ahead = theirs.filter((t) => t > end && t >= bronze).length;
    // (No reward till it's done: one left to the others must be finished by them, and soon.)
    const tier = end < bronze || (rate === 0 && turns > PROJECT_HORIZON) ? null : (TIERS[Math.min(ahead, 2)] as Tier);
    const w = (tier ? TIER_WORTH[tier] * (aimed(p, id) ? 1.5 : 1) : 0) - cost;
    if (w > worth) {
      worth = w;
      plan.tier = tier;
      plan.cities = ready.slice(0, k);
    }
  }
  return plan;
}

/**
 * What a city puts into an open project: it does if it's one of the cities the bot's plan for it
 * wants (`projectPlan`), and isn't in danger.
 */
export function worldProject(ctx: Ctx, c: City, threat: number): Production | null {
  const { game, p } = ctx;
  if (p.cityState || c.puppet || threat > 0.2) return null;
  for (const id of PROJECT_IDS) if (openProject(game, id) && projectPlan(ctx, id).cities.includes(c)) return { kind: 'project', id };
  return null;
}

/** Whether a city putting its production into a project has done its part (the bot's plan no longer wants it there): it moves on. */
export function leavesProject(ctx: Ctx, c: City): boolean {
  const q = c.queue[0];
  return q?.kind === 'project' && isProject(q.id) && !!openProject(ctx.game, q.id) && !projectPlan(ctx, q.id).cities.includes(c);
}
