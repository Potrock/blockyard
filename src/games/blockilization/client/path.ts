import type { UnitWire, View } from '../protocol';
import { dangerCost, dangerZones, type Danger } from '../rules/danger';
import { ALL, findWay, neighbours, type Walker } from '../rules/hex';
import { FEATURES, HILLS, RAIL_MOVE, ROAD_MOVE, TERRAINS } from '../rules/terrain';
import { isGreatPerson, isMilitary, UNITS } from '../rules/units';
import { cityAt, enemyAt, me, outOfReach, store } from './store';

/**
 * The way a unit would go, as this screen can tell (the server works out the real one when it's
 * ordered): the rules' costs for each step (terrain, roads and railroads, rivers without bridges,
 * embarking and landing), units and cities in the way, closed borders and (in a war) the danger near
 * enemy cities and soldiers, as far as it knows them; and the turn each step is reached on, as the
 * unit's moves would carry it (Civ V's turn markers).
 * Worked out once for each unit, place and destination, not every frame.
 */


/** A planned route: the tiles after the unit's own, and the turn each is reached on (0: this turn). */
export interface Route {
  tiles: number[];
  turns: number[];
}

/** What a unit's moves cost it, step by step, and where it may step, as this screen knows the map. */
function mover(u: UnitWire, view: View) {
  const type = UNITS[u.type];
  const techs = new Set(view.self.techs);
  const military = !!type && isMilitary(type) && !isGreatPerson(u.type);
  /** Movement points to step from a to its neighbour b (Infinity: can't), as `movement.ts` counts them. */
  const cost = (a: number, b: number): number => {
    const to = store.terrain[b];
    const from = store.terrain[a];
    const kTo = store.known[b];
    const kFrom = store.known[a];
    if (!type || !to || !from || !kTo) return Infinity;
    if (to.elevation === 'mountain' || to.feature === 'ice') return Infinity;
    const water = !!TERRAINS[to.terrain].water;
    if (type.domain === 'sea') {
      const city = cityAt(b);
      if (!water && !(city && city.owner === me())) return Infinity;
      if (to.terrain === 'ocean' && type.abilities?.includes('coast_only') && !techs.has('astronomy')) return Infinity;
      return 1;
    }
    if (type.domain === 'air') return 1;
    if (water) {
      if (!techs.has('optics') || (to.terrain === 'ocean' && !techs.has('astronomy'))) return Infinity;
      return TERRAINS[from.terrain].water ? 1 : ALL;
    }
    if (TERRAINS[from.terrain].water) return ALL;
    if (kFrom?.road && kTo.road && !kFrom.pillaged && !kTo.pillaged) return kFrom.road === 'rail' && kTo.road === 'rail' ? RAIL_MOVE : techs.has('machinery') ? ROAD_MOVE * 0.75 : ROAD_MOVE;
    if (type.abilities?.includes('ignore_terrain')) return 1;
    let c = to.elevation === 'hills' ? HILLS.move : TERRAINS[to.terrain].move;
    if (to.feature) c = Math.max(c, FEATURES[to.feature].move);
    if (to.river && !from.river && !techs.has('construction')) c = ALL;
    return c;
  };
  /** Whether it could stop on a tile (or, `passing`, go through it: its own side's units don't bar the way): one unit of each kind to a tile, no foreign city, closed borders. */
  const canEnter = (t: number, passing = false): boolean => {
    for (const x of view.units) {
      if (x.tile !== t || x.id === u.id) continue;
      const xType = UNITS[x.type];
      const xMilitary = !!xType && isMilitary(xType) && !isGreatPerson(x.type);
      if (x.owner !== me() ? xMilitary || !military || passing || !view.players[x.owner]?.war : xMilitary === military && !passing) return false;
    }
    const city = cityAt(t);
    if (city && city.owner !== me()) return false;
    const owner = store.known[t]?.owner ?? -1;
    const them = owner >= 0 && owner !== me() ? view.players[owner] : undefined;
    return !(military && them && !them.war && !them.cityState && !them.opensBorders);
  };
  /** Next to an enemy unit or city (a zone of control: stepping from one into another ends the move). */
  const zoc = (t: number) =>
    neighbours(store.grid!, t).some((n) => {
      const city = cityAt(n);
      if (city && view.players[city.owner]?.war) return true;
      return view.units.some((x) => x.tile === n && view.players[x.owner]?.war && isMilitary(UNITS[x.type]) && store.known[n]?.visible);
    });
  /** What it knows of the war round it (worked out on first asking): the enemy cities it has seen, the enemy soldiers in sight, as `movement.ts` plans paths. */
  let danger: Danger | null | undefined;
  const dangerNow = (): Danger | null => {
    const war = (owner: number) => owner !== me() && !!view.players[owner]?.war;
    const cities = view.cities.filter((c) => war(c.owner)).map((c) => c.tile);
    const soldiers = view.units.filter((x) => war(x.owner) && isMilitary(UNITS[x.type]) && UNITS[x.type].domain !== 'air' && store.known[x.tile]?.visible).map((x) => x.tile);
    return cities.length || soldiers.length ? dangerZones(store.grid!, cities, soldiers) : null;
  };
  /** What a step onto a tile costs a plan for its danger, on top of its moves. */
  const risk = (t: number): number => {
    if (danger === undefined) danger = dangerNow();
    return danger ? dangerCost(danger, t, type?.moves ?? 2, type?.domain === 'land' && !!TERRAINS[store.terrain[t].terrain].water) : 0;
  };
  return { type, military, cost, canEnter, zoc, risk };
}

