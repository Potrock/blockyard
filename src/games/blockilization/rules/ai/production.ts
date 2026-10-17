import { BUILDINGS, SPACESHIP_PARTS } from '../buildings';
import { cityStrength } from '../combat';
import { knows, random } from '../core';
import { isBuilding, purchaseCost, strategic, workable } from '../economy';
import { canBuyReligious, cityReligion, faithBuildings, faithCost } from '../faith';
import { canConstruct, canProduce, constructible, defaultBuild, faithPurchases, itemCost, placeFor, productionToward, seaWork, trainable } from '../game';
import { within } from '../hex';
import type { City, Production, Unit } from '../state';
import { maxRoutes, partsBuildable, routesOf } from '../trade';
import { TECH_LIST } from '../techs';
import { RESOURCES } from '../terrain';
import { isGreatPerson, isMilitary, UNITS, type UnitType } from '../units';
import { airDefence, airProduction } from './air';
import { act, cityOn, danger, diplomaticRival, dist, mightOf, militaryAt, unitMight, type Ctx } from './context';
import type { Aim } from './memory';
import { bestShip, isWarship, navyWanted, seaport } from './navy';
import { leavesProject, worldProject } from './projects';
import { bestSite, SITE_WORTH } from './settle';
import { effectsValue, yieldsOf, yieldWeights } from './value';

/**
 * What the bots' cities build and what their gold and faith buy. The empire first says what it wants
 * (settlers while there's good land and its people can bear another city, a worker for each city or
 * so, an army sized to its cities, its character and its wars); then each city, when it's free, takes
 * the most pressing of those it's suited to (a threatened city arms first), and otherwise the
 * building, wonder or caravan worth most for the production it costs.
 */

/** What a unit is for, in an army. */
export type Role = 'melee' | 'mounted' | 'ranged' | 'siege' | 'recon' | 'naval' | 'air' | 'civilian';

export function roleOf(t: UnitType): Role {
  if (!isMilitary(t) || t.class === 'great') return 'civilian';
  if (t.domain === 'air') return 'air';
  if (t.domain === 'sea') return 'naval';
  if (t.class === 'recon') return 'recon';
  if (t.class === 'siege') return 'siege';
  if (t.class === 'ranged' || (t.class === 'mounted' && t.ranged)) return 'ranged';
  if (t.class === 'mounted' || t.class === 'armor' || t.class === 'helicopter') return 'mounted';
  return 'melee';
}

/** Land units that fight (not scouts, ships, aircraft or great people). */
export const isSoldier = (u: Unit) => {
  const r = roleOf(UNITS[u.type]);
  return r === 'melee' || r === 'mounted' || r === 'ranged' || r === 'siege';
};

export interface Wants {
  settlers: number;
  workers: number;
  military: number;
  /** The share of each role the army should have. */
  mix: Partial<Record<Role, number>>;
}

/** The most cities a bot sets out to have: by its love of expansion and the map. */
export function cityCap(ctx: Ctx): number {
  const big = ctx.game.settings.size === 'large' ? 1 : ctx.game.settings.size === 'duel' ? -1 : 0;
  return 3 + Math.round(ctx.pers.expansion * 0.55) + big;
}

/** How big an army a war plan needs (beyond the cities' garrisons). */
export function armyNeed(ctx: Ctx): number {
  return Math.min(14, 5 + ctx.era + (ctx.pers.offense >= 8 ? 2 : 0) + (ctx.mem.aim === 'domination' ? 1 : 0));
}

/** What the empire wants built, worked out once a turn. */
export function wants(ctx: Ctx): Wants {
  if (ctx.cache.wants) return ctx.cache.wants;
  const { game, p, pers, mem } = ctx;
  const n = ctx.cities.length;
  // Settlers: while there's good land near, the cap isn't reached and the people can bear another city.
  let settlers = 0;
  const alive = game.units.filter((u) => u.owner === ctx.me && u.type === 'settler').length;
  if (!p.cityState && n > 0 && n + alive < cityCap(ctx) && game.turn < 220) {
    const from = ctx.capital?.tile ?? ctx.cities[0].tile;
    const site = bestSite(ctx, from);
    const bearable = ctx.mood - 4 * (alive + 1) >= -(pers.expansion >= 7 ? 2 : pers.expansion >= 5 ? 1 : 0);
    if (site && site.score >= SITE_WORTH && bearable) settlers = n < 6 ? 2 : 1;
  }
  // Workers: one for each city or so, more while there's much to improve.
  const workers = p.cityState ? 0 : Math.min(Math.ceil(n * 1.2) + 1, Math.max(1, n) + (game.turn > 80 ? 2 : 0));
  // The army: a garrison a city, then more by character, era and wars.
  let military = n + 1 + Math.floor(pers.defense / 4) + Math.floor(ctx.era / 2);
  if (game.turn < 50) military = Math.max(2, n + 1);
  if (mem.plan) military = n + armyNeed(ctx) + 1;
  if (ctx.wars.length) military += Math.max(2, Math.ceil(n / 2));
  if (p.cityState) military = 2 + ctx.era;
  // Paying out more than it makes: no more soldiers than the garrisons and a few (none beyond the
  // garrisons once the treasury's going dry), unless the enemy's at the gates.
  if (ctx.income < 0 && !ctx.wars.length) military = Math.min(military, n + 1 + (p.gold < 80 ? 0 : Math.floor(ctx.era / 2)));
  const siege = UNITS_BY_ROLE.siege.some((t) => !t.tech || knows(p, t.tech));
  // (For a war of its own, the army's half fire: walls fall to bombardment, not to soldiers' blows.)
  const mix: Wants['mix'] = siege && mem.plan ? { melee: 0.35, mounted: 0.1, ranged: 0.25, siege: 0.3 } : { melee: 0.45, mounted: 0.15, ranged: 0.4 };
  const w: Wants = { settlers, workers, military, mix };
  ctx.cache.wants = w;
  return w;
}

