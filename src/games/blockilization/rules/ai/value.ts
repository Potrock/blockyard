import { cityMatches, cityYields, countBuildings, luxuries, UNHAPPINESS_PER_CITY, workable, type CityYields } from '../economy';
import type { Effects, TileFilter } from '../effects';
import { religionsLeft } from '../faith';
import type { City } from '../state';
import { RESOURCES, TERRAINS, YIELD_KEYS, type YieldKey } from '../terrain';
import type { Ctx } from './context';

/**
 * What things are worth to a bot, a turn at a time and in one currency: its yields weighed by what it
 * needs now (gold when it's short, happiness when its people grumble, science for a science victory),
 * and any bundle of effects (a building's, a wonder's, a policy's, a belief's) turned into such yields.
 */

/** What a point of each yield, and of happiness, is worth to the bot this turn. */
export function yieldWeights(ctx: Ctx): Record<YieldKey | 'happiness', number> {
  const { pers, mem, mood, income, p } = ctx;
  const early = ctx.game.turn < 80;
  return {
    food: early ? 1.3 : 1.0,
    prod: 1.2 + (mem.aim === 'science' && ctx.era >= 4 ? 0.6 : 0),
    gold: 0.6 + pers.gold * 0.04 + (income < 0 ? 0.8 : income < 5 ? 0.3 : 0) + (p.gold < 30 ? 0.3 : 0) + (mem.aim === 'diplomatic' ? 0.4 : 0),
    science: 0.9 + pers.science * 0.06 + (mem.aim === 'science' ? 0.5 : 0),
    culture: 0.8 + pers.culture * 0.06 + (mem.aim === 'culture' ? 0.6 : 0) + (early ? 0.3 : 0),
    // Faith is worth most before the pantheon (a shrine brings one) and while a religion can still be founded.
    faith: 0.2 + pers.faith * 0.06 + (p.religion || early ? 0.15 : 0) + (!p.pantheon ? 1.2 : 0) + (!p.religion && religionsLeft(ctx.game, p) > 0 ? pers.faith * 0.08 : 0),
    happiness: mood < 0 ? 4.5 : mood < 3 ? 3 : mood < 8 ? 1.6 : 0.8,
  };
}

/** A city's yields this turn (worked out once a turn). */
export function yieldsOf(ctx: Ctx, c: City): CityYields {
  const cache = (ctx.cache.yields ??= new Map());
  let y = cache.get(c.id);
  // (The empire's happiness as the turn began: worked out once, not again for every city.)
  if (!y) cache.set(c.id, (y = cityYields(ctx.game, c, ctx.p.index === c.owner ? ctx.mood : undefined)));
  return y;
}

/** How many of a city's tiles (or every city's) match a filter: worked ones in full, the rest a half. */
function matching(ctx: Ctx, where: TileFilter, cities: City[]): number {
  let n = 0;
  for (const c of cities) {
    const worked = new Set(c.worked);
    for (const t of workable(ctx.game, c)) {
      const tile = ctx.game.tiles[t];
      if (where.terrain && !where.terrain.includes(tile.terrain)) continue;
      if (where.feature && (!tile.feature || !where.feature.includes(tile.feature))) continue;
      if (where.elevation && !where.elevation.includes(tile.elevation)) continue;
      if (where.resource && (!tile.resource || !where.resource.includes(tile.resource))) continue;
      if (where.resourceKind && (!tile.resource || !where.resourceKind.includes(RESOURCES[tile.resource].kind))) continue;
      if (where.improvement && (!tile.improvement || !where.improvement.includes(tile.improvement))) continue;
      if (where.water !== undefined && !!TERRAINS[tile.terrain].water !== where.water) continue;
      if (where.river && !tile.river) continue;
      if (where.naturalWonder && !tile.wonder) continue;
      n += worked.has(t) ? 1 : 0.4;
    }
  }
  return n;
}

