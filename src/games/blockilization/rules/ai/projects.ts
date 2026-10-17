import { citiesOf } from '../core';
import { cityYields } from '../economy';
import { cannotHold, openProject, PROJECT_IDS, type ProjectId, type Tier, TIERS } from '../projects';
import type { City, Game, Player, Production } from '../state';
import { teammates } from '../teams';
import { majors } from '../trade';
import type { Ctx } from './context';
import { yieldsOf } from './value';

/**
 * The bots and the World Congress's international projects. A bot reckons where it would come in a
 * project (what it has put in, and what its three strongest cities could put in besides, against the
 * other civs'): it proposes and votes for one it would take gold or silver at (or one its aim wants,
 * culture the World's Fair and the Games, science the Space Station, where it would place), and
 * against one a rival it fears would win while it came nowhere. Once one is open, its cities that can
 * spare their production put it in: a few for gold or silver, one for bronze in a wider empire; never
 * one in danger, and fewer at war.
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

/** How many of its cities the bot puts into an open project: a few for gold or silver (one more for its aim), one for bronze in an empire of four or more; fewer at war. */
function cityShare(ctx: Ctx, id: ProjectId): number {
  const tier = expectedTier(ctx.game, ctx.p, id);
  const n = ctx.cities.filter((c) => !c.puppet).length;
  let want = tier === 'gold' || tier === 'silver' ? Math.max(1, Math.floor(n / 3)) + (aimed(ctx.p, id) ? 1 : 0) : n >= 4 ? 1 : 0;
  if (ctx.wars.length) want = Math.floor(want / 2);
  return want;
}

/**
 * What a city puts into an open project, if it can spare it: not one in danger, nor one of little
 * production, and only until the empire has its share of cities on it.
 */
export function worldProject(ctx: Ctx, c: City, threat: number): Production | null {
  const { game, p } = ctx;
  if (p.cityState || c.puppet || threat > 0.2) return null;
  for (const id of PROJECT_IDS) {
    const x = openProject(game, id);
    if (!x) continue;
    const on = ctx.cities.filter((o) => o !== c && o.queue[0]?.kind === 'project' && o.queue[0].id === id).length;
    if (on >= cityShare(ctx, id)) continue;
    // (Not a city of too little use to it: a fifth of the strongest's production at least.)
    const best = Math.max(...ctx.cities.map((o) => yieldsOf(ctx, o).prod));
    if (yieldsOf(ctx, c).prod < best / 5) continue;
    return { kind: 'project', id };
  }
  return null;
}
