import { airBase, airTarget, isAircraft, rebaseRange } from '../air';
import { cityStrength, rangeOf, strength } from '../combat';
import { weighing } from '../economy';
import { trainable } from '../game';
import type { City, Unit } from '../state';
import { isMilitary, UNITS } from '../units';
import { act, cityOn, dist, type Ctx } from './context';
import { expected } from './military';

/**
 * The bots' aircraft. In a war (or one being planned) a bot with Flight keeps a few: bombers for the
 * cities, fighters to guard against the enemy's, and an anti-aircraft gun in a city enemy aircraft
 * come near. Each turn an aircraft strikes the best target in range (the city it's after first) unless
 * the interception it would fly into could down it; fighters patrol while enemy aircraft are about.
 * Those with nothing in range rebase toward the front: the city of the bot's nearest the war's target.
 * (Nuclear weapons are left to `nukes.ts`.)
 */

/**
 * The enemy's aircraft about the bot's cities: those it has seen near them, and those based within
 * striking range of one (unseen in their bases, but their strikes show where they fly from).
 */
const enemyAircraft = (ctx: Ctx) => ctx.game.units.filter((u) => isAircraft(u) && ctx.enemies.has(u.owner) && ctx.cities.some((c) => dist(ctx, c.tile, u.tile) <= (ctx.p.visible[u.tile] ? 12 : rangeOf(u) + 1)));

/** How many aircraft the bot wants (fighters among them, when the enemy flies too). */
export function airWanted(ctx: Ctx): { total: number; fighters: number } {
  if (ctx.p.cityState || (!ctx.wars.length && !ctx.mem.plan) || ctx.income < 0) return { total: 0, fighters: 0 };
  const total = Math.min(6, 1 + Math.floor(ctx.cities.length / 3) + (ctx.mem.aim === 'domination' ? 2 : 0));
  return { total, fighters: enemyAircraft(ctx).length ? Math.ceil(total / 2) : Math.floor(total / 4) };
}

/** An anti-aircraft gun for a city within reach of the enemy's aircraft with none by it, if it can train one. */
export function airDefence(ctx: Ctx, c: City): string | undefined {
  const guns = trainable(ctx.game, ctx.p, c).filter((id) => UNITS[id].abilities?.includes('intercept'));
  if (!guns.length || !enemyAircraft(ctx).some((u) => dist(ctx, u.tile, c.tile) <= Math.max(10, rangeOf(u) + 1))) return undefined;
  if (ctx.game.units.some((u) => u.owner === ctx.me && UNITS[u.type].abilities?.includes('intercept') && dist(ctx, u.tile, c.tile) <= 2)) return undefined;
  return guns.sort((a, b) => UNITS[b].strength - UNITS[a].strength)[0];
}

/** The aircraft (or the anti-aircraft gun) a city should build now, if any. */
export function airProduction(ctx: Ctx, c: City): string | undefined {
  const can = trainable(ctx.game, ctx.p, c);
  const gun = airDefence(ctx, c);
  if (gun) return gun;
  const want = airWanted(ctx);
  if (!want.total || !airBase(ctx.game, ctx.me, c.tile)) return undefined;
  const mine = ctx.game.units.filter((u) => u.owner === ctx.me && isAircraft(u));
  const building = ctx.cities.filter((x) => x !== c && x.queue[0]?.kind === 'unit' && UNITS[x.queue[0].id]?.domain === 'air').length;
  if (mine.length + building >= want.total || building >= 2) return undefined;
  const fighters = mine.filter((u) => UNITS[u.type].class === 'fighter').length;
  const kind = fighters < want.fighters ? 'fighter' : 'bomber';
  return can.filter((id) => UNITS[id].domain === 'air' && UNITS[id].class === kind && !UNITS[id].abilities?.includes('nuke')).sort((a, b) => (UNITS[b].ranged ?? 0) - (UNITS[a].ranged ?? 0))[0];
}

/** The interception a strike on a tile would likely fly into (expected damage), from what the bot can see. */
function risk(ctx: Ctx, u: Unit, target: number, guards = interceptors(ctx, u)): number {
  let worst = 0;
  for (const g of guards) {
    const fighter = g.fighter !== undefined && dist(ctx, g.tile, target) <= g.range;
    const guns = g.guns !== undefined && dist(ctx, g.tile, target) <= 2;
    if (!fighter && !guns) continue;
    worst = Math.max(worst, fighter ? g.fighter! : g.guns!);
  }
  return worst;
}

/**
 * The enemy's fighters and guns the bot can see that might intercept an aircraft's strike: where each
 * is, a fighter's reach, and the damage expected from it as a fighter on patrol or as a gun (worked out
 * once for all the aircraft's targets: they're the same whatever it strikes).
 */
