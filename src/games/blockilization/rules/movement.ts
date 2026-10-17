import { airBase, carry, isAircraft } from './air';
import { BUILDINGS } from './buildings';
import { atWar, canStand, cityAt, civOf, knows, maxMoves, note, seesUnit, updateVisibility } from './core';
import { dangerCost, dangerZones, type Danger } from './danger';
import { ALL, distance, findWay, neighbours } from './hex';
import type { Game, Unit } from './state';
import { FEATURES, HILLS, RAIL_MOVE, ROAD_MOVE, TERRAINS } from './terrain';
import { isGreatPerson, isMilitary, UNITS } from './units';

/**
 * Moving: what each step costs (terrain, features, roads, rivers; the Great Wall's border and the
 * Iroquois' forest paths), who can stand where (one military and one civilian unit to a tile, Civ
 * V's), zones of control (stepping from one tile next to an enemy to another ends the move),
 * embarking onto the sea with Optics, and paths over several turns (wary of enemy cities and
 * soldiers in a war: `danger.ts`). Aircraft don't walk: they're based in cities and aboard carriers
 * (`air.ts`).
 */

/** The military unit and the civilian on a tile, if any. */
export function occupants(game: Game, t: number): { military?: Unit; civilian?: Unit } {
  const out: { military?: Unit; civilian?: Unit } = {};
  for (const u of game.units) {
    // (Aircraft hold no ground: they're based in cities and aboard carriers, `air.ts`.)
    if (u.tile !== t || isAircraft(u)) continue;
    if (isMilitary(UNITS[u.type]) && !isGreatPerson(u.type)) out.military = u;
    else out.civilian = u;
  }
  return out;
}

/** Every civilian on a tile: a city may hold more than one (what it builds, traders waiting to set off). */
export function civiliansAt(game: Game, t: number): Unit[] {
  return game.units.filter((u) => u.tile === t && !isAircraft(u) && !(isMilitary(UNITS[u.type]) && !isGreatPerson(u.type)));
}

export { ALL };

/** Whether a land unit of this owner may step onto water here (embarking: Optics). */
const canEmbark = (game: Game, owner: number) => knows(game.players[owner], 'optics');
/** Whether ocean is open to embarked units and early ships (Astronomy). */
const canOcean = (game: Game, owner: number) => knows(game.players[owner], 'astronomy');

/** Movement points to step from `a` to its neighbour `b` (Infinity: can't). Ignores other units. */
export function stepCost(game: Game, u: Unit, a: number, b: number): number {
  const type = UNITS[u.type];
  const to = game.tiles[b];
  const from = game.tiles[a];
  if (!type) return Infinity;
  if (to.elevation === 'mountain' || to.feature === 'ice') return Infinity;
  const water = TERRAINS[to.terrain].water;
  const city = cityAt(game, b);
  if (type.domain === 'sea') {
    if (!water && !(city && city.owner === u.owner)) return Infinity;
    if (to.terrain === 'ocean' && type.abilities?.includes('coast_only') && !canOcean(game, u.owner)) return Infinity;
    return 1;
  }
  if (type.domain === 'air') return 1;
  // Land.
  if (water) {
    if (!canEmbark(game, u.owner)) return Infinity;
    if (to.terrain === 'ocean' && !canOcean(game, u.owner)) return Infinity;
    // Embarking or disembarking takes the rest of the turn; moving at sea, one a tile.
    return TERRAINS[from.terrain].water ? 1 : ALL;
  }
  if (TERRAINS[from.terrain].water) return ALL; // disembarking ends the move
  // The Great Wall: an enemy's land costs every move (until its owner knows Dynamite).
  if (to.owner >= 0 && to.owner !== u.owner && atWar(game, u.owner, to.owner) && greatWall(game, to.owner)) return ALL;
  // Roads (both ends) and railroads; for the Iroquois, the forests and jungles of their own land.
  if (from.road && to.road && !from.pillaged && !to.pillaged) return from.road === 'rail' && to.road === 'rail' ? RAIL_MOVE : knows(game.players[u.owner], 'machinery') ? ROAD_MOVE * 0.75 : ROAD_MOVE;
  if (forestPath(game, u.owner, a) && forestPath(game, u.owner, b)) return ROAD_MOVE;
  if (type.abilities?.includes('ignore_terrain')) return 1;
  // The Inca: a hill (whatever grows on it) is a single move.
  if (to.elevation === 'hills' && (civOf(game.players[u.owner]).ability.effects.special?.includes('andean_roads') ?? false)) return 1;
  let cost = to.elevation === 'hills' ? HILLS.move : TERRAINS[to.terrain].move;
  if (to.feature) cost = Math.max(cost, FEATURES[to.feature].move);
  // Crossing into a river tile from outside it costs all moves without a bridge (Construction).
  if (to.river && !from.river && !knows(game.players[u.owner], 'construction')) cost = ALL;
  return cost;
}