const UNITS_BY_ROLE: Record<Role, UnitType[]> = { melee: [], mounted: [], ranged: [], siege: [], recon: [], naval: [], air: [], civilian: [] };
for (const t of Object.values(UNITS)) if (!t.unbuildable && !t.civ) UNITS_BY_ROLE[roleOf(t)].push(t);

/** The bot's units and what its cities are training now, counted. */
function counts(ctx: Ctx, except: City | null) {
  const out = { settlers: 0, workers: 0, military: 0, boats: 0, caravans: 0, ships: 0, roles: {} as Partial<Record<Role, number>> };
  const add = (type: string) => {
    if (type === 'settler') out.settlers++;
    else if (type === 'worker') out.workers++;
    else if (type === 'work_boat') out.boats++;
    else if (type === 'caravan' || type === 'cargo_ship') out.caravans++;
    const r = roleOf(UNITS[type]);
    if (r === 'naval') out.ships++;
    if (r === 'melee' || r === 'mounted' || r === 'ranged' || r === 'siege') {
      out.military++;
      out.roles[r] = (out.roles[r] ?? 0) + 1;
    }
  };
  for (const u of ctx.game.units) if (u.owner === ctx.me) add(u.type);
  for (const c of ctx.cities) if (c !== except && c.queue[0]?.kind === 'unit') add(c.queue[0].id);
  return out;
}

/** The best unit of a role a city can train now (its strongest; the cheaper of equals). */
export function bestOf(ctx: Ctx, c: City, role: Role | 'defender'): string | undefined {
  const can = trainable(ctx.game, ctx.p, c).filter((id) => UNITS[id].domain === 'land');
  const want = (id: string) => {
    const r = roleOf(UNITS[id]);
    // (Anti-aircraft guns are wanted against aircraft, not for an army's line.)
    if (UNITS[id].abilities?.includes('intercept')) return false;
    return role === 'defender' ? r === 'melee' || r === 'ranged' : r === role;
  };
  const power = (id: string) => (role === 'ranged' || role === 'siege' ? (UNITS[id].ranged ?? 0) : UNITS[id].strength) - UNITS[id].cost / 1000;
  return can.filter(want).sort((a, b) => power(b) - power(a))[0];
}

/** The role the army is shortest of. */
function neededRole(ctx: Ctx, c: City, have: Partial<Record<Role, number>>): Role {
  const { mix } = wants(ctx);
  const total = Math.max(1, Object.values(have).reduce((s, n) => s + (n ?? 0), 0));
  let best: Role = 'melee';
  let gap = -Infinity;
  for (const [role, share] of Object.entries(mix) as [Role, number][]) {
    if (!bestOf(ctx, c, role)) continue;
    const g = share - (have[role] ?? 0) / total;
    if (g > gap) (gap = g), (best = role);
  }
  return best;
}

/** Enemy strength that could reach a city next turn against what defends it (above 1: in trouble). */
export function threatTo(ctx: Ctx, c: City): number {
  const d = danger(ctx);
  if (d[c.tile] <= 0) return 0;
  let defence = cityStrength(ctx.game, c) * 1.2;
  for (const t of within(ctx.game.grid, c.tile, 2)) {
    const m = militaryAt(ctx, t);
    if (m && m.owner === ctx.me) defence += unitMight(m);
  }
  return d[c.tile] / Math.max(1, defence);
}

/** What a city builds next. */
export function pickProduction(ctx: Ctx, c: City): Production {
  if (ctx.p.cityState) return cityStateBuild(ctx, c, counts(ctx, c).military);
  return urgent(ctx, c) ?? contentment(ctx, c) ?? victoryProduction(ctx, c) ?? worldProject(ctx, c, threatTo(ctx, c)) ?? wonder(ctx, c) ?? army(ctx, c) ?? bestBuilding(ctx, c, counts(ctx, c).caravans) ?? defaultBuild(ctx.game, ctx.p, c);
}

/**
 * A wonder, raced for as Civ V's bots race: in the empire's best city (its two best, for a leader who
 * loves them), one at a time, once the first cities are settled and while the army isn't well short.
 * A free best city takes one up as often as its leader likes them, less often with wonders already won
 * or a stronger neighbour; it picks the one worth most to it that it would finish in good time.
 */
