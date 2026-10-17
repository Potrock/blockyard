import { knows } from '../core';
import { canFound } from '../game';
import { freshWater, tileYields } from '../economy';
import { neighbours, within } from '../hex';
import type { Unit } from '../state';
import { teamOf } from '../teams';
import { RESOURCES, TERRAINS } from '../terrain';
import { act, cityOn, civilianAt, coastal, danger, dist, goTo, militaryAt, sameLand, seaRoute, type Ctx } from './context';

/**
 * Where to found cities: each land tile's worth as a city site (its land's food and production, fresh
 * water, the coast, a hill to stand on, luxuries, strategic resources and natural wonders); then, for
 * each bot, the sites still open to it (not too near another city, not in another's land, not where
 * enemies roam; on its own land or, with Optics, a coast over the water), nearer home better, new
 * luxuries better still. Settlers go to the best and found there, and wait in a city while barbarians
 * are about.
 */

/** What a site's tile of two food or more counts beyond its yields, for each food past the first (`FOOD_BONUS`: tests and scripts may set it). */
export let FOOD_BONUS = 2.5;
export const setFoodBonus = (n: number) => (FOOD_BONUS = n);

/** A land tile's worth as a city site (the land within reach, its water, natural wonders, the tile itself); -Infinity where no city can stand. Worked out as the map is now, once a turn. */
export function siteValue(ctx: Ctx, t: number): number {
  const cache = (ctx.cache.sites ??= new Map());
  const known = cache.get(t);
  if (known !== undefined) return known;
  const { game } = ctx;
  const tile = game.tiles[t];
  let s = -Infinity;
  if (!TERRAINS[tile.terrain].water && tile.elevation !== 'mountain' && tile.feature !== 'ice' && tile.terrain !== 'snow' && !tile.wonder) {
    s = 0;
    let water = 0;
    const next = neighbours(game.grid, t);
    for (const x of within(game.grid, t, 2)) {
      if (x === t) continue;
      const o = game.tiles[x];
      const y = tileYields(game, x, null);
      // Food above all for a city to grow on: a tile that feeds its worker and more counts extra.
      const food = y.food ?? 0;
      s += (food * 1.6 + Math.max(0, food - 1) * FOOD_BONUS + (y.prod ?? 0) * 1.2 + (y.gold ?? 0) * 0.5) * (next.includes(x) ? 1.2 : 1);
      if (TERRAINS[o.terrain].water) water++;
      const r = o.resource && RESOURCES[o.resource];
      if (r) s += r.kind === 'luxury' ? 4 : r.kind === 'strategic' ? 2.5 : 1.5;
      if (o.elevation === 'mountain' && !o.wonder) s -= 0.5;
      // A natural wonder: its yields (its science, culture and faith too), and the land's pride in it.
      if (o.wonder) s += 3 + (y.science ?? 0) + (y.culture ?? 0) + (y.faith ?? 0);
    }
    if (freshWater(game, t)) s += 6;
    if (next.some((n) => game.tiles[n].terrain === 'coast')) s += 3;
    if (tile.elevation === 'hills') s += 3;
    // Mostly sea is a poor city (water tiles give little until harbours).
    if (water > 10) s -= (water - 10) * 1.5;
  }
  cache.set(t, s);
  return s;
}

