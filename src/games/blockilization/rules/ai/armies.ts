import { canFormCorps, forms, partners, sizeOf } from '../armies';
import { act, danger, type Ctx } from './context';

/** Formations a bot makes in a turn, at most. */
const PER_TURN = 2;

/**
 * A bot joins its soldiers into corps and armies (`armies.ts`) once it can, as Civ VI's do: two of a
 * kind side by side, both fit to fight and out of the enemy's reach (joining spends the turn), neither
 * a city's garrison. A corps with a third beside it first, for an army.
 */
export function formations(ctx: Ctx, garrisons: Set<number>) {
  const { game, p } = ctx;
  if (p.cityState || !canFormCorps(p)) return;
  const threat = danger(ctx);
  const fit = (u: { id: number; hp: number; tile: number }) => u.hp >= 50 && !garrisons.has(u.id) && threat[u.tile] <= 0;
  const mine = game.units.filter((u) => u.owner === p.index && u.moves > 0 && forms(u.type) && fit(u)).sort((a, b) => sizeOf(b) - sizeOf(a) || a.id - b.id);
  let made = 0;
  for (const u of mine) {
    if (made >= PER_TURN) return;
    if (!game.units.includes(u) || u.moves <= 0) continue;
    const other = partners(game, p, u).find(fit);
    if (other && act(ctx, { t: 'merge', unit: u.id, other: other.id })) made++;
  }
}