function wonder(ctx: Ctx, c: City): Production | null {
  const { game, p, pers, mem } = ctx;
  if (p.cityState || c.puppet || threatTo(ctx, c) > 0.3) return null;
  const lover = pers.wonder >= 7;
  const strongest = ctx.cities.filter((x) => !x.puppet).sort((a, b) => yieldsOf(ctx, b).prod - yieldsOf(ctx, a).prod);
  if (strongest.indexOf(c) > (lover && strongest.length >= 3 ? 1 : 0)) return null;
  const grand = (x: City) => x.queue[0]?.kind === 'building' && BUILDINGS[x.queue[0].id]?.kind === 'world';
  if (ctx.cities.some((x) => x !== c && grand(x)) && !(lover && ctx.cities.filter((x) => x !== c && grand(x)).length < 2)) return null;
  const want = wants(ctx);
  if (want.settlers > 0 && ctx.cities.length < (lover ? 2 : 3)) return null;
  if (counts(ctx, c).military < want.military * (ctx.wars.length ? 0.9 : 0.5)) return null;
  const built = Object.values(game.wonders).filter((x) => x === ctx.me).length;
  const appetite = 0.3 + pers.wonder * 0.06 - Math.max(0, built - 2) * 0.05 - (outgunned(ctx) ? 0.2 : 0) + (mem.aim === 'culture' ? 0.1 : 0);
  if (random(game) >= appetite) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const id of constructible(game, p, c)) {
    const b = BUILDINGS[id];
    if (b.kind !== 'world' || id === 'united_nations') continue;
    const turns = itemCost(game, { kind: 'building', id }) / Math.max(1, productionToward(game, c, { kind: 'building', id }));
    if (turns > 18 + pers.wonder * 1.2) continue;
    const v = effectsValue(ctx, b.effects, c) + 2 + pers.wonder * 0.3 + (mem.aim === 'culture' ? 2 : 0);
    const score = v / Math.sqrt(turns);
    if (score > bestScore) (bestScore = score), (best = id);
  }
  return best ? { kind: 'building', id: best } : null;
}

/** What a building does for the people's happiness. */
const cheer = (id: string) => (BUILDINGS[id]?.kind === 'world' ? 0 : (BUILDINGS[id]?.effects.happiness ?? 0));

/**
 * A building that makes the people happier while the empire is near discontent (or past it), before
 * it sours: the most happiness for its cost the city can build, in a few cities at a time.
 */
function contentment(ctx: Ctx, c: City): Production | null {
  const { game, p } = ctx;
  if (ctx.mood >= 3 || c.puppet) return null;
  const busy = ctx.cities.filter((x) => x !== c && x.queue[0]?.kind === 'building' && cheer(x.queue[0].id) > 0).length;
  if (busy >= (ctx.mood < 0 ? 3 : 2)) return null;
  const worth = (id: string) => cheer(id) / itemCost(game, { kind: 'building', id });
  const best = constructible(game, p, c).filter((id) => cheer(id) > 0).sort((a, b) => worth(b) - worth(a))[0];
  return best ? { kind: 'building', id: best } : null;
}

/**
 * What a city should build before anything else, if anything: defenders for a city in danger or
 * without a garrison (and against bombers), a scout to start, settlers, workers.
 */
function urgent(ctx: Ctx, c: City): Production | null {
  const { game, p } = ctx;
  const unit = (id: string | undefined): Production | null => (id ? { kind: 'unit', id } : null);
  const want = wants(ctx);
  const have = counts(ctx, c);
  const can = trainable(game, p, c);
  // A city under threat arms itself.
  if (threatTo(ctx, c) > 0.7) {
    const u = unit(bestOf(ctx, c, have.military > (have.roles.ranged ?? 0) * 2 ? 'ranged' : 'defender'));
    if (u) return u;
  }
  // A city in reach of the enemy's bombers, with nothing to shoot them down, an anti-aircraft gun.
  const gun = unit(airDefence(ctx, c));
  if (gun) return gun;
  // A scout to start with, to find the land to settle.
  if (c.capital && game.turn < 12 && can.includes('scout') && !game.units.some((u) => u.owner === ctx.me && UNITS[u.type].class === 'recon') && !ctx.cities.some((x) => x !== c && x.queue[0]?.id === 'scout'))
    return { kind: 'unit', id: 'scout' };
  // A city with no garrison while the army is short.
  if (!militaryAt(ctx, c.tile) && have.military < want.military && game.turn > 12) {
    const u = unit(bestOf(ctx, c, 'defender'));
    if (u) return u;
  }
  const shrine = earlyShrine(ctx, c);
  if (shrine) return shrine;
  const y = yieldsOf(ctx, c);
  // Settlers from cities that can spare the people and grow back: the capital from size 2 in the first
  // forty turns, then 3; another city from size 4, so new cities grow rather than give their people away.
  const settlerPop = !c.capital ? 4 : game.turn < 40 ? 2 : 3;
  if (want.settlers > have.settlers && can.includes('settler') && c.pop >= settlerPop && y.surplus >= 1 && y.prod >= 2) {
    const others = ctx.cities.filter((x) => x !== c && x.queue[0]?.id === 'settler').length;
    if (others < want.settlers) return { kind: 'unit', id: 'settler' };
  }
  // (Once there are other cities and a worker or two, the empire's best city leaves them to the others: it races for the wonders.)
  const spared = have.workers >= 2 && ctx.cities.length >= 2 && c === bestCity(ctx);
  if (have.workers < want.workers && can.includes('worker') && (have.workers < ctx.cities.length || game.turn > 30) && !spared) return { kind: 'unit', id: 'worker' };
  // A monument in every city, warlike or not (its culture claims the land, and keeps the people's own
  // culture from being swept away by others' tourism).
  if (game.turn > 15 && !c.buildings.some((b) => isBuilding(b, 'monument')) && threatTo(ctx, c) < 0.3) {
    const monument = Object.values(BUILDINGS).find((b) => b.civ === p.civ && b.replaces === 'monument')?.id ?? 'monument';
    if (canConstruct(game, p, c, BUILDINGS[monument])) return { kind: 'building', id: monument };
  }
  return null;
}

