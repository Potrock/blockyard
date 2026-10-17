import { airBase, isAircraft } from '../air';
import { bombInterceptChance, nukeHits, rangeOf } from '../combat';
import { inForce } from '../congress';
import { civEffects, has, knows, knowsOf, random } from '../core';
import { strategic } from '../economy';
import { constructible, itemCost, productionToward, trainable } from '../game';
import { within } from '../hex';
import type { City, Production, Unit } from '../state';
import { isMilitary, UNITS } from '../units';
import { frontCity } from './air';
import { act, cityOn, dist, mightOf, unitMight, type Ctx } from './context';

/**
 * The bots' nuclear weapons, Civ V's way: rare. A bot at war with a civ, that knows Nuclear Fission and
 * has Uranium to spare, may raise the Manhattan Project and keep a small stockpile (one or two; more
 * for a conqueror, or one losing its war badly). It fires one only at a target worth the world's
 * lasting anger (`diplomacy.nuclearStrike`): an enemy city ringed by its army, or a great stack of the
 * enemy's near one of its own cities. It never strikes where its own units or cities would burn, nor
 * where the rules would refuse the strike (anyone in the blast not at war with it). A peaceful or
 * diplomatic leader builds them only when losing badly, and fires them only for the very best targets.
 */

export const isNuke = (type: string) => !!UNITS[type]?.abilities?.includes('nuke');

/** How much a strike must be worth, at the least, before a leader of middling character fires. */
export const NUKE_WORTH = 200;

/** The civs (not city-states, not barbarians) the bot is at war with. */
const majorWars = (ctx: Ctx) => ctx.wars.filter((o) => !ctx.game.players[o].cityState);

/** Whether the bot is losing its wars badly: the enemy's armies well beyond its own, or cities lost since they began. */
export function losingBadly(ctx: Ctx): boolean {
  const foes = majorWars(ctx);
  if (!foes.length) return false;
  const theirs = foes.reduce((s, o) => s + mightOf(ctx, o), 0);
  if (theirs > mightOf(ctx, ctx.me) * 1.6) return true;
  return foes.some((o) => {
    const w = ctx.mem.wars[o];
    return !!w && ctx.cities.length <= w.myCities - 2;
  });
}

/** Whether the leader is a peaceful or diplomatic one (who builds and fires them only in dire need). */
const peaceful = (ctx: Ctx) => ctx.pers.offense <= 3 || ctx.mem.aim === 'diplomatic';

/** How many nuclear weapons the bot wants to keep (0: none). */
export function nukesWanted(ctx: Ctx): number {
  const { game, p, pers, mem } = ctx;
  if (p.cityState || mem.passive || !majorWars(ctx).length || ctx.income < 0) return 0;
  if (!knows(p, 'nuclear_fission') || inForce(game, 'non_proliferation')) return 0;
  const uranium = strategic(game, p).uranium;
  if (!uranium?.have) return 0;
  const losing = losingBadly(ctx);
  if (peaceful(ctx) && !losing) return 0;
  return Math.min(4, 1 + (pers.offense >= 6 ? 1 : 0) + (mem.aim === 'domination' ? 1 : 0) + (losing ? 1 : 0));
}

/** The bot's nuclear weapons, and those its cities are building (not counting `except`). */
function stockpile(ctx: Ctx, except?: City): number {
  return ctx.game.units.filter((u) => u.owner === ctx.me && isNuke(u.type)).length + ctx.cities.filter((x) => x !== except && x.queue[0]?.kind === 'unit' && isNuke(x.queue[0].id)).length;
}

/**
 * What a city should build toward the bot's stockpile, if anything: the Manhattan Project first (in one
 * of its best cities, now and then, if it would be done in good time), then a weapon (the Nuclear Missile when it
 * can), one city at a time.
 */
export function nukeProduction(ctx: Ctx, c: City): Production | null {
  const { game, p } = ctx;
  if (c.puppet) return null;
  const want = nukesWanted(ctx);
  if (!want) return null;
  if (!has(civEffects(game, p), 'enables_nukes')) {
    if (ctx.cities.some((x) => x.queue[0]?.kind === 'building' && x.queue[0].id === 'manhattan_project')) return null;
    const item: Production = { kind: 'building', id: 'manhattan_project' };
    // (One of its three best cities for it, as one comes free.)
    const best = ctx.cities.filter((x) => !x.puppet).sort((a, b) => productionToward(game, b, item) - productionToward(game, a, item));
    if (!best.slice(0, 3).includes(c) || !constructible(game, p, c).includes('manhattan_project')) return null;
    const turns = itemCost(game, item) / Math.max(1, productionToward(game, c, item));
    // (Not every war: a warlike leader, a conqueror or one losing badly goes for it more often.)
    const appetite = 0.25 + ctx.pers.offense * 0.04 + (ctx.mem.aim === 'domination' ? 0.15 : 0) + (losingBadly(ctx) ? 0.3 : 0);
    return turns <= 40 && random(game) < appetite ? item : null;
  }
  if (stockpile(ctx, c) >= want) return null;
  if (ctx.cities.some((x) => x !== c && x.queue[0]?.kind === 'unit' && isNuke(x.queue[0].id))) return null;
  if (!airBase(game, ctx.me, c.tile)) return null;
  const id = trainable(game, p, c)
    .filter(isNuke)
    .sort((a, b) => (UNITS[b].blast ?? 1) - (UNITS[a].blast ?? 1))[0];
  return id ? { kind: 'unit', id } : null;
}