/** A unit's moves a turn (the rules' `maxMoves`, sent with it; else its kind's, Mobility adding one). */
export const fullMoves = (u: UnitWire) => u.maxMoves ?? (UNITS[u.type]?.moves ?? 2) + (u.promotions?.includes('mobility') ? 1 : 0);

/** The turn each tile of a route is reached on, as the unit's moves would carry it (as `movement.ts` advances it). */
export function routeTurns(u: UnitWire, tiles: number[]): number[] {
  const view = store.view;
  if (!view || !store.grid) return tiles.map(() => 0);
  const m = mover(u, view);
  const full = fullMoves(u);
  let left = u.moves ?? 0;
  let turn = 0;
  let at = u.tile;
  const halts = (a: number, b: number) => m.military && !m.type?.abilities?.includes('ignore_terrain') && m.zoc(a) && m.zoc(b);
  /** Whether from `from` with `moves` it comes out past its own units ahead (from `i`) onto a tile it may stop on this turn (`throughOwn`). */
  const comesOut = (from: number, i: number, moves: number) => {
    let here = from;
    for (let j = i; j < tiles.length; j++) {
      if (moves <= 0) return false;
      const step = m.cost(here, tiles[j]);
      if (!Number.isFinite(step) || step >= ALL) return false;
      if (m.canEnter(tiles[j])) return true;
      if (halts(here, tiles[j])) return false;
      moves -= step;
      here = tiles[j];
    }
    return false;
  };
  return tiles.map((t, i) => {
    // (Into its own units only if it comes out past them this turn: else it waits here, as the rules' `advance` does.)
    if (left <= 0 || (left < full && i < tiles.length - 1 && !m.canEnter(t) && !comesOut(at, i, left))) {
      turn++;
      left = full;
    }
    const step = m.cost(at, t);
    left = step >= ALL ? 0 : Math.max(0, left - step);
    if (halts(at, t)) left = 0;
    at = t;
    return turn;
  });
}

/** Whether a unit could ever stand on a tile (the quick no, before any search): known, and its kind of ground (aircraft don't walk: they rebase). */
function reachable(u: UnitWire, to: number): boolean {
  const s = store.terrain[to];
  const type = UNITS[u.type];
  if (!s || !store.known[to] || !type || type.domain === 'air') return false;
  if (s.elevation === 'mountain' || s.feature === 'ice') return false;
  const water = !!TERRAINS[s.terrain].water;
  const techs = store.view!.self.techs;
  if (type.domain === 'sea') return water || cityAt(to)?.owner === me();
  if (water && type.domain === 'land') return techs.includes('optics') && (s.terrain !== 'ocean' || techs.includes('astronomy'));
  return true;
}