/**
 * A faithful leader's capital raises a shrine early, for a pantheon by turn 20-35 (the others come to
 * faith later, as their buildings' worth has it).
 */
function earlyShrine(ctx: Ctx, c: City): Production | null {
  const { game, p } = ctx;
  if (!c.capital || ctx.pers.faith < 6 || game.turn <= 3 || p.pantheon) return null;
  const faithful = (id: string | undefined) => (id ? (BUILDINGS[id]?.effects.yields?.faith ?? 0) > 0 : false);
  if (ctx.cities.some((x) => x.buildings.some(faithful) || (x.queue[0]?.kind === 'building' && faithful(x.queue[0].id)))) return null;
  const shrine = Object.values(BUILDINGS).find((b) => b.civ === p.civ && b.replaces === 'shrine')?.id ?? 'shrine';
  return canConstruct(game, p, c, BUILDINGS[shrine]) ? { kind: 'building', id: shrine } : null;
}

/** The army the empire wants, built in the cities that make the most production (in all of them for a war), its ships and aircraft; else a work boat. */
function army(ctx: Ctx, c: City): Production | null {
  const { game, p } = ctx;
  const want = wants(ctx);
  const have = counts(ctx, c);
  const can = trainable(game, p, c);
  if (have.military < want.military) {
    const rank = [...ctx.cities].sort((a, b) => yieldsOf(ctx, b).prod - yieldsOf(ctx, a).prod).indexOf(c);
    const training = ctx.cities.filter((x) => x !== c && x.queue[0]?.kind === 'unit' && isMilitary(UNITS[x.queue[0].id])).length;
    if (rank < Math.max(1, Math.ceil(ctx.cities.length / 2)) || training < want.military - have.military - 1 || (ctx.mem.plan && yieldsOf(ctx, c).prod >= 4)) {
      const id = bestOf(ctx, c, neededRole(ctx, c, have.roles));
      if (id) return { kind: 'unit', id };
    }
  }
  // Warships, in ports.
  if (have.ships < navyWanted(ctx) && seaport(ctx, c)) {
    const ship = bestShip(ctx, c);
    const building = ctx.cities.filter((x) => x !== c && x.queue[0]?.kind === 'unit' && UNITS[x.queue[0].id]?.domain === 'sea' && isMilitary(UNITS[x.queue[0].id])).length;
    if (ship && building < 2) return { kind: 'unit', id: ship };
  }
  // Aircraft, in a war; an anti-aircraft gun where the enemy's come.
  const plane = airProduction(ctx, c);
  if (plane) return { kind: 'unit', id: plane };
  // Work boats for the sea's resources.
  if (can.includes('work_boat') && have.boats === 0 && workable(game, c).some((t) => !game.tiles[t].improvement && seaWork(game, ctx.p, t)))
    return { kind: 'unit', id: 'work_boat' };
  return null;
}

/** A city-state: defenders, then the default order of buildings (walls among them). */
function cityStateBuild(ctx: Ctx, c: City, military: number): Production {
  if (military < 2 + Math.floor(ctx.era / 2)) {
    const u = bestOf(ctx, c, 'defender');
    if (u) return { kind: 'unit', id: u };
  }
  return defaultBuild(ctx.game, ctx.p, c);
}

/**
 * What a city builds toward its empire's victory: the Apollo Program in its best city and the
 * spaceship's parts in the rest (a bot going to the stars, or any that can from turn 200 or near the
 * end of learning: with nothing left to learn, its three strongest cities at least); the United
 * Nations for a diplomat.
 */
