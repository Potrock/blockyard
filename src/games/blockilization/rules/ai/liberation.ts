import { standing } from '../citystates';
import { friends, pacted } from '../diplomacy';
import { liberation } from '../liberation';
import { cannotPledge } from '../pledges';
import type { City } from '../state';
import { teammates } from '../teams';
import { act, type Ctx } from './context';
import { opinionOf } from './opinion';

/**
 * A bot's causes: cities it gives back (Civ V's liberation, `liberation.ts`) when that pays, and the
 * city-states it pledges to protect (`pledges.ts`).
 */

/**
 * Whether a bot liberates a city it has taken, and does if so: a teammate's, a friend's or one whose
 * leader it thinks well of; a city-state's, for a leader who courts them; a fallen civ's, brought back
 * against the enemy it took the city from. Never an original capital while it means to conquer the world.
 */
export function liberates(ctx: Ctx, c: City): boolean {
  const { game, me, mem, pers } = ctx;
  const how = liberation(game, c);
  if (!how) return false;
  const to = game.players[how.to];
  const original = game.cities.filter((x) => x.founder === c.founder).sort((a, b) => a.id - b.id)[0] === c;
  if (original && mem.aim === 'domination' && !to.cityState) return false;
  const enemy = c.takenFrom !== undefined && ctx.enemies.has(c.takenFrom) && !game.players[c.takenFrom]?.cityState;
  const worth = teammates(game, me, to.index)
    ? true
    : to.cityState
      ? mem.aim === 'diplomatic' || pers.diplomacy >= 6 || (how.revive && pers.offense <= 5)
      : how.revive
        ? enemy && pers.offense <= 7 && mem.aim !== 'domination'
        : friends(game, me, to.index) || pacted(game, me, to.index) || (enemy && opinionOf(game, ctx.p, to).total >= 20);
  return worth && act(ctx, { t: 'cityChoice', city: c.id, choice: 'liberate' });
}

/** A bot pledges to protect the city-states it's a friend or ally of (not a warlike leader who'd sooner bully them). */
export function pledges(ctx: Ctx) {
  const { game, p, pers } = ctx;
  if (p.cityState || pers.offense >= 8) return;
  for (const cs of game.players) {
    if (!cs.cityState || !cs.alive) continue;
    const s = standing(game, p, cs.index);
    if ((s === 'friend' || s === 'ally') && !cannotPledge(game, p, cs.index)) act(ctx, { t: 'pledge', target: cs.index });
  }
}
