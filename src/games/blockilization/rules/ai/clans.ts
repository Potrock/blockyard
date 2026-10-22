import { clanCost, clanProblem, clansOf, type ClanAct } from '../clans';
import { citiesOf, random } from '../core';
import { distance } from '../hex';
import { act, type Ctx } from './context';

/**
 * A bot and the barbarian clans whose camps it has found (`clans.ts`), now and then, as Civ VI's
 * do: one whose cities a clan's raiders are about bribes it to leave them alone; one at war (or about
 * to be) pays a clan near its enemy to raid it, and hires a warrior of a clan near its own cities.
 * Never with the gold it keeps by it.
 */
export function clans(ctx: Ctx) {
  const { game, p } = ctx;
  if (p.cityState || !ctx.cities.length) return;
  const found = clansOf(game).filter((c) => p.explored[c.tile]);
  if (!found.length) return;
  const reserve = 60 + ctx.era * 30 + Math.max(0, -ctx.income) * 8;
  const near = (tile: number, d: number) => ctx.cities.some((c) => distance(game.grid, c.tile, tile) <= d);
  // (The civs it's at war with or means to attack, not the city-states.)
  const enemies = [...new Set([...ctx.wars, ...(ctx.mem.plan ? [ctx.mem.plan.target] : [])])].filter((w) => !game.players[w].cityState);
  for (const clan of found) {
    const deal = (what: ClanAct, target: number | null = null) => p.gold - clanCost(game, p, what) >= reserve && !clanProblem(game, p, clan, what, target) && act(ctx, { t: 'clan', clan: clan.id, act: what, target });
    const raiders = game.units.some((u) => u.clan === clan.id && near(u.tile, 4));
    if ((raiders || near(clan.tile, 6)) && random(game) < 0.25 && deal('bribe')) continue;
    if (!enemies.length) continue;
    const prey = enemies.find((e) => citiesOf(game, e).some((c) => distance(game.grid, c.tile, clan.tile) <= 16));
    if (prey !== undefined && random(game) < 0.15 && deal('incite', prey)) continue;
    if (near(clan.tile, 8) && random(game) < 0.2) deal('hire');
  }
}
