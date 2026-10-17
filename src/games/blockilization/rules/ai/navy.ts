import { canFire, rangeOf } from '../combat';
import { canStand } from '../core';
import { trainable } from '../game';
import { neighbours, within } from '../hex';
import { stepCost } from '../movement';
import type { City, Game, Unit } from '../state';
import { TERRAINS } from '../terrain';
import { isMilitary, UNITS } from '../units';
import { act, cityOn, danger, dist, goTo, militaryAt, type Ctx } from './context';

/**
 * The bots' ships. A bot with a coast keeps a few: one to explore the seas while there's more of the
 * world to find, more for a war across the water (to guard the army at sea and batter the city from
 * the water), more when enemy ships are seen off its shores. They sail with an invasion, bombard enemy
 * cities on the coast in a war, chase enemy ships and embarked armies near home, and otherwise keep
 * station off their own cities; the damaged put into port.
 */

const seaCache = new WeakMap<Game, Int32Array>();

/** The size of the body of open water (not ice) each tile is in (0 for land and ice). */
function waters(game: Game): Int32Array {
  let size = seaCache.get(game);
  if (size) return size;
  size = new Int32Array(game.tiles.length);
  const water = (t: number) => TERRAINS[game.tiles[t].terrain].water && game.tiles[t].feature !== 'ice';
  for (let s = 0; s < game.tiles.length; s++) {
    if (size[s] || !water(s)) continue;
    const body = [s];
    size[s] = -1;
    for (let i = 0; i < body.length; i++) for (const n of neighbours(game.grid, body[i])) if (!size[n] && water(n)) (size[n] = -1), body.push(n);
    for (const t of body) size[t] = body.length;
  }
  seaCache.set(game, size);
  return size;
}

/** Whether a city is on the sea (its ships can get somewhere): next to water bigger than a lake. */
export const seaport = (ctx: Ctx, c: City) => neighbours(ctx.game.grid, c.tile).some((t) => waters(ctx.game)[t] >= 20);

/** Whether a unit is a warship (not a work boat or a cargo ship). */
export const isWarship = (u: Unit) => UNITS[u.type].domain === 'sea' && isMilitary(UNITS[u.type]);

/** Enemy ships and embarked units the bot can see near its cities. */
function threatsAtSea(ctx: Ctx): Unit[] {
  return ctx.game.units.filter((u) => ctx.enemies.has(u.owner) && ctx.p.visible[u.tile] && (isWarship(u) || u.embarked) && ctx.cities.some((c) => dist(ctx, c.tile, u.tile) <= 8));
}

/** Sea tiles the bot has seen that border the unknown (where a ship would find more of the world), worked out once a turn. */
function seaFrontier(ctx: Ctx): number[] {
  const { game, p } = ctx;
  if (ctx.cache.frontier) return ctx.cache.frontier;
  const out: number[] = (ctx.cache.frontier = []);
  for (let t = 0; t < game.tiles.length; t++) {
    if (!p.explored[t] || !TERRAINS[game.tiles[t].terrain].water) continue;
    if (game.tiles[t].terrain === 'ocean' && !p.techs.includes('astronomy')) continue;
    if (neighbours(game.grid, t).some((n) => !p.explored[n])) out.push(t);
  }
  return out;
}

/** How many warships the bot wants now (one to explore the seas while there's more to find), as far as its income allows. */
export function navyWanted(ctx: Ctx): number {
  if (ctx.p.cityState || !ctx.cities.some((c) => seaport(ctx, c))) return 0;
  let n = ctx.game.turn > 25 && seaFrontier(ctx).length > 4 ? 1 : 0;
  if (ctx.mem.plan?.amphibious) n += 2 + Math.floor(ctx.era / 2);
  n += Math.min(3, threatsAtSea(ctx).length);
  if (ctx.era >= 3 && ctx.cities.filter((c) => seaport(ctx, c)).length >= 2) n += 1;
  // No more than the treasury bears (a ship for every few gold of income), bar a war across the water.
  const affordable = ctx.income < 0 ? 0 : 1 + Math.floor(ctx.income / 4);
  return Math.min(6, n, Math.max(affordable, ctx.mem.plan?.amphibious ? 2 : 0));
}

/** The best warship a city can build now (a bombarding one once there are, else the strongest). */
export function bestShip(ctx: Ctx, c: City): string | undefined {
  const can = trainable(ctx.game, ctx.p, c).filter((id) => {
    const t = UNITS[id];
    return t.domain === 'sea' && isMilitary(t) && (t.class === 'naval_melee' || t.class === 'naval_ranged');
  });
  const power = (id: string) => Math.max(UNITS[id].strength, UNITS[id].ranged ?? 0) + (UNITS[id].class === 'naval_ranged' ? 5 : 0);
  return can.sort((a, b) => power(b) - power(a))[0];
}

