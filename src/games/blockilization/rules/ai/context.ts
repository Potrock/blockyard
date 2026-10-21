import { allyOf, cityStates } from '../citystates';
import { atWar, canStand, citiesOf, knows, seesUnit, unitsOf } from '../core';
import { dangerCost, dangerZones, type Danger } from '../danger';
import { happiness, type CityYields } from '../economy';
import { apply, eraOf, type Order } from '../game';
import { distance, neighbours, path, within } from '../hex';
import { ALL, occupants, stepCost } from '../movement';
import { questsFor, type QuestKind } from '../quests';
import type { City, Game, Player, Unit } from '../state';
import { teammates } from '../teams';
import { TERRAINS } from '../terrain';
import { unVote } from '../trade';
import { isGreatPerson, isMilitary, UNITS } from '../units';
import { memoryOf, type BotMemory } from './memory';
import { aimLeaning, personalityOf, type Personality } from './personality';
import { nearVictory } from './opinion';
import type { Wants } from './production';
import type { ProjectPlan } from './projects';

/**
 * What a bot knows at the start of its turn, worked out once and kept while it plays: its cities and
 * units, who's on each tile, whom it's at war with, where enemies could strike next turn, how strong
 * everyone is. Orders go through `act` (the rules' `apply`, as a person's do), which marks what they
 * may have changed to be looked at again.
 */

export interface Ctx {
  game: Game;
  p: Player;
  me: number;
  mem: BotMemory;
  pers: Personality;
  cities: City[];
  capital: City | undefined;
  era: number;
  /** Everyone it's at war with (barbarians too), and the civs and city-states among them. */
  enemies: Set<number>;
  wars: number[];
  mood: number;
  /** Gold a turn last turn (after upkeep). */
  income: number;
  /** Lazily worked out (see the functions below). */
  cache: {
    occupancy?: { military: Map<number, Unit>; civilian: Map<number, Unit> };
    danger?: Float32Array;
    might: Map<number, number>;
    cityTiles?: Map<number, City>;
    yields?: Map<number, CityYields>;
    wants?: Wants;
    sites?: Map<number, number>;
    frontier?: number[];
    edge?: Uint8Array;
    zones?: Danger | null;
    projects?: Map<string, ProjectPlan>;
  };
}

/** A bot's view of the game this turn. */
export function makeCtx(game: Game, p: Player): Ctx {
  const pers = personalityOf(p);
  const lean = aimLeaning(pers);
  const first = (Object.keys(lean) as (keyof typeof lean)[]).sort((a, b) => lean[b] - lean[a])[0];
  const enemies = new Set<number>();
  const wars: number[] = [];
  for (const o of game.players)
    if (o !== p && atWar(game, p.index, o.index)) {
      enemies.add(o.index);
      if (o.civ !== 'barbarian' && o.alive) wars.push(o.index);
    }
  const cities = citiesOf(game, p.index);
  return {
    game,
    p,
    me: p.index,
    mem: memoryOf(p, first),
    pers,
    cities,
    capital: cities.find((c) => c.capital),
    era: eraOf(p),
    enemies,
    wars,
    mood: happiness(game, p),
    income: p.lastIncome?.gold ?? 0,
    cache: { might: new Map() },
  };
}

/** Give an order as the bot (checked by the rules like anyone's); what it changed is looked at afresh. */
export function act(ctx: Ctx, o: Order): boolean {
  const r = apply(ctx.game, ctx.me, o);
  if (r.ok) {
    ctx.cache.occupancy = undefined;
    // (What it now sees may have moved the edge of the unknown.)
    ctx.cache.edge = undefined;
    if (o.t === 'found' || o.t === 'attack' || o.t === 'cityChoice') {
      ctx.cities = citiesOf(ctx.game, ctx.me);
      ctx.cache.cityTiles = undefined;
    }
  }
  return r.ok;
}

