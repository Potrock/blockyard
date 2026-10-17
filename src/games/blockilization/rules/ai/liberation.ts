import { allyOf, FRIEND, influenceOf, standing } from '../citystates';
import { atWar, capitalOf, speed } from '../core';
import { friends, pacted } from '../diplomacy';
import { liberation } from '../liberation';
import { cannotPledge, pledged } from '../pledges';
import type { City } from '../state';
import { teammates } from '../teams';
import { act, dist, runaways, type Ctx } from './context';
import { opinionOf } from './opinion';

/**
 * A bot's causes: cities it gives back (Civ V's liberation, `liberation.ts`) when that pays, and the
 * city-states it pledges to protect (`pledges.ts`).
 */

/**
 * Whether a bot liberates a city it has taken, and does if so (`liberating`), as Civ V's leaders do
 * when it pays in friendship more than the city would in yields.
 */
export function liberates(ctx: Ctx, c: City): boolean {
  const how = liberation(ctx.game, c);
  return !!how && liberating(ctx, c, how.to, how.revive, c.takenFrom) && act(ctx, { t: 'cityChoice', city: c.id, choice: 'liberate' });
}

/**
 * Whether the bot would give a city back to its founder `to` (brought back to life if `revive`), had it
 * taken it from `from`: always a teammate's; a city-state's for a leader who courts them, or (unless it
 * means to conquer the world) one to bring back, a small one, or when its people can't bear more; a
 * friend's, a pact partner's or one whose leader it thinks well of, or who fights the same enemy; a
 * fallen civ's, brought back against the enemy it took the city from (or a rival it dislikes), or to be
 * rid of a city its people can't bear. Never an original capital while it means to conquer the world,
 * nor to a civ close to winning.
 */
export function liberating(ctx: Ctx, c: City, to: number, revive: boolean, from: number | undefined): boolean {
  const { game, me, mem, pers } = ctx;
  const them = game.players[to];
  const original = game.cities.filter((x) => x.founder === c.founder).sort((a, b) => a.id - b.id)[0] === c;
  if (teammates(game, me, to)) return true;
  const conquering = mem.aim === 'domination';
  if (them.cityState) return mem.aim === 'diplomatic' || pers.diplomacy >= 5 || (!conquering && (revive || c.pop <= 4 || ctx.mood < 0));
  if (original && conquering) return false;
  if (runaways(ctx).has(to)) return false;
  // (The one it took the city from: an enemy of the bot's, or a rival it dislikes.)
  const taker = from !== undefined ? game.players[from] : undefined;
  const foe = !!taker && !taker.cityState && (ctx.enemies.has(taker.index) || (taker.civ !== 'barbarian' && taker.alive && (runaways(ctx).has(taker.index) || opinionOf(game, ctx.p, taker).total <= -8)));
  // (A conqueror only brings back a fallen civ with a city of no account to its conquest: against a common enemy, unless it lives for war, or when its people can't bear the city.)
  if (revive) return conquering ? !original && (ctx.mood < 0 || (foe && pers.offense <= 7)) : pers.offense <= 8 && (foe || ctx.mood < 0 || pers.diplomacy >= 6);
  if (friends(game, me, to) || pacted(game, me, to)) return true;
  const thought = opinionOf(game, ctx.p, them).total;
  if (thought >= 20) return true;
  // (Freed from the barbarians, it goes back to anyone not ill thought of; taken from an enemy, to a
  // leader it thinks fairly well of, a little less well if they're at war with that enemy too.)
  if (conquering || !foe) return false;
  if (taker!.civ === 'barbarian') return thought >= 0;
  return thought >= (atWar(game, to, taker!.index) ? 10 : 14);
}

/** Turns before a bot pledges again to a city-state whose pledge it broke or let lapse (at speed; the rules' wait is shorter). */
const PLEDGE_AGAIN = 40;

/**
 * A bot pledges to protect the city-states it's a friend or ally of; a warlike leader (who'd sooner
 * bully them) only those it's allied with, whose friendship it means to keep, for now.
 */