/** A free sea tile for a ship near `around` (within `radius`), the nearest to it first, that suits `ok`. */
function seaSpot(ctx: Ctx, u: Unit, around: number, radius: number, claimed: Set<number>, ok: (t: number) => boolean = () => true): number | undefined {
  const { game } = ctx;
  let best: number | undefined;
  let bestScore = Infinity;
  for (const t of within(game.grid, around, radius)) {
    if (claimed.has(t) || !TERRAINS[game.tiles[t].terrain].water || !canStand(game, u.type, t)) continue;
    if (game.tiles[t].terrain === 'ocean' && UNITS[u.type].abilities?.includes('coast_only') && !ctx.p.techs.includes('astronomy')) continue;
    const m = militaryAt(ctx, t);
    if ((m && m !== u) || !ok(t)) continue;
    const s = dist(ctx, around, t) * 2 + dist(ctx, u.tile, t) * 0.5;
    if (s < bestScore) (bestScore = s), (best = t);
  }
  return best;
}

/** Every warship's turn. */
export function moveNavy(ctx: Ctx, ships: Unit[], claimed: Set<number>) {
  const { game, mem } = ctx;
  const plan = mem.plan;
  const target = plan?.stage === 'attack' ? game.cities.find((c) => c.id === plan.city) : undefined;
  // An invasion afloat (the boats sailing for the beach), and the enemy's warships about it.
  const afloat = target && plan?.amphibious ? game.units.filter((u) => u.owner === ctx.me && u.embarked && mem.orders[u.id]?.why === 'invade') : [];
  const raiders = game.units.filter((x) => ctx.enemies.has(x.owner) && isWarship(x) && ctx.p.visible[x.tile] && afloat.some((a) => dist(ctx, a.tile, x.tile) <= 5));
  const threats = threatsAtSea(ctx);
  // Settlers afloat with enemies about them (each to be guarded by one ship).
  const d = danger(ctx);
  const voyagers = game.units.filter((u) => u.owner === ctx.me && u.embarked && u.type === 'settler' && within(game.grid, u.tile, 2).some((t) => d[t] > 0));
  const escorted = new Set<number>();
  const hold = (u: Unit) => {
    delete mem.orders[u.id];
    if (!u.stance && u.moves > 0) act(ctx, { t: 'stance', unit: u.id, stance: 'fortify' });
  };
  // Enemy coastal cities in reach, for bombarding in a war.
  const shores = ctx.wars.length ? game.cities.filter((c) => ctx.enemies.has(c.owner) && ctx.p.explored[c.tile] && neighbours(game.grid, c.tile).some((t) => TERRAINS[game.tiles[t].terrain].water)) : [];
  // One ship explores the seas while there's more to find: to meet the other civs, and find their coasts.
  // (The one exploring already, else the fastest that can get to the unknown.)
  const frontier = new Set(ships.length ? seaFrontier(ctx) : []);
  let scout: Unit | undefined;
  if (frontier.size && !(target && plan?.amphibious && ships.length <= 2)) {
    // (Two tries at most: a search of the seas is dear.)
    const ready = ships.filter((u) => u.moves > 0 && u.hp >= 50).sort((a, b) => +(mem.orders[b.id]?.why === 'scout') - +(mem.orders[a.id]?.why === 'scout') || UNITS[b.type].moves - UNITS[a.type].moves);
    for (const u of ready.slice(0, 2)) {
      if (!exploreSea(ctx, u, 'scout')) continue;
      scout = u;
      break;
    }
  }
  for (const u of ships) {
    if (u.moves <= 0 || u === scout) continue;
    const ranged = !!UNITS[u.type].ranged;
    // Damaged: into the nearest port.
    if (u.hp < 50) {
      const port = ctx.cities.filter((c) => seaport(ctx, c) && (!militaryAt(ctx, c.tile) || militaryAt(ctx, c.tile) === u)).sort((a, b) => dist(ctx, a.tile, u.tile) - dist(ctx, b.tile, u.tile))[0];
      if (port && goTo(ctx, u, port.tile, 'port')) hold(u);
      continue;
    }
    let spot: number | undefined;
    // A settler at sea with danger about it: the nearest warship beside it.
    const voyager = voyagers.find((v) => !escorted.has(v.id));
    if (voyager && dist(ctx, voyager.tile, u.tile) <= 8) {
      spot = seaSpot(ctx, u, voyager.tile, 1, claimed);
      if (spot !== undefined) escorted.add(voyager.id);
    }
    // An invasion afloat: the melee ships after the enemy's warships about the boats, else beside the
    // boat furthest on (the ranged keep battering the city).
    if (spot === undefined && afloat.length && !ranged) {
      const prey = [...raiders].sort((a, b) => dist(ctx, a.tile, u.tile) - dist(ctx, b.tile, u.tile))[0];
      const lead = [...afloat].sort((a, b) => dist(ctx, a.tile, target!.tile) - dist(ctx, b.tile, target!.tile))[0];
      spot = seaSpot(ctx, u, prey?.tile ?? lead.tile, 1, claimed);
    }
    // With an invasion: off the target city (to batter it) or off the beach (to guard the landing).
    if (spot === undefined && target && plan?.amphibious) {
      spot = ranged ? seaSpot(ctx, u, target.tile, rangeOf(u), claimed, (t) => canFire(game, t, target.tile, rangeOf(u))) : plan.landing !== undefined ? seaSpot(ctx, u, plan.landing, 2, claimed) : undefined;
    }
    // Enemies at sea near home: after them.
    if (spot === undefined && threats.length) {
      const prey = [...threats].sort((a, b) => dist(ctx, a.tile, u.tile) - dist(ctx, b.tile, u.tile))[0];
      if (dist(ctx, prey.tile, u.tile) <= 10) spot = seaSpot(ctx, u, prey.tile, ranged ? rangeOf(u) : 1, claimed);
    }
    // A war: bombard the nearest enemy city on the coast (ranged ships), the melee ones with them.
    if (spot === undefined && shores.length) {
      const city = [...shores].sort((a, b) => dist(ctx, a.tile, u.tile) - dist(ctx, b.tile, u.tile))[0];
      if (dist(ctx, city.tile, u.tile) <= 14) spot = seaSpot(ctx, u, city.tile, ranged ? rangeOf(u) : 2, claimed, (t) => !ranged || canFire(game, t, city.tile, rangeOf(u)));
    }
    // Otherwise: on station off the bot's own city with the fewest ships about.
    if (spot === undefined) {
      const home = ctx.cities.filter((c) => seaport(ctx, c)).sort((a, b) => guards(ctx, a) - guards(ctx, b) || dist(ctx, a.tile, u.tile) - dist(ctx, b.tile, u.tile))[0];
      spot = home && seaSpot(ctx, u, home.tile, 2, claimed);
    }
    if (spot === undefined) {
      hold(u);
      continue;
    }
    claimed.add(spot);
    if (goTo(ctx, u, spot, 'sea')) hold(u);
  }
}