function occupancy(ctx: Ctx) {
  if (!ctx.cache.occupancy) {
    const military = new Map<number, Unit>();
    const civilian = new Map<number, Unit>();
    for (const u of ctx.game.units) {
      // (Aircraft hold no ground.)
      if (UNITS[u.type].domain === 'air') continue;
      if (!isMilitary(UNITS[u.type]) || isGreatPerson(u.type)) civilian.set(u.tile, u);
      // (At sea a ship and a soldier embarked beside it: the one an attack meets, as `occupants` says.)
      else military.set(u.tile, military.has(u.tile) ? occupants(ctx.game, u.tile).military! : u);
    }
    ctx.cache.occupancy = { military, civilian };
  }
  return ctx.cache.occupancy;
}

/** The military unit on a tile (anyone's). */
export const militaryAt = (ctx: Ctx, t: number) => occupancy(ctx).military.get(t);
/** The civilian on a tile (anyone's). */
export const civilianAt = (ctx: Ctx, t: number) => occupancy(ctx).civilian.get(t);

/** The city on a tile (anyone's). */
export function cityOn(ctx: Ctx, t: number): City | undefined {
  if (!ctx.cache.cityTiles) ctx.cache.cityTiles = new Map(ctx.game.cities.map((c) => [c.tile, c]));
  return ctx.cache.cityTiles.get(t);
}

/** A unit's fighting worth: its strength (ranged or melee, the better), less for its wounds. */
export function unitMight(u: Unit): number {
  const t = UNITS[u.type];
  if (!t || !isMilitary(t) || isGreatPerson(u.type)) return 0;
  return Math.max(t.strength, t.ranged ?? 0) * (0.4 + (0.6 * u.hp) / 100);
}

/** A player's military strength (all their units: Civ V's bots know the demographics). */
export function mightOf(ctx: Ctx, i: number): number {
  let m = ctx.cache.might.get(i);
  if (m === undefined) {
    m = unitsOf(ctx.game, i).reduce((s, u) => s + unitMight(u), 0);
    ctx.cache.might.set(i, m);
  }
  return m;
}

/**
 * Every tile's danger: the strength of the enemy units the bot can see that could strike it next turn
 * (their moves and their range), and of enemy cities' fire.
 */
export function danger(ctx: Ctx): Float32Array {
  if (ctx.cache.danger) return ctx.cache.danger;
  const { game, p } = ctx;
  const d = new Float32Array(game.tiles.length);
  // (And a civ that has warned it means war on this one: its army massing at the border may strike any turn.)
  const foes = new Set(ctx.enemies);
  for (const o of game.players) if (o.ai?.plan?.target === ctx.me && o.ai.plan.warned !== undefined) foes.add(o.index);
  for (const u of game.units) {
    if (!foes.has(u.owner) || !p.visible[u.tile]) continue;
    const type = UNITS[u.type];
    if (!isMilitary(type) || type.domain === 'air' || isGreatPerson(u.type)) continue;
    const reach = Math.min(5, type.moves + (type.ranged ? (type.range ?? 1) : 1));
    const power = unitMight(u);
    // A soldier ashore can't cross the water and strike in one turn (embarking takes the turn): other
    // land is in danger from it only within its fire.
    const ashore = type.domain === 'land' && !u.embarked;
    for (const t of within(game.grid, u.tile, reach)) {
      if (ashore && !TERRAINS[game.tiles[t].terrain].water && !sameLand(game, u.tile, t) && !(type.ranged && distance(game.grid, u.tile, t) <= (type.range ?? 1))) continue;
      d[t] += power;
    }
  }
  for (const c of game.cities) if (ctx.enemies.has(c.owner) && p.explored[c.tile]) for (const t of within(game.grid, c.tile, 2)) d[t] += 10 + c.pop;
  ctx.cache.danger = d;
  return d;
}

const regionCache = new WeakMap<Game, Int32Array>();