let cached: { key: string; view: View | null; route: Route | null } = { key: '', view: null, route: null };
/** The last way asked for (unit, place, destination) that only its own units barred: the way through them would end a turn on one. */
let ownInWay = '';

/** The route a unit would take to a tile (null: no way there), worked out once for each unit, place and destination. */
export function previewPath(u: UnitWire, to: number): Route | null {
  const g = store.grid;
  const view = store.view;
  if (!g || !view) return null;
  const key = `${u.id}|${u.tile}|${u.moves}|${to}`;
  if (cached.key === key && cached.view === view) return cached.route;
  let route: Route | null = null;
  // One of its own of its kind next to it: the two swap places (as the rules do).
  if (swapsWith(u, to)) route = { tiles: [to], turns: [0] };
  // (Never onto one of its own of its kind, one soldier and one civilian to a tile; nor onto another
  // civ's unit it isn't at war with; nor into land closed to it; nor, for a civilian, at an enemy.)
  else if (to !== u.tile && reachable(u, to) && !ownThere(u, to) && !neutralThere(to) && !closedTo(u, to) && (soldier(u) || !enemyAt(to))) {
    const m = mover(u, view);
    // Turn by turn, as the rules find it (`findWay`): through its own side's units, its turns ending
    // only where it may stop (it waits short of one of its own instead), what enemy fire reaches
    // costing more. (Each tile's answers asked once.)
    const memo = (f: (t: number) => boolean) => {
      const known = new Map<number, boolean>();
      return (t: number) => {
        let x = known.get(t);
        if (x === undefined) known.set(t, (x = f(t)));
        return x;
      };
    };
    const zoc = m.military && !m.type?.abilities?.includes('ignore_terrain') ? memo(m.zoc) : null;
    const walker = (anywhere: boolean): Walker => ({
      cost: m.cost,
      pass: memo((t) => m.canEnter(t, true)),
      stop: memo((t) => m.canEnter(t, anywhere)),
      // (One of its own of its kind there to stay: fortified, asleep, at work.)
      held: anywhere
        ? undefined
        : memo((t) => view.units.some((x) => x.tile === t && x.id !== u.id && x.owner === me() && soldier(x) === soldier(u) && !x.path?.length && (!!x.stance || !!x.work))),
      risk: m.risk,
      halts: zoc ? (a, b) => zoc(a) && zoc(b) : undefined,
      full: fullMoves(u),
      left: u.moves ?? 0,
    });
    const way = findWay(g, u.tile, to, walker(false));
    if (way) route = way;
    // (No way, but one if its own units weren't there: they're what's in the way.)
    else if (findWay(g, u.tile, to, walker(true))) ownInWay = key;
  }
  cached = { key, view, route };
  return route;
}

/**
 * A melee unit's charge: sent at an enemy it can reach this turn, it goes next to it and attacks
 * (Civ V's). The tile it attacks from (its way there's last step, else another free tile next to
 * the enemy it can reach with a move to spare), or null (out of reach this turn, or not a melee unit).
 */
export function chargeFrom(u: UnitWire, target: number, route: Route | null = previewPath(u, target)): number | null {
  const type = UNITS[u.type];
  const g = store.grid;
  if (!g || !type || type.ranged || !isMilitary(type) || type.abilities?.includes('no_attack') || type.domain === 'air' || !enemyAt(target)) return null;
  const n = route?.tiles.length ?? 0;
  if (route && n >= 2 && route.turns[n - 1] === 0 && !ownThere(u, route.tiles[n - 2])) return route.tiles[n - 2];
  // (Worked out once for each unit, place and enemy: it's asked every frame the mouse is there.)
  const key = `${u.id}|${u.tile}|${u.moves}|${target}`;
  if (charge.key === key && charge.view === store.view) return charge.at;
  let found: number | null = null;
  for (const at of neighbours(g, target)) {
    if (at === u.tile || ownThere(u, at) || enemyAt(at)) continue;
    const way = previewPath(u, at);
    if (way && routeTurns(u, [...way.tiles, target]).at(-1) === 0) {
      found = at;
      break;
    }
  }
  charge = { key, view: store.view, at: found };
  return found;
}

let charge: { key: string; view: View | null; at: number | null } = { key: '', view: null, at: null };