function victoryProduction(ctx: Ctx, c: City): Production | null {
  const { game, p, mem } = ctx;
  // (The empire's strongest city for production, the first of its best: in one pass, as it's asked of every city.)
  let top: City | undefined;
  for (const x of ctx.cities) if (!x.puppet && (!top || yieldsOf(ctx, x).prod > yieldsOf(ctx, top).prod)) top = x;
  // The United Nations: a diplomat's goal, and the way to keep a rival diplomat from theirs.
  if (top === c && (mem.aim === 'diplomatic' || diplomaticRival(ctx) !== null) && canConstruct(game, p, c, BUILDINGS.united_nations)) return { kind: 'building', id: 'united_nations' };
  // (Keen on the stars: a bot going there, any bot from turn 200 or with three techs or fewer left to learn.)
  const left = TECH_LIST.filter((t) => t.id !== 'future_tech' && !knows(p, t.id)).length;
  const keen = mem.aim === 'science' || game.turn > 200 || left <= 3;
  if (!keen || !knows(p, 'rocketry')) return null;
  const strongest = [...ctx.cities].filter((x) => !x.puppet).sort((a, b) => yieldsOf(ctx, b).prod - yieldsOf(ctx, a).prod);
  if (strongest[0] === c && canConstruct(game, p, c, BUILDINGS.apollo_program) && !ctx.cities.some((x) => x !== c && x.queue[0]?.id === 'apollo_program')) return { kind: 'building', id: 'apollo_program' };
  // Parts in the cities that can build them in good time: the one-of-a-kind parts in the strongest.
  const parts = partsBuildable(game, p);
  const best = yieldsOf(ctx, strongest[0]).prod;
  // (Late on, more of its cities join in; with nothing left to learn, its three strongest at least.)
  const among = left === 0 && strongest.indexOf(c) < 3;
  if (!parts.length || (yieldsOf(ctx, c).prod < best * (game.turn > 200 ? 0.35 : 0.6) && !among)) return null;
  const unique = parts.filter((x) => SPACESHIP_PARTS.find((part) => part.id === x)?.count === 1);
  const freeStronger = strongest.slice(0, strongest.indexOf(c)).filter((x) => x.queue[0]?.kind !== 'project').length;
  const part = (freeStronger === 0 && unique[0]) || parts.find((x) => !unique.includes(x)) || parts[0];
  return { kind: 'project', id: part };
}

/** The empire's best city for production (not a puppet). */
function bestCity(ctx: Ctx): City | undefined {
  let top: City | undefined;
  for (const x of ctx.cities) if (!x.puppet && (!top || yieldsOf(ctx, x).prod > yieldsOf(ctx, top).prod)) top = x;
  return top;
}

/** Whether an item is one a city should give all its production to (a wonder, the Apollo Program, a spaceship part). */
const grand = (item: Production | undefined) => !!item && (item.kind === 'project' || (item.kind === 'building' && (BUILDINGS[item.id]?.kind === 'world' || item.id === 'apollo_program')));

/** How a city's citizens should work: for production on something grand or while the empire's unhappy (it wouldn't grow anyway), else as the governor likes. */
function setFocus(ctx: Ctx, c: City) {
  const focus = (f: City['focus']) => act(ctx, { t: 'focus', city: c.id, focus: f }) && ctx.cache.yields?.delete(c.id);
  const want: City['focus'] = grand(c.queue[0]) || ctx.mood < 0 ? 'prod' : 'balanced';
  if (c.focus !== want) focus(want);
  // Not at the cost of starving.
  if (c.focus === 'prod' && yieldsOf(ctx, c).surplus < 0) focus('balanced');
}

/** The building, wonder or caravan worth most for its cost in this city. */
function bestBuilding(ctx: Ctx, c: City, caravans: number): Production | null {
  const { game, p, pers, mem } = ctx;
  const w = yieldWeights(ctx);
  let best: Production | null = null;
  let bestScore = 0;
  const strongest = [...ctx.cities].sort((a, b) => yieldsOf(ctx, b).prod - yieldsOf(ctx, a).prod);
  const wonderCities = strongest.slice(0, pers.wonder >= 8 ? 2 : 1);
  const wondersUnderway = ctx.cities.filter((x) => x !== c && x.queue[0]?.kind === 'building' && BUILDINGS[x.queue[0].id]?.kind === 'world').length;
  const settling = wants(ctx).settlers > 0 && ctx.cities.length < 3;
  // (A bot whose army lags well behind a neighbour's, or with many wonders already, wants more of them
  // less, and builds one at a time.)
  const built = Object.values(game.wonders).filter((x) => x === ctx.me).length;
  const restraint = (outgunned(ctx) ? 0.6 : 1) * (built >= 3 + pers.wonder / 2 ? 0.6 : 1);
  for (const id of constructible(game, p, c)) {
    const b = BUILDINGS[id];
    if (id === 'apollo_program' || id === 'manhattan_project') continue;
    const cost = itemCost(game, { kind: 'building', id });
    const turns = cost / Math.max(1, productionToward(game, c, { kind: 'building', id }));
    let v = effectsValue(ctx, b.effects, c) - b.upkeep * w.gold;
    if (b.kind === 'world') {
      // Wonders: in the empire's best cities, one at a time (two for a wonder lover), if they'd be done
      // in time, and not while the empire still wants settlers.
      if (!wonderCities.includes(c) || wondersUnderway >= (pers.wonder >= 8 && restraint === 1 ? 2 : 1) || turns > 30 + pers.wonder * 2 || settling) continue;
      v = (v * (0.6 + pers.wonder / 12) + pers.wonder * 0.5 + (mem.aim === 'culture' ? 3 : 0)) * restraint;
    }
    if (b.kind === 'national' && b.effects.greatWorks && mem.aim === 'culture') v += 2;
    // A culture-minded bot in the game's last third: whatever draws the world's tourists.
    if (mem.aim === 'culture' && game.turn > 220 && (b.effects.tourismPercent || b.effects.tourism || b.effects.greatWorks)) v += 6;
    // The first faith brings a pantheon (a belief for every city).
    if (!p.pantheon && (b.effects.yields?.faith ?? 0) > 0 && !ctx.cities.some((x) => x.buildings.some((id) => (BUILDINGS[id]?.effects.yields?.faith ?? 0) > 0))) v += 3 + pers.faith * 0.3;
    // Walls where they're needed: a city in danger, a border town once there are armies about, the capital.
    if (b.effects.defense) v += (threatTo(ctx, c) > 0.2 ? 4 : 0) + (frontier(ctx, c) && (ctx.wars.length || ctx.era >= 1) ? 1 + ctx.pers.defense * 0.15 : 0) + (c.capital && ctx.era >= 1 ? 0.8 : 0);
    if (v <= 0) continue;
    const score = (v * 100) / cost / (turns > 40 ? 2 : 1);
    if (score > bestScore) (bestScore = score), (best = { kind: 'building', id });
  }
  // A caravan while there are trade routes to fill.
  if (!p.cityState && trainable(game, p, c).includes('caravan') && routesOf(p).length + caravans < maxRoutes(game, p)) {
    const v = (4 + pers.gold * 0.3) * w.gold * 0.6;
    const score = (v * 100) / itemCost(game, { kind: 'unit', id: 'caravan' });
    if (score > bestScore) (bestScore = score), (best = { kind: 'unit', id: 'caravan' });
  }
  return best;
}