/** Land masses: each land tile's region (tiles a land unit can walk between), -1 for water and peaks. */
export function regions(game: Game): Int32Array {
  let r = regionCache.get(game);
  if (r) return r;
  r = new Int32Array(game.tiles.length).fill(-1);
  const passable = (t: number) => !TERRAINS[game.tiles[t].terrain].water && game.tiles[t].elevation !== 'mountain' && game.tiles[t].feature !== 'ice';
  let next = 0;
  for (let s = 0; s < game.tiles.length; s++) {
    if (r[s] >= 0 || !passable(s)) continue;
    const stack = [s];
    r[s] = next;
    while (stack.length) {
      const t = stack.pop()!;
      for (const n of within(game.grid, t, 1)) if (r[n] < 0 && passable(n)) (r[n] = next), stack.push(n);
    }
    next++;
  }
  regionCache.set(game, r);
  return r;
}

/**
 * Whether a unit could stop on a tile (the rules' `canEnter`, from the turn's lookups); or, `passing`,
 * go through it on its way (its own units don't bar the way then, as the rules have it).
 */
export function passable(ctx: Ctx, u: Unit, t: number, passing = false): boolean {
  const { game } = ctx;
  const type = UNITS[u.type];
  if (!canStand(game, u.type, t) && !(type.domain === 'land' && TERRAINS[game.tiles[t].terrain].water && knows(game.players[u.owner], 'optics'))) return false;
  const city = cityOn(ctx, t);
  if (city && city.owner !== u.owner) return false;
  const m = militaryAt(ctx, t);
  const c = civilianAt(ctx, t);
  const military = isMilitary(type) && !isGreatPerson(u.type);
  if (m && m.owner !== u.owner) return false;
  if (c && c.owner !== u.owner && !military) return false;
  // (A caravan, cargo ship or great person may stop in its own city beside another civilian, as the rules have it.)
  if (!passing && (military ? m && m !== u : c && c !== u && !((type.abilities?.includes('trade_route') || isGreatPerson(u.type)) && city?.owner === u.owner))) return false;
  const owner = game.tiles[t].owner;
  if (military && owner >= 0 && owner !== u.owner && !atWar(game, u.owner, owner)) {
    const them = game.players[owner];
    if (!them.cityState && !them.diplomacy.openBorders[u.owner]) return false;
  }
  return true;
}

/**
 * The way a unit would take to a tile (as the rules would find it, but from the turn's lookups); null if
 * there's none. Round its own units where it can (through them where it can't); and a land unit ashore
 * going somewhere on its own land keeps to the land, through them if need be, rather than take to the
 * water: embarked it can't fight back, and a way round its own army by sea was where most of the bots'
 * soldiers lost at sea died.
 */
export function route(ctx: Ctx, u: Unit, to: number): number[] | null {
  const { game } = ctx;
  const moves = UNITS[u.type].moves;
  const land = UNITS[u.type].domain === 'land';
  const water = (t: number) => !!TERRAINS[game.tiles[t].terrain].water;
  const zones = warZones(ctx);
  const ashore = land && !u.embarked && sameLand(game, u.tile, to);
  const way = (passing: boolean) =>
    path(game.grid, u.tile, to, (a, b) => {
      const c = stepCost(game, u, a, b);
      if (!Number.isFinite(c)) return Infinity;
      if (b !== to && !passable(ctx, u, b, passing)) return Infinity;
      // (Through its own units on its own land, it's to keep to the land: the water costs it dear.)
      const step = (c >= ALL ? moves : c) + (passing && ashore && water(b) ? 10 : 0);
      // (Out of enemy cities' fire and away from enemy soldiers where a way round costs little more, as the rules' own paths.)
      return zones ? step + dangerCost(zones, b, moves, land && water(b)) : step;
    }, 2500);
  const round = way(false);
  if (round && (!ashore || !round.some(water))) return round;
  // (Hemmed in by its own, or kept to the land: through them.)
  return way(true) ?? round;
}