/** How much more than `NUKE_WORTH` a strike must be worth to this leader: by character, need and who'd see it. */
export function nukeBar(ctx: Ctx): number {
  const { game, p, pers, mem } = ctx;
  let bar = 1 + (5 - pers.offense) * 0.1 + (pers.diplomacy - 5) * 0.06 - (pers.boldness - 5) * 0.04;
  bar = Math.max(0.6, Math.min(2, bar));
  if (peaceful(ctx)) bar *= 1.8;
  if (mem.aim === 'domination') bar *= 0.85;
  if (losingBadly(ctx)) bar *= 0.65;
  // (Every civ it knows and isn't at war with will think the worse of it.)
  const onlookers = game.players.filter((o) => o !== p && o.alive && !o.cityState && o.civ !== 'barbarian' && !ctx.enemies.has(o.index) && knowsOf(o, p)).length;
  return NUKE_WORTH * bar + onlookers * 15;
}

/**
 * What a nuclear strike on a tile is worth to the bot (null: not to be made: refused by the rules, or
 * its own units or cities in the blast): the enemy's soldiers it would break (more near the bot's own
 * cities), the cities it would halve (the war's target and capitals most), less its own land's fallout.
 */
export function strikeWorth(ctx: Ctx, u: Unit, target: number): number | null {
  const { game } = ctx;
  const hits = nukeHits(game, u, target);
  if (!hits || hits.some((o) => game.players[o].civ !== 'barbarian' && !ctx.wars.includes(o))) return null;
  const area = new Set(within(game.grid, target, UNITS[u.type].blast ?? 1));
  let worth = 0;
  for (const t of area) {
    const c = cityOn(ctx, t);
    if (c?.owner === ctx.me) return null;
    if (c && ctx.wars.includes(c.owner)) worth += c.pop * 4 + (c.capital ? 15 : 0) + (ctx.mem.plan?.city === c.id ? 25 : 0);
    if (game.tiles[t].owner === ctx.me) worth -= 4;
  }
  for (const v of game.units) {
    if (!area.has(v.tile)) continue;
    if (v.owner === ctx.me) return null;
    if (!ctx.wars.includes(v.owner) || !ctx.p.visible[v.tile]) continue;
    const type = UNITS[v.type];
    if (!isMilitary(type)) {
      worth += 5;
      continue;
    }
    // (A blast takes 60 to 100: the wounded die, the hale are left broken.)
    const might = isAircraft(v) ? Math.max(type.strength, type.ranged ?? 0) : unitMight(v);
    const threat = ctx.cities.some((c) => dist(ctx, c.tile, v.tile) <= 4) ? 1.5 : 1;
    worth += might * (v.hp <= 80 ? 1 : 0.7) * threat;
  }
  // An Atomic Bomb may be shot down on its way: by what the bot can see of the enemy's interceptors.
  if (u.type === 'atomic_bomb') {
    let best = 0;
    for (const x of game.units) {
      if (!ctx.enemies.has(x.owner) || !ctx.p.visible[x.tile]) continue;
      const type = UNITS[x.type];
      const fighter = type.class === 'fighter' && dist(ctx, x.tile, target) <= rangeOf(x);
      const guns = !!type.abilities?.includes('intercept') && dist(ctx, x.tile, target) <= 2;
      if (fighter || guns) best = Math.max(best, Math.max(type.ranged ?? 0, type.strength) * (0.4 + (0.6 * x.hp) / 100));
    }
    if (best) worth *= 1 - bombInterceptChance(best);
  }
  return worth;
}

/** The best strike a nuclear weapon has now, if any is worth what the bot asks (`nukeBar`). */
export function bestNukeStrike(ctx: Ctx, u: Unit, bar = nukeBar(ctx)): { target: number; worth: number } | null {
  const { game, p } = ctx;
  const reach = rangeOf(u);
  const tiles = new Set<number>();
  for (const c of game.cities) if (ctx.wars.includes(c.owner) && p.explored[c.tile] && dist(ctx, u.tile, c.tile) <= reach) tiles.add(c.tile);
  for (const v of game.units) if (ctx.wars.includes(v.owner) && p.visible[v.tile] && isMilitary(UNITS[v.type]) && !isAircraft(v) && dist(ctx, u.tile, v.tile) <= reach) tiles.add(v.tile);
  let best: { target: number; worth: number } | null = null;
  for (const t of tiles) {
    const worth = strikeWorth(ctx, u, t);
    if (worth !== null && worth >= bar && (!best || worth > best.worth)) best = { target: t, worth };
  }
  return best;
}

/** Every nuclear weapon's turn: at most one strike a turn, where it's worth it; the rest move up toward the front. */
export function nukes(ctx: Ctx) {
  const { game } = ctx;
  if (ctx.mem.passive || ctx.p.cityState) return;
  const mine = game.units.filter((u) => u.owner === ctx.me && isNuke(u.type));
  if (!mine.length) return;
  if (majorWars(ctx).length) {
    const bar = nukeBar(ctx);
    let best: { u: Unit; target: number; worth: number } | null = null;
    for (const u of mine) {
      if (u.moves <= 0) continue;
      const s = bestNukeStrike(ctx, u, bar);
      if (s && (!best || s.worth > best.worth)) best = { u, ...s };
    }
    if (best && act(ctx, { t: 'attack', unit: best.u.id, target: best.target })) return;
  }
  for (const u of mine) {
    if (u.moves <= 0 || !game.units.includes(u)) continue;
    const front = frontCity(ctx, u);
    if (front && front.tile !== u.tile) act(ctx, { t: 'rebase', unit: u.id, to: front.tile });
  }
}
