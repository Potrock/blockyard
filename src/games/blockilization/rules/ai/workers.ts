import { cityById, knows, seesResource } from '../core';
import { canBuild, seaWork, type BuildWhat } from '../game';
import { freshWater, workable } from '../economy';
import { line, neighbours, within } from '../hex';
import type { Unit } from '../state';
import { IMPROVEMENTS, RESOURCES, tapped, tapsWith, TERRAINS, type ImprovementId, type Yields } from '../terrain';
import { act, cityOn, civilianAt, danger, dist, goTo, nearestCity, passable, type Ctx } from './context';
import { yieldWeights } from './value';

/**
 * Workers: each turn the bot lists the work its land needs (a new luxury or strategic resource first,
 * then the tiles its cities work, then the rest), and each worker takes the best job near it that no
 * other has; with that done, roads between neighbouring cities when the treasury can keep them up.
 * Workers keep out of reach of enemies. Work boats fish the sea's resources.
 */

export interface Job {
  tile: number;
  what: BuildWhat;
  value: number;
  /** A young city's (workers come further for it). */
  young?: boolean;
}

/** What an improvement adds to a tile (its own yields, a resource's, and the techs that improve it). */
function gain(ctx: Ctx, t: number, imp: ImprovementId): Yields {
  const tile = ctx.game.tiles[t];
  const y: Yields = { ...IMPROVEMENTS[imp].yields };
  if (tile.resource && seesResource(ctx.p, tile.resource) && tapsWith(tile) === imp) for (const [k, v] of Object.entries(RESOURCES[tile.resource].improved)) y[k as keyof Yields] = (y[k as keyof Yields] ?? 0) + (v ?? 0);
  if (imp === 'farm' && (knows(ctx.p, 'fertilizer') || (freshWater(ctx.game, t) && knows(ctx.p, 'civil_service')))) y.food = (y.food ?? 0) + 1;
  if ((imp === 'mine' || imp === 'quarry') && knows(ctx.p, 'chemistry')) y.prod = (y.prod ?? 0) + 1;
  if (imp === 'trading_post' && knows(ctx.p, 'economics')) y.gold = (y.gold ?? 0) + 1;
  if (imp === 'lumber_mill' && knows(ctx.p, 'scientific_theory')) y.prod = (y.prod ?? 0) + 1;
  return y;
}

/** The best work on one of the bot's tiles for a worker, and its worth (null: nothing to do). Read too by the advisor's recommendations to people (`advisor.ts`). */
export function jobFor(ctx: Ctx, worker: Unit, t: number, worked: Set<number>, luxNeeded: Set<string>, w = yieldWeights(ctx)): Job | null {
  const tile = ctx.game.tiles[t];
  const at = { ...worker, tile: t };
  // A young city's food first (it grows into the rest): its farms and food resources count up to twice.
  const city = tile.city !== undefined ? cityById(ctx.game, tile.city) : undefined;
  const young = city && city.pop < 5 ? (5 - city.pop) * 0.25 : 0;
  const value = (y: Yields) => (y.food ?? 0) * w.food * (1 + young) + (y.prod ?? 0) * w.prod + (y.gold ?? 0) * w.gold + (y.science ?? 0) * w.science + (y.culture ?? 0) * w.culture + (y.faith ?? 0) * w.faith;
  const scale = worked.has(t) ? 1.6 : 0.8;
  if (tile.pillaged) return { tile: t, what: 'repair', value: 6 * scale, young: young > 0 };
  if (tile.improvement) return null;
  const r = tile.resource && seesResource(ctx.p, tile.resource) ? RESOURCES[tile.resource] : null;
  const taps = r ? tapsWith(tile)! : undefined;
  if (r && taps && canBuild(ctx.game, at, taps)) {
    const extra = r.kind === 'luxury' ? (luxNeeded.has(tile.resource!) ? 14 * w.happiness : 2) : r.kind === 'strategic' ? 7 : 1;
    return { tile: t, what: taps, value: value(gain(ctx, t, taps)) * scale + extra, young: young > 0 };
  }
  // A resource whose improvement needs the feature cleared first (none do now) or a tech not known: leave it.
  if (r && r.kind !== 'bonus') return null;
  const options: BuildWhat[] = [];
  if (tile.elevation === 'hills') options.push('mine', 'farm');
  else if (tile.feature === 'forest') options.push('lumber_mill');
  else if (tile.feature === 'jungle' || tile.feature === 'marsh') options.push('remove_feature');
  else options.push('farm', 'trading_post');
  let best: Job | null = null;
  for (const what of options) {
    if (!canBuild(ctx.game, at, what)) continue;
    let v: number;
    if (what === 'remove_feature') v = (tile.feature === 'marsh' ? 1.5 : 1) * w.food * scale * 0.8;
    else v = value(gain(ctx, t, what as ImprovementId)) * scale;
    // Desert and tundra farms are poor: trading posts there.
    if (what === 'farm' && (tile.terrain === 'desert' && tile.feature !== 'floodplains')) v *= 0.4;
    if (!best || v > best.value) best = { tile: t, what, value: v, young: young > 0 };
  }
  return best;
}