/** Whether a player's land is guarded by the Great Wall (its owner hasn't Dynamite yet). */
function greatWall(game: Game, owner: number): boolean {
  if (knows(game.players[owner], 'dynamite')) return false;
  return game.cities.some((c) => c.owner === owner && c.buildings.some((b) => BUILDINGS[b]?.effects.special?.includes('enemy_slowed_in_borders')));
}

/** Whether a tile is a road to a civ for its forest paths (the Iroquois: forest and jungle in their own land). */
function forestPath(game: Game, owner: number, t: number): boolean {
  const tile = game.tiles[t];
  if (tile.owner !== owner || (tile.feature !== 'forest' && tile.feature !== 'jungle' && !tile.road) || tile.pillaged) return false;
  return civOf(game.players[owner]).ability.effects.special?.includes('forest_roads') ?? false;
}

/** Whether a tile is next to an enemy city, or an enemy military unit of the same domain that isn't at sea in a boat (a zone of control). */
function inZoc(game: Game, u: Unit, t: number): boolean {
  const domain = UNITS[u.type].domain;
  for (const n of neighbours(game.grid, t)) {
    const city = cityAt(game, n);
    if (city && atWar(game, u.owner, city.owner)) return true;
    const m = occupants(game, n).military;
    if (m && atWar(game, u.owner, m.owner) && !m.embarked && UNITS[m.type].domain === domain) return true;
  }
  return false;
}

/**
 * Whether a unit may end its step on `t` (not counting moves): stacking, enemies, foreign land. Or,
 * `passing`, whether it may go through `t` on its way without stopping there: its own side's units
 * don't bar the way then (Civ V's), anyone else's do.
 */
export function canEnter(game: Game, u: Unit, t: number, passing = false): boolean {
  if (isAircraft(u)) return !!airBase(game, u.owner, t, u);
  if (!canStand(game, u.type, t) && !(UNITS[u.type].domain === 'land' && TERRAINS[game.tiles[t].terrain].water && canEmbark(game, u.owner))) return false;
  const here = occupants(game, t);
  const military = isMilitary(UNITS[u.type]) && !isGreatPerson(u.type);
  const city = cityAt(game, t);
  if (city && city.owner !== u.owner) return false; // taken by attacking
  if (here.military && here.military.owner !== u.owner) return false;
  // (Another's civilian: only a soldier at war with them may step in, taking it; never on the way through.)
  if (here.civilian && here.civilian.owner !== u.owner && (!military || passing || !atWar(game, u.owner, here.civilian.owner))) return false;
  // (A caravan or cargo ship, or a great person, may wait in one of its own cities beside another
  // civilian: else a worker resting there kept the traders out, their routes unrun, and a great person
  // was born outside and had to walk in.)
  const waits = (!!UNITS[u.type].abilities?.includes('trade_route') || isGreatPerson(u.type)) && city?.owner === u.owner;
  if (!passing && (military ? here.military && here.military !== u : here.civilian && here.civilian !== u && !waits)) return false;
  // Closed borders: no entering another civ's land in peace without open borders (Civ V's).
  const owner = game.tiles[t].owner;
  if (owner >= 0 && owner !== u.owner && !atWar(game, u.owner, owner)) {
    const them = game.players[owner];
    // (Their grant lets us in: open borders we've given them doesn't open their land to us.)
    if (!them.cityState && !them.diplomacy.openBorders[u.owner] && military) return false;
  }
  return true;
}

/**
 * The path a unit would take to `to` (null: no way), turn by turn (`findWay`): through what it may
 * pass (its own side's units), its turns ending only where it may stop (one of each kind to a tile:
 * where the next step would end its turn on one of its own, it waits short of it instead), zones of
 * control ending its moves; in a war, keeping out of enemy cities' fire and away from enemy soldiers
 * where a way round costs little more (and never embarking under a city's walls when it could go
 * round by land). `anywhere`: as if it could stop on its own units (to tell whether they're what's in
 * the way).
 */