const soldier = (x: UnitWire) => !!UNITS[x.type] && isMilitary(UNITS[x.type]) && !isGreatPerson(x.type);

/** The unit of yours of its kind next to it that a unit would swap places with if sent there (the rules' `swapWith`, as far as this screen can tell). */
export function swapsWith(u: UnitWire, t: number): UnitWire | undefined {
  const view = store.view;
  const g = store.grid;
  if (!view || !g || (u.moves ?? 0) <= 0 || !neighbours(g, u.tile).includes(t)) return undefined;
  const other = ownThere(u, t);
  if (!other || other.id === u.id || UNITS[other.type]?.domain === 'air' || !reachable(u, t) || !reachable(other, u.tile)) return undefined;
  return Number.isFinite(mover(u, view).cost(u.tile, t)) && Number.isFinite(mover(other, view).cost(t, u.tile)) ? other : undefined;
}

/** One of the player's own units of the same kind (soldier or civilian) on a tile: a unit can't stop there. */
const ownThere = (u: UnitWire, t: number) => store.view?.units.find((x) => x.tile === t && x.owner === me() && x.id !== u.id && soldier(x) === soldier(u));

/** Another civ's unit on a tile that the player isn't at war with: no unit of theirs can stop there (nor attack it). */
const neutralThere = (t: number) => store.view?.units.find((x) => x.tile === t && x.owner !== me() && !store.view?.players[x.owner]?.war);

/** Whether a tile is in land closed to a soldier: another civ's, at peace, without open borders to it. */
function closedTo(u: UnitWire, t: number): boolean {
  const owner = store.known[t]?.owner ?? -1;
  const them = owner >= 0 && owner !== me() ? store.view?.players[owner] : undefined;
  return soldier(u) && !!them && !them.war && !them.cityState && !them.opensBorders;
}

/** Why a unit can't go to a tile, in a few words: what's in the way there, or that there's no way. */
export function whyNot(u: UnitWire, to: number): string {
  const view = store.view;
  const type = UNITS[u.type];
  if (!view || !type) return "Can't get there";
  const military = soldier(u);
  const there = ownThere(u, to);
  if (there) return `Your ${UNITS[there.type]?.name ?? 'unit'} is there (one ${military ? 'soldier' : 'civilian'} to a tile)`;
  const foe = view.units.find((x) => x.tile === to && x.owner !== me());
  if (foe && view.players[foe.owner]?.war) return military ? (type.ranged ? `${outOfReach(u, to)}: move to fire` : 'Move next to it to attack') : 'An enemy is there';
  const neutral = neutralThere(to);
  if (neutral) return `${view.players[neutral.owner]?.name ?? 'Another civ'}'s ${UNITS[neutral.type]?.name ?? 'unit'} is there`;
  if (closedTo(u, to)) return `${view.players[store.known[to]!.owner].name}'s borders are closed to you`;
  const city = cityAt(to);
  if (city && city.owner !== me()) return !view.players[city.owner]?.war ? 'A foreign city' : military ? 'Attack it from next to it' : 'An enemy city';
  return ownInWay === `${u.id}|${u.tile}|${u.moves}|${to}` ? 'Your own units are in the way: it would have to stop on one' : "Can't get there";
}

let current: { view: View | null; unit: number; route: Route | null } = { view: null, unit: -1, route: null };
/** Other units' routes (drawn faintly), worked out once for each view. */
let others: { view: View | null; routes: Map<number, Route> } = { view: null, routes: new Map() };

/** The route a unit is on (its orders), with its turns, worked out once for each view (`other`: a unit not selected). */
export function routeOf(u: UnitWire, other = false): Route | null {
  if (!u.path?.length) return null;
  if (other) {
    if (others.view !== store.view) others = { view: store.view, routes: new Map() };
    let route = others.routes.get(u.id);
    if (!route) others.routes.set(u.id, (route = { tiles: u.path, turns: routeTurns(u, u.path) }));
    return route;
  }
  if (current.view !== store.view || current.unit !== u.id) current = { view: store.view, unit: u.id, route: { tiles: u.path, turns: routeTurns(u, u.path) } };
  return current.route;
}