/** The danger zones of the bot's wars (the enemy cities it has seen, the enemy soldiers in sight), worked out once a turn; none in peace. */
function warZones(ctx: Ctx): Danger | null {
  if (ctx.cache.zones !== undefined) return ctx.cache.zones;
  const { game, p } = ctx;
  const cities = ctx.wars.length ? game.cities.filter((c) => ctx.enemies.has(c.owner) && p.explored[c.tile]).map((c) => c.tile) : [];
  const soldiers = ctx.wars.length ? game.units.filter((m) => ctx.enemies.has(m.owner) && isMilitary(UNITS[m.type]) && UNITS[m.type].domain !== 'air' && p.visible[m.tile] > 0 && seesUnit(game, p, m)).map((m) => m.tile) : [];
  return (ctx.cache.zones = cities.length || soldiers.length ? dangerZones(game.grid, cities, soldiers) : null);
}

/**
 * Send a unit toward a tile, as far as its moves take it this turn (the rules then only look for the
 * way over those few tiles); nothing if there's no way there. True when it's arrived. It goes through
 * its own units, but stops short of a tile one holds; a civilian kept out of enemy reach (`danger`)
 * stops short of that, at the last tile on the way out of reach.
 */
export function goTo(ctx: Ctx, u: Unit, to: number, why: string, danger?: Float32Array): boolean {
  if (u.tile === to) {
    delete ctx.mem.orders[u.id];
    return true;
  }
  ctx.mem.orders[u.id] = { to, why };
  if (u.moves <= 0) return false;
  const way = route(ctx, u, to);
  if (!way?.length) {
    delete ctx.mem.orders[u.id];
    return false;
  }
  let left = u.moves;
  let at = u.tile;
  let stop = way[0];
  // (The last tile on the way it may stop on, and the last of those out of reach.)
  let free = u.tile;
  let safe = u.tile;
  for (const t of way) {
    const cost = stepCost(ctx.game, u, at, t);
    stop = at = t;
    if (passable(ctx, u, t)) {
      free = t;
      if (!danger?.[t]) safe = t;
    }
    left -= cost >= ALL ? left : cost;
    if (left <= 0) break;
  }
  if (danger?.[stop] || !passable(ctx, u, stop)) stop = danger ? safe : free;
  if (stop === u.tile) return false;
  act(ctx, { t: 'move', unit: u.id, to: stop });
  return u.tile === to;
}

/**
 * The way over land between two tiles by the lie of the land alone (hills and woods slower), ignoring
 * who's where; null if there's none. For a civ (`by`), not through the land of a third civ whose
 * borders are closed to it (its army couldn't march that way), the civ it means to fight (`foe`) aside.
 */
export function landRoute(game: Game, from: number, to: number, by?: Player, foe?: number): number[] | null {
  return path(game.grid, from, to, (_a, b) => {
    const tile = game.tiles[b];
    if (TERRAINS[tile.terrain].water || tile.elevation === 'mountain' || tile.feature === 'ice') return Infinity;
    if (by && tile.owner >= 0 && tile.owner !== by.index && tile.owner !== foe && b !== to) {
      const them = game.players[tile.owner];
      if (!them.cityState && them.civ !== 'barbarian' && !atWar(game, by.index, tile.owner) && !them.diplomacy.openBorders[by.index]) return Infinity;
    }
    return tile.elevation === 'hills' || tile.feature === 'forest' || tile.feature === 'jungle' || tile.feature === 'marsh' ? 2 : 1;
  }, 3000);
}

/**
 * The way between two tiles over land and, for a civ that can embark (Optics), along the coast (and
 * over the ocean with Astronomy), by the lie of the land alone; null if there's none.
 */