/**
 * A ship's exploring step (a bot's scout, or a person's ship set to explore): toward the nearest edge
 * of the known sea it can sail to, keeping out of enemy reach. False if there's none left.
 */
export function exploreSea(ctx: Ctx, u: Unit, why = 'explore'): boolean {
  const frontier = new Set(seaFrontier(ctx));
  if (!frontier.size) return false;
  const d = danger(ctx);
  const goal = nearestBySea(ctx, u, (t) => frontier.has(t) && !militaryAt(ctx, t) && !d[t]);
  if (goal === undefined) return false;
  goTo(ctx, u, goal, why, d);
  return true;
}

/** The nearest tile a ship can sail to that suits `ok` (searching outward over the water it can sail), if any. */
function nearestBySea(ctx: Ctx, u: Unit, ok: (t: number) => boolean): number | undefined {
  const { game } = ctx;
  const seen = new Uint8Array(game.tiles.length);
  const queue = [u.tile];
  seen[u.tile] = 1;
  for (let i = 0; i < queue.length; i++) {
    const t = queue[i];
    if (t !== u.tile && ok(t)) return t;
    for (const n of neighbours(game.grid, t)) {
      if (seen[n]) continue;
      seen[n] = 1;
      if (TERRAINS[game.tiles[n].terrain].water && Number.isFinite(stepCost(game, u, t, n))) queue.push(n);
    }
  }
  return undefined;
}

/** The bot's warships off a city (within two tiles). */
const guards = (ctx: Ctx, c: City) => ctx.game.units.filter((u) => u.owner === ctx.me && isWarship(u) && dist(ctx, u.tile, c.tile) <= 2 && !cityOn(ctx, u.tile)).length;