export function planPath(game: Game, u: Unit, to: number, anywhere = false): number[] | null {
  const type = UNITS[u.type];
  const land = type.domain === 'land';
  const danger = dangerFor(game, u);
  // (Each tile's answers asked once: nothing moves while a way is found.)
  const memo = (f: (t: number) => boolean) => {
    const known = new Map<number, boolean>();
    return (t: number) => {
      let x = known.get(t);
      if (x === undefined) known.set(t, (x = f(t)));
      return x;
    };
  };
  const zoc = isMilitary(type) && !type.abilities?.includes('ignore_terrain') ? memo((t) => inZoc(game, u, t)) : null;
  const way = findWay(game.grid, u.tile, to, {
    cost: (a, b) => stepCost(game, u, a, b),
    pass: memo((t) => canEnter(game, u, t, true)),
    stop: memo((t) => canEnter(game, u, t, anywhere)),
    held: anywhere ? undefined : memo((t) => staysThere(game, u, t)),
    risk: danger ? (t) => dangerCost(danger, t, type.moves, land && !!TERRAINS[game.tiles[t].terrain].water) : undefined,
    halts: zoc ? (a, b) => zoc(a) && zoc(b) : undefined,
    full: maxMoves(game, u),
    left: u.moves,
  });
  return way?.tiles ?? null;
}

/** Whether one of a unit's own side's units of its kind holds a tile and stays there (fortified, asleep, on alert, at work, with no way to go). */
function staysThere(game: Game, u: Unit, t: number): boolean {
  const here = occupants(game, t)[isMilitary(UNITS[u.type]) && !isGreatPerson(u.type) ? 'military' : 'civilian'];
  return !!here && here !== u && here.owner === u.owner && !here.path?.length && (!!here.stance || !!here.work);
}

/** The danger a unit's owner knows of (the enemy cities it has seen, the enemy soldiers in sight); none out of war, or for barbarians (raiders don't mind). */
function dangerFor(game: Game, u: Unit): Danger | null {
  const p = game.players[u.owner];
  if (p.civ === 'barbarian' || !p.diplomacy.war.some(Boolean)) return null;
  const cities = game.cities.filter((c) => atWar(game, u.owner, c.owner) && p.explored[c.tile]).map((c) => c.tile);
  const soldiers = game.units.filter((m) => atWar(game, u.owner, m.owner) && isMilitary(UNITS[m.type]) && !isAircraft(m) && p.visible[m.tile] > 0 && seesUnit(game, p, m)).map((m) => m.tile);
  return cities.length || soldiers.length ? dangerZones(game.grid, cities, soldiers) : null;
}

/**
 * Move a unit along its path as far as its moves go this turn (Civ V: a unit with any moves left can
 * always take one more step; a zone of control or embarking ends its move). It goes through its own
 * side's units only when it can step on past them this turn (it never stops on one); else it goes
 * round them if it can, or waits before them. Stops if something blocks the way (an enemy appeared);
 * what's left of the path waits for next turn.
 */