/** Rough worth a turn of the rules' named specials (those that matter most to a bot's choices). */
const SPECIALS: Record<string, number> = {
  policy_city_cost_less: 3,
  science_10_happy: 3,
  science_15_happy: 4,
  trade_gold_2: 2,
  research_agreements_double: 0.5,
  double_xp: 1.5,
  gold_from_kills: 1,
  culture_from_kills: 1,
  garrison_free: 1.5,
  garrison_city_strike: 1,
  upgrades_cheaper_33: 1,
  faith_cheaper_20: 1,
  buy_prophets: 2,
  happiness_to_culture: 2,
  culture_great_people_25: 1.5,
  capital_unhappiness_half: 3,
  happiness_per_10_pop: 2,
  culture_from_barbarian_kills: 0.5,
  gifts_25: 1,
  influence_rest_20: 2,
  ally_science_25: 2,
  cs_resources_double: 2,
  cs_trade_gold_3: 1,
  cs_great_people: 1.5,
  road_upkeep_less: 1,
  merchants_faster_25: 1,
  missionaries_extra_spread: 1,
  enables_spaceship: 0,
};

/** The worth a turn of a bundle of effects: in one city (`where`), or across the empire (null). */
export function effectsValue(ctx: Ctx, e: Effects, where: City | null): number {
  const w = yieldWeights(ctx);
  const cities = where ? [where] : ctx.cities;
  const n = Math.max(1, cities.length);
  const pop = cities.reduce((s, c) => s + c.pop, 0);
  let v = 0;
  for (const k of YIELD_KEYS) {
    v += (e.yields?.[k] ?? 0) * w[k] * n;
    v += (e.perPop?.[k] ?? 0) * pop * w[k];
    const pct = (e.percent?.[k] ?? 0) / 100;
    if (pct) v += pct * cities.reduce((s, c) => s + (k === 'food' ? Math.max(1, yieldsOf(ctx, c).surplus) : (yieldsOf(ctx, c)[k] as number)), 0) * w[k];
    v += (e.specialistYields?.[k] ?? 0) * cities.reduce((s, c) => s + Object.values(c.specialists).reduce((x, n) => x + (n ?? 0), 0), 0) * w[k];
  }
  // What reaches every city, what's only for some cities, and what comes with each of some buildings.
  if (e.empire) v += effectsValue(ctx, e.empire, null);
  for (const x of e.cities ?? []) for (const c of cities) if (cityMatches(ctx.game, c, x.when)) v += effectsValue(ctx, x.effects, c);
  for (const x of e.perBuilding ?? []) for (const c of cities) for (let k = countBuildings(c, x.buildings); k > 0; k--) v += effectsValue(ctx, x.effects, c);
  for (const tb of e.tiles ?? []) {
    const count = matching(ctx, tb.where, cities);
    for (const k of YIELD_KEYS) v += count * (tb.yields[k] ?? 0) * w[k];
  }
  v += (e.happiness ?? 0) * n * w.happiness;
  if (e.unhappinessPercent) v += ((ctx.cities.length * UNHAPPINESS_PER_CITY + ctx.cities.reduce((s, c) => s + c.pop, 0)) * e.unhappinessPercent * w.happiness) / 100;
  if (e.happinessPerLuxury) v += luxuries(ctx.game, ctx.p).size * e.happinessPerLuxury * w.happiness;
  if (e.defense || e.hp || e.cityStrength) v += ((e.defense ?? 0) + (e.hp ?? 0) / 10 + (e.cityStrength ?? 0) / 5) * (0.04 + (ctx.wars.length ? 0.15 : 0));
  if (e.xp) v += e.xp.reduce((s, x) => s + x.xp, 0) * 0.02 * (ctx.pers.offense + ctx.pers.defense) * 0.2;
  if (e.promotions) v += e.promotions.length * 0.3 * (ctx.pers.offense + ctx.pers.defense) * 0.2;
  for (const up of e.unitProduction ?? []) v += (up.percent / 100) * cities.reduce((s, c) => s + yieldsOf(ctx, c).prod, 0) * 0.3 * w.prod;
  if (e.wonderProduction) v += (e.wonderProduction / 100) * cities.reduce((s, c) => s + yieldsOf(ctx, c).prod, 0) * (ctx.pers.wonder / 10) * w.prod;
  if (e.buildingProduction) v += (e.buildingProduction / 100) * cities.reduce((s, c) => s + yieldsOf(ctx, c).prod, 0) * 0.5 * w.prod;
  for (const boost of e.buildingBoost ?? []) v += (boost.percent / 100) * cities.reduce((s, c) => s + yieldsOf(ctx, c).prod, 0) * 0.1 * w.prod;
  if (e.spaceshipProduction) v += (e.spaceshipProduction / 100) * cities.reduce((s, c) => s + yieldsOf(ctx, c).prod, 0) * (ctx.mem.aim === 'science' && ctx.era >= 6 ? 0.6 : 0.05) * w.prod;
  for (const g of e.greatPeople ?? []) v += g.points * 0.3;
  if (e.greatPeoplePercent) v += (e.greatPeoplePercent / 100) * 4;
  for (const s of e.specialists ?? []) v += s.slots * cities.reduce((x, c) => x + (c.pop > 6 ? 1.2 : 0.3), 0);
  if (e.greatWorks) v += e.greatWorks.slots * (ctx.mem.aim === 'culture' ? 2.5 : 0.6);
  if (e.foodKept) v += (e.foodKept / 100) * cities.reduce((s, c) => s + (c.pop >= 5 ? 6 : 1), 0) * w.food;
  if (e.borderCost) v += (e.borderCost / 100) * 2;
  if (e.tileGoldCost) v += (e.tileGoldCost / 100) * 1;
  // Things that happen once, spread over the turns they'd take to earn.
  if (e.freeTechs) v += e.freeTechs * 6 * w.science * (1 + ctx.era * 0.5);
  if (e.freePolicies) v += e.freePolicies * 6 * w.culture * (1 + ctx.era * 0.4);
  if (e.freeGreatPerson) v += 4;
  // Great people for faith, later in the game: worth more the more kinds (and more to a faithful bot).
  if (e.faithGreatPeople) v += Math.min(4, e.faithGreatPeople.length) * (0.6 + ctx.pers.faith * 0.06);
  for (const f of e.freeUnits ?? []) v += f.count * (f.unit === 'settler' ? 4 : f.unit === 'worker' ? 2 : 0.8);
  if (e.freeBuildingInAll) v += ctx.cities.length * 2;
  if (e.freeBuildings) v += e.freeBuildings.cities * 2;
  if (e.freeBuildingHere) v += 2;
  if (e.goldenAge) v += 3;
  if (e.goldenAgeLength) v += 1;
  if (e.tradeRoutes) v += e.tradeRoutes * 4 * w.gold;
  if (e.unitUpkeep) v += (e.unitUpkeep / 100) * Math.max(0, -ctx.income + 4) * w.gold;
  if (e.policyCost) v += e.policyCost * 0.1 * w.culture;
  for (const c of e.combat ?? []) v += c.percent * 0.012 * (ctx.pers.offense + ctx.pers.defense) * 0.5;
  for (const m of e.moves ?? []) v += m.moves * (m.domain === 'land' ? 1 : 0.3);
  for (const x of e.sight ?? []) v += x.sight * 0.3;
  if (e.workRate) v += (e.workRate / 100) * 4;
  for (const d of e.purchaseDiscount ?? []) v += d.percent * 0.03 * w.gold;
  if (e.faithBuildings) v += e.faithBuildings.length * w.faith;
  if (e.pressure) v += (e.pressure / 100) * 2 * w.faith;
  if (e.tourism) v += e.tourism * (ctx.mem.aim === 'culture' ? 1.5 : 0.3);
  if (e.tourismPercent) v += (e.tourismPercent / 100) * (ctx.mem.aim === 'culture' ? 10 : 1);
  if (e.cityStateInfluence) v += (e.cityStateInfluence / 100) * (ctx.mem.aim === 'diplomatic' ? 12 : 3);
  for (const s of e.special ?? []) v += SPECIALS[s] ?? 0.8;
  return v;
}