/** Whether the bot's army is well behind (under 60% of) that of a neighbour (a civ with a city within 10 tiles of one of its). */
function outgunned(ctx: Ctx): boolean {
  const { game } = ctx;
  const neighbours = new Set<number>();
  for (const o of game.cities) if (o.owner !== ctx.me && !game.players[o.owner].cityState && game.players[o.owner].civ !== 'barbarian' && ctx.cities.some((c) => dist(ctx, c.tile, o.tile) <= 10)) neighbours.add(o.owner);
  const mine = mightOf(ctx, ctx.me);
  return [...neighbours].some((o) => mine < mightOf(ctx, o) * 0.6);
}

/** Whether a city lies near another civ's city (a border town, for walls). */
function frontier(ctx: Ctx, c: City): boolean {
  return ctx.game.cities.some((o) => o.owner !== ctx.me && !ctx.game.players[o.owner].cityState && dist(ctx, o.tile, c.tile) <= 7);
}

/**
 * The bot's cities: each free city chooses, a new one replaces its founding order; a building (or a
 * unit, for the victory) is put aside for something pressing; each city's citizens set to work.
 */
export function manageCities(ctx: Ctx) {
  const chosen = (ctx.mem.chosen ??= {});
  for (const c of ctx.cities) {
    if (c.puppet) continue;
    const cur = c.queue[0];
    if (!cur || chosen[c.id] === undefined) {
      const item = pickProduction(ctx, c);
      if (!cur || cur.kind !== item.kind || cur.id !== item.id) act(ctx, { t: 'produce', city: c.id, item });
      chosen[c.id] = ctx.game.turn;
      continue;
    }
    // A city that has done its part in a World Congress project (or is now in danger) moves on.
    if (!ctx.p.cityState && leavesProject(ctx, c)) {
      const item = pickProduction(ctx, c);
      if ((item.kind !== cur.kind || item.id !== cur.id) && act(ctx, { t: 'produce', city: c.id, item })) chosen[c.id] = ctx.game.turn;
      continue;
    }
    // Something put aside (its production kept) for something pressing or for the victory, unless
    // it's nearly done: a building for either, a unit (not one a threatened city needs) for the victory
    // or a faithful capital's first shrine; a building, for a World Congress project it's wanted in.
    if (!ctx.p.cityState && !grand(cur)) {
      const left = (itemCost(ctx.game, cur) - c.prod) / Math.max(1, productionToward(ctx.game, c, cur));
      if (left <= 3) continue;
      const now = cur.kind === 'building' ? (urgent(ctx, c) ?? worldProject(ctx, c, threatTo(ctx, c)) ?? victoryProduction(ctx, c)) : threatTo(ctx, c) < 0.4 ? (earlyShrine(ctx, c) ?? victoryProduction(ctx, c)) : null;
      if (now && (now.kind !== cur.kind || now.id !== cur.id) && act(ctx, { t: 'produce', city: c.id, item: now })) chosen[c.id] = ctx.game.turn;
    }
  }
  if (!ctx.p.cityState) for (const c of ctx.cities) if (!c.puppet) setFocus(ctx, c);
  for (const id of Object.keys(chosen)) if (!ctx.cities.some((c) => c.id === Number(id))) delete chosen[Number(id)];
}