export function advance(game: Game, u: Unit): void {
  let rerouted = false;
  while (u.path && u.path.length && u.moves > 0) {
    const next = u.path[0];
    let cost = stepCost(game, u, u.tile, next);
    const free = canEnter(game, u, next);
    // One of its own of its kind on the next tile, on its way to this one (their ways cross, where
    // neither could wait on the other's tile): the two swap places, and each goes on its way.
    const crossing = free ? null : crossingWith(game, u, next);
    if (crossing) {
      const mine = u.path.slice(1);
      const theirs = crossing.path!.slice(1);
      swap(game, u, crossing);
      u.path = mine;
      crossing.path = theirs.length ? theirs : undefined;
      continue;
    }
    if (cost === Infinity || (!free && (u.path.length === 1 || !canEnter(game, u, next, true)))) {
      // Something in the way that wasn't (another's unit, closed borders, its own unit on the last
      // tile): a person's unit looks for another way there, once, else stops and says so (the
      // bots plan their units' ways afresh each turn).
      const person = !game.players[u.owner]?.bot;
      const round = !person || rerouted || (u.path.length === 1 && !free) ? null : planPath(game, u, u.path[u.path.length - 1]);
      rerouted = true;
      if (round && round[0] !== next) {
        u.path = round;
        continue;
      }
      u.path = undefined;
      if (person) note(game, u.owner, { text: `Your ${UNITS[u.type].name}'s way is blocked: give it new orders.`, at: u.tile, kind: 'info' });
      break;
    }
    // Zone of control: from next to an enemy into next to an enemy ends the move.
    const zoc = isMilitary(UNITS[u.type]) && inZoc(game, u, u.tile) && inZoc(game, u, next) && !UNITS[u.type].abilities?.includes('ignore_terrain');
    if (cost >= ALL) cost = u.moves; // embark, disembark, an unbridged river: all moves
    // Through its own: only with moves enough to come out beyond them, on a tile it may stop on; else
    // a way round them if there's one (once), or it waits here for them to move on (as its way, found
    // turn by turn, may have it do).
    if (!free && (zoc || !throughOwn(game, u))) {
      if (!rerouted) {
        rerouted = true;
        const round = planPath(game, u, u.path[u.path.length - 1]);
        // No way past them at all, even waiting: it asks for new orders.
        if (!round && !zoc) {
          u.path = undefined;
          note(game, u.owner, { text: `Your ${UNITS[u.type].name} can't get past your own units: give it new orders.`, at: u.tile, kind: 'info' });
          break;
        }
        if (round && round[0] !== next) {
          u.path = round;
          continue;
        }
      }
      // Waiting with all its moves behind one of its own that's set to stay (fortified, asleep, on alert): said, as that one won't move on by itself.
      const ahead = occupants(game, next)[isMilitary(UNITS[u.type]) && !isGreatPerson(u.type) ? 'military' : 'civilian'];
      if (!zoc && u.moves >= (u.turnMoves ?? Infinity) && ahead?.owner === u.owner && ahead.stance && !ahead.path?.length) {
        const how = ahead.stance === 'fortify' ? 'fortified' : ahead.stance === 'sleep' ? 'asleep' : 'on alert';
        note(game, u.owner, { text: `Your ${UNITS[u.type].name} waits behind your ${UNITS[ahead.type].name} (${how}): move that one, or give this one new orders.`, at: u.tile, kind: 'info' });
      }
      break;
    }
    u.tile = next;
    carry(game, u);
    u.path.shift();
    u.moves = zoc ? 0 : Math.max(0, u.moves - cost);
    u.stance = undefined;
    u.fortified = 0;
    u.setUp = false;
    u.embarked = UNITS[u.type].domain === 'land' && !!TERRAINS[game.tiles[next].terrain].water;
    // A civilian of an enemy's where it stepped: taken (Civ V's).
    const civ = occupants(game, next).civilian;
    if (civ && civ.owner !== u.owner) captureHooks.onCivilian(game, u, civ);
    // Things found by walking: ancient ruins.
    const tile = game.tiles[next];
    if (tile.ruin && UNITS[u.type].domain === 'land' && !u.embarked) onRuin(game, u);
    if (tile.camp && isMilitary(UNITS[u.type])) campHooks.onCamp(game, u);
    updateVisibility(game, game.players[u.owner]);
    // An enemy soldier newly in sight: it stops here, with the moves it has left.
    if (u.path?.length && sightStops(game, u)) break;
  }
  if (u.path && !u.path.length) u.path = undefined;
}

/** The enemy soldiers a unit's owner sees within two tiles of it. */
function foesNear(game: Game, u: Unit): Unit[] {
  const owner = game.players[u.owner];
  return game.units.filter((x) => atWar(game, u.owner, x.owner) && isMilitary(UNITS[x.type]) && !isGreatPerson(x.type) && distance(game.grid, u.tile, x.tile) <= 2 && seesUnit(game, owner, x));
}

/**
 * A person's unit on its way stops when an enemy soldier comes into sight near it (within two
 * tiles), and asks for orders (Civ V's): once for each, as those it has had in sight on this move
 * (those there when it set off too) don't stop it again. Whether it stopped.
 */
export function sightStops(game: Game, u: Unit): boolean {
  const owner = game.players[u.owner];
  if (!u.path?.length || !owner || owner.bot) return false;
  const near = foesNear(game, u);
  const fresh = near.find((x) => !u.sighted?.includes(x.id));
  u.sighted = [...new Set([...(u.sighted ?? []), ...near.map((x) => x.id)])];
  if (!fresh) return false;
  u.path = undefined;
  note(game, u.owner, { text: `Your ${UNITS[u.type].name} has stopped: enemies in sight (${civOf(game.players[fresh.owner])?.adjective ?? game.players[fresh.owner].name} ${UNITS[fresh.type].name}).`, at: u.tile, kind: 'war' });
  return true;
}