export function pledges(ctx: Ctx) {
  const { game, p, pers } = ctx;
  if (p.cityState) return;
  for (const cs of game.players) {
    if (!cs.cityState || !cs.alive) continue;
    // (Not soon again to one whose pledge it broke or let lapse: its word there would mean little.)
    const ended = cs.cityState.broken?.[p.index];
    if (ended !== undefined && game.turn - ended < PLEDGE_AGAIN * speed(game)) continue;
    const s = standing(game, p, cs.index);
    if ((s === 'ally' || (s === 'friend' && pers.offense < 8)) && !cannotPledge(game, p, cs.index) && !forsakes(ctx, cs.index)) act(ctx, { t: 'pledge', target: cs.index });
  }
}

/** A city-state allied with the bot's enemy: why it would break its pledge to it soonest. */
const ENEMY_ALLY = 'allied with our enemy';

/**
 * Why a bot would break its pledge to protect a city-state (null: it keeps it), as Civ V's warmongers
 * and opportunists do when their interests change: the city-state has taken its enemy's side (allied
 * with a civ it's at war with or means to attack), or a friend of its is at war with it, or the pledge
 * no longer pays (it's no longer its friend) and its tribute is wanted (short of gold, or at war).
 * Never a leader who courts the city-states, nor one reaching for the diplomatic victory. It pays for
 * it: the influence lost, its other protectors offended (`pledges.ts`).
 */
export function forsakes(ctx: Ctx, cs: number): string | null {
  const { game, p, pers, mem } = ctx;
  if (mem.aim === 'diplomatic' || pers.diplomacy >= 7) return null;
  // (A warmonger, or an opportunist on the warpath.)
  if (!(pers.offense >= 7 || (pers.offense + pers.boldness >= 11 && (mem.aim === 'domination' || ctx.wars.length > 0)))) return null;
  const ally = allyOf(game, cs);
  if (ally >= 0 && ally !== ctx.me && !teammates(game, ctx.me, ally) && (ctx.enemies.has(ally) || mem.plan?.target === ally)) return ENEMY_ALLY;
  if (game.players.some((o) => o !== p && o.alive && !o.cityState && atWar(game, o.index, cs) && (teammates(game, ctx.me, o.index) || friends(game, ctx.me, o.index) || pacted(game, ctx.me, o.index)))) return 'at war with our friend';
  if (ally !== ctx.me && influenceOf(p, cs) < FRIEND && (p.gold < 60 + ctx.era * 30 || ctx.income < 0 || ctx.wars.length > 0)) return 'its tribute is wanted';
  return null;
}

/**
 * A warmonger at war with the ally of a city-state it pledged to protect, near its own cities, turns
 * on it as Civ V's do: war on the city-state, the pledge broken (one a turn). Bullying needs its
 * soldiers at the city-state's walls (`civilians.ts`); this needs only the enemy's friend at hand.
 */
export function turnsOn(ctx: Ctx) {
  const { game, p } = ctx;
  if (ctx.pers.offense < 7 || !ctx.wars.length || ctx.mem.aim === 'diplomatic') return;
  for (const cs of game.players) {
    if (!cs.cityState || !cs.alive || !pledged(game, ctx.me, cs.index) || atWar(game, ctx.me, cs.index) || (p.diplomacy.peaceTurns[cs.index] ?? 0) > 0) continue;
    if (forsakes(ctx, cs.index) !== ENEMY_ALLY || !ctx.enemies.has(allyOf(game, cs.index))) continue;
    const home = capitalOf(game, cs.index);
    if (!home || !ctx.cities.some((c) => dist(ctx, c.tile, home.tile) <= 8)) continue;
    if (act(ctx, { t: 'war', target: cs.index })) return;
  }
}

/** Whether a city someone else holds is a teammate's, a friend's or a pact partner's, lost to them: one the bot would give back once it took it (a war of liberation). */
export function freeable(ctx: Ctx, c: City): boolean {
  const { game, me } = ctx;
  const f = game.players[c.founder];
  if (!f || f.index === me || f.index === c.owner || !f.alive || f.cityState || f.civ === 'barbarian') return false;
  return teammates(game, me, f.index) || friends(game, me, f.index) || pacted(game, me, f.index);
}