/** Gold: a defender for a city in danger, upgrades, then what the cities are building, keeping a reserve. */
export function spend(ctx: Ctx) {
  const { game, p } = ctx;
  if (p.cityState) return;
  const reserve = 25 + ctx.era * 15 + Math.max(0, -ctx.income) * 8;
  // A city in danger buys a defender.
  for (const c of ctx.cities) {
    if (threatTo(ctx, c) <= 1 || c.puppet) continue;
    const id = bestOf(ctx, c, 'defender');
    if (!id || placeFor(game, c, id) === undefined) continue;
    const cost = purchaseCost(game, p, UNITS[id].cost, 'unit');
    if (p.gold >= cost) act(ctx, { t: 'buy', city: c.id, item: { kind: 'unit', id }, with: 'gold' });
  }
  upgrades(ctx, reserve);
  // Luxuries and strategic resources just past the border, when they're cheap.
  if (p.gold > reserve + 100) buyTiles(ctx, reserve);
  // Discontent: buy the happiness building a city is making.
  if (ctx.mood < 0)
    for (const c of ctx.cities) {
      const item = c.queue[0];
      if (item?.kind !== 'building' || c.puppet || !cheer(item.id) || !canProduce(game, p, c, item)) continue;
      const cost = purchaseCost(game, p, BUILDINGS[item.id].cost, 'building');
      if (p.gold - cost >= reserve && act(ctx, { t: 'buy', city: c.id, item, with: 'gold' })) break;
    }
  // Rich: hurry what the cities are building (not wonders, which gold can't buy).
  const rival = diplomaticRival(ctx) !== null;
  for (const c of [...ctx.cities].sort((a, b) => b.pop - a.pop)) {
    const item = c.queue[0];
    if (!item || item.kind === 'project' || c.puppet) continue;
    if (item.kind === 'building' && BUILDINGS[item.id]?.kind === 'world') continue;
    if (item.kind === 'unit' && placeFor(game, c, item.id) === undefined) continue;
    if (!canProduce(game, p, c, item)) continue;
    const base = item.kind === 'unit' ? UNITS[item.id].cost : BUILDINGS[item.id].cost;
    const cost = purchaseCost(game, p, base, item.kind === 'unit' ? 'unit' : 'building');
    const left = itemCost(game, item) - c.prod;
    if (left < itemCost(game, item) * 0.4) continue;
    // (A diplomat, or anyone facing one, keeps gold for the city-states.)
    const pressing = item.id === 'settler' || item.id === 'worker';
    const keep = ctx.mem.aim === 'diplomatic' ? 250 : rival ? 350 : 30;
    if (p.gold - cost < (pressing ? 10 : reserve + keep)) continue;
    act(ctx, { t: 'buy', city: c.id, item, with: 'gold' });
  }
}

/** Old units made new while there's gold for it; the obsolete and unaffordable let go. */
function upgrades(ctx: Ctx, reserve: number) {
  const { game, p } = ctx;
  const res = strategic(game, p);
  const mine = game.units.filter((u) => u.owner === ctx.me && isMilitary(UNITS[u.type]));
  for (const u of mine) {
    const to = UNITS[u.type].upgrade;
    if (!to || game.tiles[u.tile].owner !== ctx.me) continue;
    const next = Object.values(UNITS).find((x) => x.civ === p.civ && x.replaces === to)?.id ?? to;
    const nt = UNITS[next];
    if (!nt?.tech || !knows(p, nt.tech)) continue;
    if (nt.resource && (res[nt.resource]?.have ?? 0) - (res[nt.resource]?.used ?? 0) <= 0) continue;
    const cost = Math.max(10, Math.floor((nt.cost - UNITS[u.type].cost) * 2 * (game.settings.speed === 'quick' ? 0.67 : 1)));
    if (p.gold - cost < reserve) continue;
    act(ctx, { t: 'upgrade', unit: u.id });
  }
  // Broke: the weakest soldiers beyond the garrisons go.
  if (ctx.income < 0 && p.gold + ctx.income * 3 < 0) {
    const spare = mine.filter((u) => !cityOn(ctx, u.tile) && UNITS[u.type].class !== 'great').sort((a, b) => unitMight(a) - unitMight(b));
    const over = mine.length - wants(ctx).military;
    for (const u of spare.slice(0, Math.max(1, over))) if (danger(ctx)[u.tile] === 0) act(ctx, { t: 'disband', unit: u.id });
    return;
  }
  // Paying out more than it makes (in peace, or with a thin treasury): one unit it can do without
  // goes a turn, an obsolete warship first, then ships beyond the navy it wants, then soldiers beyond
  // the army it wants.
  if (ctx.income < 0 && (!ctx.wars.length || p.gold < 200)) {
    const ships = mine.filter((u) => isWarship(u)).sort((a, b) => +isObsolete(ctx, b) - +isObsolete(ctx, a) || unitMight(a) - unitMight(b));
    const soldiers = mine.filter((u) => isSoldier(u) && !cityOn(ctx, u.tile)).sort((a, b) => unitMight(a) - unitMight(b));
    const extraShips = Math.max(ships.filter((u) => isObsolete(ctx, u)).length, ships.length - navyWanted(ctx));
    const extraSoldiers = mine.filter((u) => isSoldier(u)).length - wants(ctx).military;
    const spare = [...ships.slice(0, Math.max(0, extraShips)), ...soldiers.slice(0, Math.max(0, extraSoldiers))].find((u) => danger(ctx)[u.tile] === 0);
    if (spare) act(ctx, { t: 'disband', unit: spare.id });
  }
}