/**
 * Whether a unit can get through the run of its own side's units on its path's next tiles this turn:
 * every step through them leaves it a move, it's never held by a zone of control on the way, and the
 * tile beyond is one it may stop on.
 */
function throughOwn(game: Game, u: Unit): boolean {
  const path = u.path ?? [];
  const military = isMilitary(UNITS[u.type]) && !isGreatPerson(u.type);
  let moves = u.moves;
  let at = u.tile;
  for (const t of path) {
    if (moves <= 0) return false;
    const cost = stepCost(game, u, at, t);
    if (!Number.isFinite(cost) || cost >= ALL) return false;
    if (canEnter(game, u, t)) return true;
    if (!canEnter(game, u, t, true) || (military && inZoc(game, u, at) && inZoc(game, u, t))) return false;
    moves -= cost;
    at = t;
  }
  return false;
}

/**
 * The unit of a unit's own side and kind (soldier or civilian) on a tile next to it, that the two
 * could swap places with (Civ V's): each able to step onto the other's tile, ignoring the other.
 */
export function swapWith(game: Game, u: Unit, to: number): Unit | null {
  if (!neighbours(game.grid, u.tile).includes(to) || u.moves <= 0) return null;
  const military = isMilitary(UNITS[u.type]) && !isGreatPerson(u.type);
  const other = occupants(game, to)[military ? 'military' : 'civilian'];
  if (!other || other.owner !== u.owner || other === u || isAircraft(other) || other.carrier !== undefined) return null;
  if (!Number.isFinite(stepCost(game, u, u.tile, to)) || !Number.isFinite(stepCost(game, other, to, u.tile))) return null;
  // (Each may stand where the other stood: its own kind's place there is the one being left.)
  if (!canEnter(game, u, to, true) || !canEnter(game, other, u.tile, true)) return null;
  return other;
}

/** One of a unit's own of its kind on the next tile of its way, with moves left, its own way's next step onto this unit's tile (and neither held by a zone of control): the two may swap places. */
function crossingWith(game: Game, u: Unit, next: number): Unit | null {
  const other = swapWith(game, u, next);
  if (!other || other.moves <= 0 || other.path?.[0] !== u.tile) return null;
  const held = (x: Unit, from: number, to: number) => isMilitary(UNITS[x.type]) && !UNITS[x.type].abilities?.includes('ignore_terrain') && inZoc(game, x, from) && inZoc(game, x, to);
  return held(u, u.tile, next) || held(other, next, u.tile) ? null : other;
}

/** Two units of a side, next to each other, swap places: each spends its step's moves (the one moved for, at most what it has). */
export function swap(game: Game, u: Unit, other: Unit) {
  const [a, b] = [u.tile, other.tile];
  const cu = stepCost(game, u, a, b);
  const co = stepCost(game, other, b, a);
  u.tile = b;
  other.tile = a;
  u.moves = cu >= ALL ? 0 : Math.max(0, u.moves - cu);
  other.moves = co >= ALL ? 0 : Math.max(0, other.moves - co);
  for (const x of [u, other]) {
    x.path = undefined;
    x.stance = undefined;
    x.fortified = 0;
    x.setUp = false;
    x.work = undefined;
    x.embarked = UNITS[x.type].domain === 'land' && !!TERRAINS[game.tiles[x.tile].terrain].water;
    carry(game, x);
  }
  updateVisibility(game, game.players[u.owner]);
}

/** Set off for a tile (the path is kept for the turns it takes). */
export function moveTo(game: Game, u: Unit, to: number): boolean {
  const p = planPath(game, u, to);
  if (!p) return false;
  u.path = p;
  // (The enemies in sight as it's sent: it goes on regardless of them.)
  u.sighted = foesNear(game, u).map((x) => x.id);
  u.work = undefined;
  advance(game, u);
  return true;
}

/** An enemy's civilian stepped onto by a soldier: taken or killed (`combat.ts` fills it in). */
export const captureHooks: { onCivilian: (game: Game, by: Unit, civ: Unit) => void } = { onCivilian: () => {} };

/** A barbarian camp stepped into (`barbarians.ts` fills it in). */
export const campHooks: { onCamp: (game: Game, u: Unit) => void } = { onCamp: () => {} };

/** An ancient ruin's reward (filled in by the rules' `ruins`): set when the module loads. */
export const ruinHooks: { onRuin: (game: Game, u: Unit) => void } = { onRuin: () => {} };
const onRuin = (game: Game, u: Unit) => ruinHooks.onRuin(game, u);