export function seaRoute(game: Game, p: Player, from: number, to: number): number[] | null {
  const embark = knows(p, 'optics');
  const ocean = knows(p, 'astronomy');
  return path(game.grid, from, to, (_a, b) => {
    const tile = game.tiles[b];
    if (tile.elevation === 'mountain' || tile.feature === 'ice') return Infinity;
    if (TERRAINS[tile.terrain].water) return embark && (tile.terrain !== 'ocean' || ocean) ? 1 : Infinity;
    return tile.elevation === 'hills' || tile.feature === 'forest' || tile.feature === 'jungle' || tile.feature === 'marsh' ? 2 : 1;
  }, 4000);
}

/** Whether a tile is on the coast (next to the sea or a lake). */
export const coastal = (game: Game, t: number) => neighbours(game.grid, t).some((n) => TERRAINS[game.tiles[n].terrain].water);

/** The city-states' open quests of a kind the bot could still do (each with where, if anywhere). */
export function questsAsked(ctx: Ctx, kind: QuestKind): { cs: number; at: number | null }[] {
  return cityStates(ctx.game).flatMap((cs) => questsFor(ctx.game, ctx.p, cs).filter((q) => q.kind === kind && !q.done).map((q) => ({ cs: cs.index, at: q.at })));
}

/** The tiles the bot knows that border the unknown (1), worked out once a turn: where explorers look. */
export function unknownEdge(ctx: Ctx): Uint8Array {
  if (ctx.cache.edge) return ctx.cache.edge;
  const { game, p } = ctx;
  const edge = new Uint8Array(game.tiles.length);
  for (let t = 0; t < game.tiles.length; t++) if (p.explored[t] && neighbours(game.grid, t).some((n) => !p.explored[n])) edge[t] = 1;
  return (ctx.cache.edge = edge);
}

/** Whether two tiles are on the same land. */
export const sameLand = (game: Game, a: number, b: number) => {
  const r = regions(game);
  return r[a] >= 0 && r[a] === r[b];
};

/**
 * A rival close to a diplomatic victory, if there is one: from turn 80, once the United Nations
 * stands the civ within three votes of being World Leader; else (or with none so near) the civ that has
 * half the city-states as allies (whose votes, with the United Nations', would carry the world).
 */
export function diplomaticRival(ctx: Ctx): number | null {
  const { game } = ctx;
  if (!game.settings.victories.diplomatic || game.turn < 80) return null;
  // With the United Nations standing: the civ (not of its team) within three votes of being World Leader.
  if (game.wonders['united_nations'] !== undefined) {
    const { votes, needed } = unVote(game, allyOf);
    const near = [...votes].filter(([i, n]) => i !== ctx.me && !teammates(game, ctx.me, i) && n >= needed - 3).sort((a, b) => b[1] - a[1])[0];
    if (near) return near[0];
  }
  const all = cityStates(game);
  const allies = new Map<number, number>();
  for (const cs of all) {
    const a = allyOf(game, cs.index);
    if (a >= 0) allies.set(a, (allies.get(a) ?? 0) + 1);
  }
  const top = [...allies].filter(([i]) => i !== ctx.me).sort((a, b) => b[1] - a[1])[0];
  return top && all.length >= 2 && top[1] >= Math.ceil(all.length / 2) ? top[0] : null;
}

/** Rivals close to winning (`opinion.nearVictory`). */
export function runaways(ctx: Ctx): Set<number> {
  const out = new Set<number>();
  for (const o of ctx.game.players) if (o.index !== ctx.me && o.alive && !o.cityState && o.civ !== 'barbarian' && nearVictory(ctx.game, o)) out.add(o.index);
  return out;
}

/** The bot's city nearest a tile. */
export function nearestCity(ctx: Ctx, t: number, cities = ctx.cities): City | undefined {
  let best: City | undefined;
  let d = Infinity;
  for (const c of cities) {
    const x = dist(ctx, c.tile, t);
    if (x < d) (d = x), (best = c);
  }
  return best;
}

/** Steps between two tiles. */
export const dist = (ctx: Ctx, a: number, b: number) => distance(ctx.game.grid, a, b);