function interceptors(ctx: Ctx, u: Unit): { tile: number; range: number; fighter?: number; guns?: number }[] {
  const out: { tile: number; range: number; fighter?: number; guns?: number }[] = [];
  for (const x of ctx.game.units) {
    if (!ctx.enemies.has(x.owner) || !ctx.p.visible[x.tile] || x.intercepted === ctx.game.turn) continue;
    const type = UNITS[x.type];
    const fighter = type.class === 'fighter';
    const guns = !!type.abilities?.includes('intercept');
    if (!fighter && !guns) continue;
    const evade = strength(ctx.game, u, 'ranged', x, u.tile) * (UNITS[u.type].class === 'fighter' ? 1 : 0.6);
    out.push({
      tile: x.tile,
      range: rangeOf(x),
      ...(fighter ? { fighter: expected(strength(ctx.game, x, 'ranged', u, x.tile), evade) } : {}),
      ...(guns ? { guns: expected(strength(ctx.game, x, 'defend', u, x.tile), evade) } : {}),
    });
  }
  return out;
}

/** The best strike an aircraft has now, and its worth (null: none worth flying into). */
function bestAirStrike(ctx: Ctx, u: Unit): { target: number; score: number } | null {
  const { game } = ctx;
  const aim = ctx.mem.plan?.stage === 'attack' ? game.cities.find((c) => c.id === ctx.mem.plan!.city) : undefined;
  let best: { target: number; score: number } | null = null;
  const reach = rangeOf(u);
  const guards = interceptors(ctx, u);
  for (const t of game.units.filter((v) => ctx.enemies.has(v.owner) && ctx.p.visible[v.tile] && !isAircraft(v) && dist(ctx, u.tile, v.tile) <= reach).map((v) => v.tile).concat(game.cities.filter((c) => ctx.enemies.has(c.owner) && ctx.p.visible[c.tile] && dist(ctx, u.tile, c.tile) <= reach).map((c) => c.tile))) {
    const tg = airTarget(game, u, t);
    if (!tg) continue;
    const danger = risk(ctx, u, t, guards);
    if (danger >= u.hp - 15) continue;
    let score: number;
    if (tg.city) {
      const dealt = expected(strength(game, u, 'ranged', tg.city, u.tile), cityStrength(game, tg.city));
      score = Math.min(dealt, tg.city.hp - 1) * (tg.city === aim ? 2 : 1);
    } else {
      const v = tg.unit!;
      const military = isMilitary(UNITS[v.type]);
      const dealt = expected(strength(game, u, 'ranged', v, u.tile), military ? strength(game, v, 'defend', u, t) : 1);
      score = Math.min(dealt, v.hp) * (military ? 1 : 0.4) + (dealt >= v.hp ? 40 : 0);
    }
    score -= danger * 0.8;
    if (score > 5 && (!best || score > best.score)) best = { target: t, score };
  }
  return best;
}

/** Every aircraft's turn: strike, patrol, or rebase toward the front. */
export function aircraft(ctx: Ctx) {
  const { game } = ctx;
  if (ctx.mem.passive) return;
  const planes = game.units.filter((u) => u.owner === ctx.me && isAircraft(u) && !UNITS[u.type].abilities?.includes('nuke'));
  if (!planes.length) return;
  const raiders = enemyAircraft(ctx).length > 0;
  for (const u of planes) {
    if (u.moves <= 0 || !game.units.includes(u)) continue;
    const fighter = UNITS[u.type].class === 'fighter';
    // Wounded: it rests where it is (and heals).
    if (u.hp < 50) continue;
    const strike = weighing(game, () => bestAirStrike(ctx, u));
    // Fighters guard while the enemy flies (unless there's a strike well worth it).
    if (fighter && raiders && (!strike || strike.score < 40)) {
      if (u.stance !== 'alert') act(ctx, { t: 'stance', unit: u.id, stance: 'alert' });
      continue;
    }
    if (strike) {
      act(ctx, { t: 'attack', unit: u.id, target: strike.target });
      continue;
    }
    // Nothing in reach: toward the front.
    const front = frontCity(ctx, u);
    if (front && front.tile !== u.tile) act(ctx, { t: 'rebase', unit: u.id, to: front.tile });
  }
}

/** The bot's city an aircraft should be based in: within its rebase range, nearest the enemy it's fighting (or about to). */
export function frontCity(ctx: Ctx, u: Unit): City | undefined {
  const { game } = ctx;
  const foes = game.cities.filter((c) => (ctx.enemies.has(c.owner) || c.owner === ctx.mem.plan?.target) && ctx.p.explored[c.tile]);
  if (!foes.length) return undefined;
  const near = (c: City) => Math.min(...foes.map((f) => dist(ctx, c.tile, f.tile)));
  const here = cityOn(ctx, u.tile);
  const best = ctx.cities.filter((c) => dist(ctx, c.tile, u.tile) <= rebaseRange(u) && airBase(game, ctx.me, c.tile, u)).sort((a, b) => near(a) - near(b))[0];
  // (Only worth the flight if it's closer to the enemy than where it is.)
  return best && (!here || near(best) < near(here)) ? best : undefined;
}