/** The best site for a bot's next city from `from` (with its score), or none worth it. */
export function bestSite(ctx: Ctx, from: number, settler?: Unit): { tile: number; score: number } | null {
  const { game, p } = ctx;
  const d = danger(ctx);
  const taken = new Set(Object.entries(ctx.mem.orders).filter(([id, o]) => o.why === 'settle' && Number(id) !== settler?.id).map(([, o]) => o.to));
  // (Where a teammate's settlers are headed is theirs: not raced for.)
  const theirs = teamOf(game, ctx.me).filter((m) => m !== p && m.ai).flatMap((m) => Object.values(m.ai!.orders).filter((o) => o.why === 'settle').map((o) => o.to));
  const mine = new Set(ctx.cities.map((c) => c.tile));
  const haveLux = new Set<string>();
  for (const tile of game.tiles) if (tile.owner === ctx.me && tile.resource && RESOURCES[tile.resource].kind === 'luxury') haveLux.add(tile.resource);
  let best: { tile: number; score: number } | null = null;
  const reach = ctx.cities.length ? 12 : 4;
  for (const t of within(game.grid, from, reach)) {
    if (!p.explored[t] || !canFound(game, t) || !Number.isFinite(siteValue(ctx, t))) continue;
    const tile = game.tiles[t];
    if (tile.owner >= 0 && tile.owner !== ctx.me) continue;
    // Over the water (with Optics, to embark): a site on the coast of other land, worth a little less for the voyage.
    const overseas = !sameLand(game, from, t) && !settler?.embarked;
    if (overseas && !(knows(p, 'optics') && coastal(game, t))) continue;
    if (taken.has(t) || tile.camp || theirs.some((x) => dist(ctx, x, t) < 4)) continue;
    // Three tiles from its own cities (closer packed, as Civ V's bots do), four from anyone else's.
    let near = Infinity;
    for (const c of game.cities) near = Math.min(near, dist(ctx, c.tile, t) + (mine.has(c.tile) ? 1 : 0));
    if (near < 4) continue;
    let s = siteValue(ctx, t);
    // Land someone else holds (or will) isn't ours to work; new luxuries are worth more.
    for (const x of within(game.grid, t, 2)) {
      const o = game.tiles[x];
      if (o.owner >= 0 && o.owner !== ctx.me) s -= 3;
      else if (o.owner === ctx.me) s -= 1;
      if (o.resource && RESOURCES[o.resource].kind === 'luxury' && !haveLux.has(o.resource) && o.owner < 0) s += 5;
      if (o.camp) s -= 6;
    }
    const home = ctx.cities.length ? Math.min(...ctx.cities.map((c) => dist(ctx, c.tile, t))) : 0;
    s -= dist(ctx, from, t) * 1.2 + Math.max(0, home - 5) * 3;
    if (d[t] > 0) s -= 8;
    if (overseas) s -= 4;
    if (best && s <= best.score) continue;
    // (A way there by sea, looked for only when the site would do.)
    if (overseas && !seaRoute(game, p, from, t)) continue;
    best = { tile: t, score: s };
  }
  return best;
}

/** The worth a site must have to be worth a settler. */
export const SITE_WORTH = 22;

/** A settler: found the first city where it stands; later ones at the best site, waiting while it's dangerous. */
export function settle(ctx: Ctx, u: Unit) {
  const { game, mem } = ctx;
  if (!ctx.cities.length && canFound(game, u.tile)) {
    // The first city: here, unless the tile next door is clearly better (a river, the coast, a hill).
    const here = siteValue(ctx, u.tile);
    const better = game.turn <= 2 ? neighbours(game.grid, u.tile).filter((t) => canFound(game, t) && siteValue(ctx, t) > here + 6 && !militaryAt(ctx, t)).sort((a, b) => siteValue(ctx, b) - siteValue(ctx, a))[0] : undefined;
    if (better === undefined || (goTo(ctx, u, better, 'settle') && canFound(game, u.tile))) act(ctx, { t: 'found', unit: u.id });
    return;
  }
  const goal = mem.orders[u.id];
  if (goal && goal.to === u.tile && canFound(game, u.tile) && (game.tiles[u.tile].owner < 0 || game.tiles[u.tile].owner === ctx.me)) {
    delete mem.orders[u.id];
    return void act(ctx, { t: 'found', unit: u.id });
  }
  // Danger on the way: wait in (or go back to) a city until the escort or the garrison deals with it.
  const d = danger(ctx);
  if (d[u.tile] > 0 && !militaryAt(ctx, u.tile)) {
    const refuge = ctx.cities.filter((c) => !civilianAt(ctx, c.tile) || civilianAt(ctx, c.tile) === u).sort((a, b) => dist(ctx, a.tile, u.tile) - dist(ctx, b.tile, u.tile))[0];
    if (refuge && refuge.tile !== u.tile && dist(ctx, refuge.tile, u.tile) <= 3) {
      goTo(ctx, u, refuge.tile, 'refuge');
      if (goal?.why === 'settle') mem.orders[u.id] = goal;
      return;
    }
  }
  // Keep going where it was headed, if that's still good.
  if (goal && goal.why === 'settle' && canFound(game, goal.to) && (game.tiles[goal.to].owner < 0 || game.tiles[goal.to].owner === ctx.me) && !cityOn(ctx, goal.to)) {
    if (u.moves <= 0) return;
    if (goTo(ctx, u, goal.to, 'settle')) return void act(ctx, { t: 'found', unit: u.id });
    if (mem.orders[u.id]) return;
  }
  const site = bestSite(ctx, u.tile, u);
  if (!site || site.score < SITE_WORTH * 0.6) {
    delete mem.orders[u.id];
    // Nowhere good: found where it stands if that's allowed and not poor land, rather than wander forever.
    const owner = game.tiles[u.tile].owner;
    if (canFound(game, u.tile) && (owner < 0 || owner === ctx.me) && siteValue(ctx, u.tile) > SITE_WORTH * 0.5) act(ctx, { t: 'found', unit: u.id });
    return;
  }
  if (goTo(ctx, u, site.tile, 'settle')) act(ctx, { t: 'found', unit: u.id });
}