/** Whether a unit is out of date: its civ can build what replaced it. */
const isObsolete = (ctx: Ctx, u: Unit) => !!UNITS[u.type].obsolete && knows(ctx.p, UNITS[u.type].obsolete!);

/** Tiles worth buying: a luxury or strategic resource next to a city's land, if gold allows. */
function buyTiles(ctx: Ctx, reserve: number) {
  const { game, p } = ctx;
  for (const c of ctx.cities) {
    if (c.puppet) continue;
    for (const t of within(game.grid, c.tile, 3)) {
      const tile = game.tiles[t];
      if (tile.owner >= 0 || !tile.resource || RESOURCES[tile.resource].kind === 'bonus') continue;
      const cost = Math.floor((50 + 5 * c.tilesBought) * Math.max(1, dist(ctx, c.tile, t) - 1) * (game.settings.speed === 'quick' ? 0.67 : 1));
      if (p.gold - cost < reserve + 60) continue;
      if (act(ctx, { t: 'buyTile', city: c.id, tile: t })) return;
    }
  }
}

/** Faith: great people late in the game; buildings it buys (happiness and culture), missionaries for a faithful bot, a prophet with Piety done. */
export function spendFaith(ctx: Ctx) {
  const { game, p, pers } = ctx;
  if (p.cityState) return;
  buyGreatPerson(ctx);
  if (!p.religion) return;
  if (p.policies.includes('piety_done') && p.faith >= faithCost(game, 'great_prophet') && ctx.capital) act(ctx, { t: 'buy', city: ctx.capital.id, item: { kind: 'unit', id: 'great_prophet' }, with: 'faith' });
  // (Nothing is bought in a puppet.)
  const governed = ctx.cities.filter((c) => !c.puppet);
  for (const c of governed) {
    const options = faithBuildings(game, c).sort((a, b) => effectsValue(ctx, BUILDINGS[b].effects, c) - effectsValue(ctx, BUILDINGS[a].effects, c));
    if (options[0] && p.faith >= faithCost(game, options[0])) act(ctx, { t: 'buy', city: c.id, item: { kind: 'building', id: options[0] }, with: 'faith' });
  }
  // A city of its own lost to another faith: an inquisitor there (where the faith still has a foothold).
  const lost = governed.find((c) => cityReligion(c) && cityReligion(c) !== p.religion && canBuyReligious(game, p, c));
  const inquisitors = game.units.filter((u) => u.owner === ctx.me && u.type === 'inquisitor').length;
  if (lost && !inquisitors && p.faith >= faithCost(game, 'inquisitor')) act(ctx, { t: 'buy', city: lost.id, item: { kind: 'unit', id: 'inquisitor' }, with: 'faith' });
  // Missionaries: a faithful bot sends them as soon as it can; any other once faith piles up.
  const missionaries = game.units.filter((u) => u.owner === ctx.me && u.type === 'missionary').length;
  if (missionaries < (pers.faith >= 6 ? 3 : 2) && p.faith >= faithCost(game, 'missionary') + (pers.faith >= 8 ? 0 : pers.faith >= 6 ? 100 : 250)) {
    const home = governed.find((c) => cityReligion(c) === p.religion) ?? governed.find((c) => canBuyReligious(game, p, c));
    if (home) act(ctx, { t: 'buy', city: home.id, item: { kind: 'unit', id: 'missionary' }, with: 'faith' });
  }
}

/** The great people a bot's aim wants most, best first (the rest of those it may buy come after). */
const GREAT_WANTED: Record<Aim, string[]> = {
  science: ['great_scientist', 'great_engineer'],
  culture: ['great_writer', 'great_artist', 'great_musician'],
  diplomatic: ['great_merchant', 'great_scientist'],
  domination: ['great_general', 'great_engineer'],
};

/** From the Industrial Era, a great person bought with faith that has piled up (keeping a missionary's worth back for a religion's needs), the kind its aim wants most. */
function buyGreatPerson(ctx: Ctx) {
  const { game, p } = ctx;
  if (!ctx.capital) return;
  const wanted = GREAT_WANTED[ctx.mem.aim];
  const options = faithPurchases(game, p, ctx.capital).filter((x) => x.kind === 'unit' && isGreatPerson(x.id) && x.id !== 'great_prophet');
  const rank = (id: string) => (wanted.includes(id) ? wanted.indexOf(id) : wanted.length);
  const pick = options.sort((a, b) => rank(a.id) - rank(b.id))[0];
  if (pick && p.faith >= faithCost(game, pick.id, p) + (p.religion ? faithCost(game, 'missionary', p) : 0)) act(ctx, { t: 'buy', city: ctx.capital.id, item: pick, with: 'faith' });
}