/** The road tiles that would join each city to its nearest neighbour (straight, over the bot's own or open land). */
function roadPlan(ctx: Ctx): number[] {
  const out: number[] = [];
  const { game } = ctx;
  for (const c of ctx.cities) {
    const other = nearestCity(ctx, c.tile, ctx.cities.filter((x) => x !== c));
    if (!other || other.id < c.id || dist(ctx, c.tile, other.tile) > 7) continue;
    const way = line(game.grid, c.tile, other.tile);
    const ok = way.every((t) => {
      const tile = game.tiles[t];
      return !TERRAINS[tile.terrain].water && tile.elevation !== 'mountain' && (tile.owner === ctx.me || tile.owner < 0);
    });
    if (ok) for (const t of way) if (!game.tiles[t].road && !cityOn(ctx, t)) out.push(t);
  }
  return out;
}

/** Turns the land round a worker taken is shunned. */
const LOST_TURNS = 15;

/** Every worker's turn: the best free job, safely. */
export function workers(ctx: Ctx, list: Unit[]) {
  if (!list.length) return;
  const { game, mem } = ctx;
  const d = Float32Array.from(danger(ctx));
  // Where a worker was taken lately (by an enemy perhaps never seen): the land round it is shunned for a while.
  const lost = (mem.lost = (mem.lost ?? []).filter((l) => game.turn - l.turn < LOST_TURNS));
  for (const [id, tile] of Object.entries(mem.crew ?? {})) {
    const u = game.units.find((x) => x.id === Number(id));
    if (!u || u.owner !== ctx.me) lost.push({ tile: u?.tile ?? tile, turn: game.turn });
  }
  for (const l of lost) for (const t of within(game.grid, l.tile, 2)) d[t] += 5;
  const worked = new Set<number>();
  const tiles = new Set<number>();
  for (const c of ctx.cities) {
    for (const t of c.worked) worked.add(t);
    for (const t of workable(game, c)) tiles.add(t);
  }
  const owned = new Set<string>();
  for (const t of tiles) {
    const tile = game.tiles[t];
    if (tile.resource && tapped(tile)) owned.add(tile.resource);
  }
  for (const c of ctx.cities) {
    const r = game.tiles[c.tile].resource;
    if (r) owned.add(r);
  }
  const luxNeeded = new Set<string>();
  for (const t of tiles) {
    const r = game.tiles[t].resource;
    if (r && RESOURCES[r].kind === 'luxury' && !owned.has(r)) luxNeeded.add(r);
  }
  const busy = new Set<number>();
  for (const u of list) if (u.work) busy.add(u.tile);
  for (const [id, o] of Object.entries(mem.orders)) if (o.why === 'work' && list.some((u) => u.id === Number(id))) busy.add(o.to);
  const roads = knows(ctx.p, 'the_wheel') && ctx.income >= 3 + ctx.cities.length && ctx.p.gold > 40 ? roadPlan(ctx) : [];
  const jobs: Job[] = [];
  // (What each yield's worth to it, worked out once for all the jobs.)
  const weights = yieldWeights(ctx);
  for (const t of tiles) {
    if (d[t] > 0) continue;
    const job = jobFor(ctx, list[0], t, worked, luxNeeded, weights);
    if (job) jobs.push(job);
  }
  for (const u of list) {
    if (u.moves <= 0) continue;
    // Enemies near: to the nearest city, and wait (with none free, to the tile nearby least in reach).
    if (d[u.tile] > 0 && !cityOn(ctx, u.tile)) {
      const refuge = ctx.cities.filter((c) => !civilianAt(ctx, c.tile)).sort((a, b) => dist(ctx, a.tile, u.tile) - dist(ctx, b.tile, u.tile))[0];
      if (refuge) {
        goTo(ctx, u, refuge.tile, 'refuge');
        continue;
      }
      const away = within(game.grid, u.tile, 2).filter((t) => d[t] < d[u.tile] && passable(ctx, u, t) && !TERRAINS[game.tiles[t].terrain].water).sort((a, b) => d[a] - d[b])[0];
      if (away !== undefined) {
        goTo(ctx, u, away, 'refuge');
        continue;
      }
    }
    if (u.work) continue;
    const mine = mem.orders[u.id];
    if (mine) busy.delete(mine.to);
    let best: Job | null = null;
    let bestScore = -Infinity;
    for (const job of jobs) {
      if (busy.has(job.tile) || (civilianAt(ctx, job.tile) && civilianAt(ctx, job.tile) !== u)) continue;
      const far = dist(ctx, u.tile, job.tile);
      if (far > (job.young ? 16 : 12)) continue;
      const score = job.value - far * (job.young ? 0.35 : 0.7);
      if (score > bestScore) (bestScore = score), (best = job);
    }
    if (!best && roads.length) {
      const t = roads.filter((x) => !busy.has(x) && d[x] === 0 && canBuild(game, { ...u, tile: x }, 'road')).sort((a, b) => dist(ctx, a, u.tile) - dist(ctx, b, u.tile))[0];
      if (t !== undefined) best = { tile: t, what: 'road', value: 1 };
    }
    if (!best) {
      delete mem.orders[u.id];
      // (Nothing to do: out of a city, where it would keep another civilian from it, to the land beside it, out of reach.)
      if (cityOn(ctx, u.tile) && d[u.tile] === 0) {
        const aside = neighbours(game.grid, u.tile).find((t) => game.tiles[t].owner === ctx.me && !d[t] && !cityOn(ctx, t) && !TERRAINS[game.tiles[t].terrain].water && passable(ctx, u, t));
        if (aside !== undefined) act(ctx, { t: 'move', unit: u.id, to: aside });
      }
      continue;
    }
    busy.add(best.tile);
    if (best.tile === u.tile) {
      delete mem.orders[u.id];
      act(ctx, { t: 'build', unit: u.id, what: best.what });
      continue;
    }
    if (goTo(ctx, u, best.tile, 'work', d) && u.moves > 0) act(ctx, { t: 'build', unit: u.id, what: best.what });
  }
  mem.crew = Object.fromEntries(list.map((u) => [u.id, u.tile]));
}

/** Work boats: to the nearest unimproved sea resource in the bot's waters, and fish it. */
export function workBoats(ctx: Ctx, list: Unit[]) {
  const { game } = ctx;
  const taken = new Set<number>();
  for (const u of list) {
    if (u.moves <= 0) continue;
    const targets: number[] = [];
    for (const c of ctx.cities)
      for (const t of workable(game, c)) {
        const tile = game.tiles[t];
        if (!taken.has(t) && (!tile.improvement || tile.improvement === 'oil_well') && seaWork(game, ctx.p, t)) targets.push(t);
      }
    const t = targets.sort((a, b) => dist(ctx, a, u.tile) - dist(ctx, b, u.tile))[0];
    if (t === undefined) continue;
    taken.add(t);
    if (goTo(ctx, u, t, 'fish')) act(ctx, { t: 'build', unit: u.id, what: seaWork(game, ctx.p, t)! });
  }
}
