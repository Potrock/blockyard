import { BUILDINGS } from './buildings';
import { atWar, capitalOf, civEffects, civOf, citiesOf, empireEffects, has, knows, seesResource, speed, unitsOf } from './core';
import type { CityFilter, Effects, GreatKind, SpecialistKind } from './effects';
import { neighbours, distance, within } from './hex';
import { policyEffects } from './policies';
import { cityBeliefEffects, cityReligion, religionEffects } from './faith';
import { alliedLuxuries, alliedStrategics, cityStateBonus } from './citystates';
import { banned, fundedGreatPeople, inForce } from './congress';
import { tradeLuxuries, tradeStrategics } from './diplomacy';
import { aroundYields, naturalWonderOf, natureHappiness } from './nature';
import { SPEEDS, type City, type Game, type Player } from './state';
import { addYields, FEATURES, HILLS, IMPROVEMENTS, RESOURCES, tapped, tapsWith, TERRAINS, YIELD_KEYS, type Yields } from './terrain';
import { isGreatPerson, isMilitary, UNITS } from './units';

/**
 * Where everything comes from: what each tile yields, what each city makes of its citizens' work and
 * its buildings, food and growth, gold and its upkeep, happiness, culture and the land it claims.
 * Civilization V's rules and numbers throughout.
 */

export { civEffects, empireEffects, has };

/** Whether a building is `id`, or a civ's own version of it (a Burial Tomb is a Temple). */
export const isBuilding = (b: string, id: string) => b === id || BUILDINGS[b]?.replaces === id;

/** How many of these buildings (or the civs' own versions of them) a city has. */
export const countBuildings = (c: City, ids: string[]) => c.buildings.filter((b) => ids.some((id) => isBuilding(b, id))).length;

/** What's worked out once for a civ while its cities' effects are gathered (the empire's effects, the cities linked to its capital). */
export interface CityMemo {
  empire?: Effects[];
  connected?: Set<number>;
}

/**
 * What applies to one city: its buildings, the empire's, its religion's; and of those, what's only
 * for cities like it and for each building it has (`memo` carries what's the same for all the civ's
 * cities, when many are asked about at once).
 */
export function cityEffects(game: Game, c: City, memo: CityMemo = {}): Effects[] {
  const p = game.players[c.owner];
  const out: Effects[] = [];
  const add = (e: Effects) => {
    out.push(e);
    for (const x of e.cities ?? []) if (cityMatches(game, c, x.when, memo)) add(x.effects);
    for (const x of e.perBuilding ?? []) for (let n = countBuildings(c, x.buildings); n > 0; n--) add(x.effects);
  };
  for (const b of c.buildings) if (BUILDINGS[b]) add(BUILDINGS[b].effects);
  for (const e of (memo.empire ??= empireEffects(game, p))) add(e);
  for (const e of cityBeliefEffects(game, c)) add(e);
  return out;
}

/** Whether a city is by the sea (not just a lake). */
export const coastal = (game: Game, c: City) => neighbours(game.grid, c.tile).some((t) => TERRAINS[game.tiles[t].terrain].water && game.tiles[t].terrain !== 'lake');

/** Whether a military unit of the city's owner stands in it. */
export const garrisoned = (game: Game, c: City) => game.units.some((u) => u.tile === c.tile && u.owner === c.owner && isMilitary(UNITS[u.type]));

/** Whether a city is one an effect is for. */
export function cityMatches(game: Game, c: City, f: CityFilter, memo: CityMemo = {}): boolean {
  const p = game.players[c.owner];
  if (f.capital !== undefined && !!c.capital !== f.capital) return false;
  if (f.coastal && !coastal(game, c)) return false;
  if (f.freshWater && !freshWater(game, c.tile)) return false;
  if (f.minPop && c.pop < f.minPop) return false;
  if (f.garrisoned && !garrisoned(game, c)) return false;
  if (f.connected && (c.capital || !(memo.connected ??= connected(game, p)).has(c.id))) return false;
  if (f.holyCity && !(p.religion && game.religions[p.religion]?.holyCity === c.id)) return false;
  if (f.specialist && !Object.values(c.specialists).some((n) => (n ?? 0) > 0)) return false;
  if (f.building && !countBuildings(c, f.building)) return false;
  if (f.after && !knows(p, f.after)) return false;
  if (f.before && knows(p, f.before)) return false;
  return true;
}

/** Each sea tile's body of water (its number; -1 for land), worked out once for a map (land and sea don't change). */
const bodies = new WeakMap<Game['tiles'], Int32Array>();
export const waterBodies = (game: Game): Int32Array => bodiesOf(game, bodies, true);

/** Each land tile's landmass (its number; -1 for water), the same way. */
const masses = new WeakMap<Game['tiles'], Int32Array>();
export const landBodies = (game: Game): Int32Array => bodiesOf(game, masses, false);

function bodiesOf(game: Game, memo: WeakMap<Game['tiles'], Int32Array>, water: boolean): Int32Array {
  const known = memo.get(game.tiles);
  if (known && game.tiles.every((t, i) => (known[i] >= 0) === (!!TERRAINS[t.terrain].water === water))) return known;
  const out = new Int32Array(game.tiles.length).fill(-1);
  const counts = (t: number) => !!TERRAINS[game.tiles[t].terrain].water === water;
  let n = 0;
  game.tiles.forEach((_, t) => {
    if (!counts(t) || out[t] >= 0) return;
    const stack = [t];
    out[t] = n;
    while (stack.length) for (const x of neighbours(game.grid, stack.pop()!)) if (out[x] < 0 && counts(x)) (out[x] = n), stack.push(x);
    n++;
  });
  memo.set(game.tiles, out);
  return out;
}

/**
 * The cities linked to a civ's capital (Civ V's city connections): by roads and railroads that
 * aren't pillaged, over any land but an enemy's (for the Iroquois, the forests and jungles of their
 * own land count as roads), and by sea between cities with harbours on the same water.
 */
export function connected(game: Game, p: Player): Set<number> {
  const out = new Set<number>();
  const capital = capitalOf(game, p.index);
  if (!capital) return out;
  const mine = new Map(citiesOf(game, p.index).map((c) => [c.tile, c]));
  const forests = civOf(p).ability.effects.special?.includes('forest_roads') ?? false;
  const road = (t: number) => {
    const tile = game.tiles[t];
    if (mine.has(t)) return true;
    if (tile.owner >= 0 && atWar(game, p.index, tile.owner)) return false;
    if (tile.road && !tile.pillaged) return true;
    return forests && tile.owner === p.index && (tile.feature === 'forest' || tile.feature === 'jungle');
  };
  // Harbour cities, and the waters each lies on (the map's waters looked at only if there are any).
  const harbours = [...mine.values()].filter((c) => has(c.buildings.map((b) => BUILDINGS[b]?.effects).filter((e): e is Effects => !!e), 'connects_by_sea'));
  const water = harbours.length ? waterBodies(game) : new Int32Array(0);
  const ports = harbours.map((c) => ({ c, waters: new Set(neighbours(game.grid, c.tile).map((n) => water[n]).filter((w) => w >= 0)) }));
  const sailed = new Set<number>();
  const seen = new Uint8Array(game.tiles.length);
  const queue = [capital.tile];
  seen[capital.tile] = 1;
  while (queue.length) {
    const t = queue.pop()!;
    const city = mine.get(t);
    if (city) out.add(city.id);
    // A harbour: every harbour city on the same water is linked.
    const port = city && ports.find((x) => x.c === city);
    if (port) {
      for (const w of port.waters) sailed.add(w);
      for (const other of ports)
        if (!seen[other.c.tile] && [...other.waters].some((w) => sailed.has(w))) {
          seen[other.c.tile] = 1;
          queue.push(other.c.tile);
        }
    }
    for (const n of neighbours(game.grid, t))
      if (!seen[n] && road(n)) {
        seen[n] = 1;
        queue.push(n);
      }
  }
  return out;
}

/** Whether a tile has fresh water next to it (a river, a lake, an oasis, a natural wonder's spring or falls). */
export function freshWater(game: Game, t: number): boolean {
  const tile = game.tiles[t];
  if (tile.river) return true;
  return neighbours(game.grid, t).some((n) => game.tiles[n].terrain === 'lake' || game.tiles[n].feature === 'oasis' || game.tiles[n].river || !!naturalWonderOf(game.tiles[n])?.freshWater);
}

/** What a tile yields to its owner (before a city's buildings): a natural wonder its own yields, nothing else; land by one that enriches it, more. */
export function tileYields(game: Game, t: number, p: Player | null): Yields {
  const tile = game.tiles[t];
  const wonder = naturalWonderOf(tile);
  if (wonder) return { ...wonder.yields };
  if (tile.elevation === 'mountain' || tile.feature === 'ice') return {};
  let y: Yields = tile.elevation === 'hills' ? { ...HILLS.yields } : { ...TERRAINS[tile.terrain].yields };
  if (tile.feature) {
    const f = FEATURES[tile.feature];
    y = f.replace ? { ...f.yields } : addYields(y, f.yields);
  }
  if (tile.resource && (!p || seesResource(p, tile.resource))) y = addYields(y, RESOURCES[tile.resource].yields);
  if (tile.improvement && !tile.pillaged) {
    const imp = IMPROVEMENTS[tile.improvement];
    y = addYields(y, imp.yields);
    if (tile.resource && tapsWith(tile) === tile.improvement && (!p || seesResource(p, tile.resource))) y = addYields(y, RESOURCES[tile.resource].improved);
    // Farms: one more food with fresh water (or Civil Service); Fertilizer for all.
    if (tile.improvement === 'farm' && p && (knows(p, 'fertilizer') || (freshWater(game, t) && knows(p, 'civil_service')))) y = addYields(y, { food: 1 });
    // Mines and quarries gain with industry.
    if ((tile.improvement === 'mine' || tile.improvement === 'quarry') && p && knows(p, 'chemistry')) y = addYields(y, { prod: 1 });
    if (tile.improvement === 'trading_post' && p && knows(p, 'economics')) y = addYields(y, { gold: 1 });
    if (tile.improvement === 'lumber_mill' && p && knows(p, 'scientific_theory')) y = addYields(y, { prod: 1 });
  }
  if (tile.river) y = addYields(y, { gold: 1 });
  y = addYields(y, aroundYields(game, t));
  for (const k of YIELD_KEYS) if ((y[k] ?? 0) < 0) y[k] = 0;
  return y;
}

/** Whether a tile matches a filter of an effect. */
function matches(game: Game, t: number, where: NonNullable<Effects['tiles']>[number]['where'], p: Player): boolean {
  const tile = game.tiles[t];
  if (where.terrain && !where.terrain.includes(tile.terrain)) return false;
  if (where.feature && (!tile.feature || !where.feature.includes(tile.feature))) return false;
  if (where.elevation && !where.elevation.includes(tile.elevation)) return false;
  if (where.resource && (!tile.resource || !where.resource.includes(tile.resource) || !seesResource(p, tile.resource))) return false;
  if (where.resourceKind && (!tile.resource || !where.resourceKind.includes(RESOURCES[tile.resource].kind) || !seesResource(p, tile.resource))) return false;
  if (where.improvement && (!tile.improvement || tile.pillaged || !where.improvement.includes(tile.improvement))) return false;
  if (where.water !== undefined && !!TERRAINS[tile.terrain].water !== where.water) return false;
  if (where.river && !tile.river) return false;
  if (where.naturalWonder && !tile.wonder) return false;
  return true;
}

/** What a tile yields to a city working it: the tile, and the city's buildings' bonuses for tiles like it. */
export function workedYields(game: Game, c: City, t: number, effects = cityEffects(game, c)): Yields {
  const p = game.players[c.owner];
  let y = tileYields(game, t, p);
  for (const e of effects) for (const tb of e.tiles ?? []) if (matches(game, t, tb.where, p)) y = addYields(y, tb.yields);
  // A golden age: +1 production on tiles that make some, +1 gold on tiles that make gold.
  if (p.goldenTurns > 0) {
    if ((y.prod ?? 0) > 0) y = addYields(y, { prod: 1 });
    if ((y.gold ?? 0) > 0) y = addYields(y, { gold: 1 });
  }
  return y;
}

/** The tiles a city can work: its own land within three tiles (not the city's own tile; no mountains, but natural wonders). */
export function workable(game: Game, c: City): number[] {
  return within(game.grid, c.tile, 3).filter((t) => t !== c.tile && game.tiles[t].city === c.id && (game.tiles[t].elevation !== 'mountain' || !!game.tiles[t].wonder) && game.tiles[t].feature !== 'ice');
}

/** What each kind of specialist makes. */
export const SPECIALIST_YIELD: Record<SpecialistKind, Yields> = {
  scientist: { science: 3 },
  engineer: { prod: 2 },
  merchant: { gold: 3 },
  artist: { culture: 3 },
  writer: { culture: 3 },
  musician: { culture: 3 },
};

/** Specialist slots in a city. */
export function specialistSlots(game: Game, c: City): Partial<Record<SpecialistKind, number>> {
  const out: Partial<Record<SpecialistKind, number>> = {};
  for (const e of cityEffects(game, c)) for (const s of e.specialists ?? []) out[s.kind] = (out[s.kind] ?? 0) + s.slots;
  return out;
}

export interface CityYields {
  food: number;
  prod: number;
  gold: number;
  science: number;
  culture: number;
  faith: number;
  /** Food eaten by its citizens, and what's left over (to grow on). */
  eaten: number;
  surplus: number;
  tourism: number;
  greatPeople: Partial<Record<GreatKind, number>>;
}

/** Percent more great person points of a kind, from the civ's specials (Babylon's scientists, Aesthetics' artists...). */
export function greatPeopleBonus(effects: Effects[], kind: GreatKind): number {
  let pct = 0;
  if ((kind === 'artist' || kind === 'writer' || kind === 'musician') && has(effects, 'culture_great_people_25')) pct += 25;
  if (kind === 'merchant' && has(effects, 'merchants_faster_25')) pct += 25;
  if (kind === 'scientist' && has(effects, 'scientists_faster_33')) pct += 33;
  if (kind === 'general' && has(effects, 'generals_faster_50')) pct += 50;
  return pct;
}

/** Culture each great work gives its city (Civ V's 2; Aesthetics finished, one more). */
export const workCulture = (effects: Effects[]) => 2 + (has(effects, 'great_works_culture_1') ? 1 : 0);

/** What a city makes this turn (its empire's happiness can be given, worked out once for many cities). */
export function cityYields(game: Game, c: City, mood = happiness(game, game.players[c.owner])): CityYields {
  const p = game.players[c.owner];
  const effects = cityEffects(game, c);
  let y: Yields = {};
  // Its own tile: as a farmed one, at least 2 food, 1 production and 1 gold.
  const centre = workedYields(game, c, c.tile, effects);
  y = addYields(y, { food: Math.max(2, (centre.food ?? 0) + 1), prod: Math.max(1, centre.prod ?? 0), gold: Math.max(1, centre.gold ?? 0), science: centre.science, culture: centre.culture, faith: centre.faith });
  for (const t of c.worked) y = addYields(y, workedYields(game, c, t, effects));
  const gp: Partial<Record<GreatKind, number>> = {};
  let specialists = 0;
  for (const [kind, n] of Object.entries(c.specialists) as [SpecialistKind, number][]) {
    if (!n) continue;
    specialists += n;
    y = addYields(y, SPECIALIST_YIELD[kind], n);
    for (const e of effects) y = addYields(y, e.specialistYields, n);
    gp[kind] = (gp[kind] ?? 0) + 3 * n;
  }
  // Every citizen: 1 science (Civ V's).
  y = addYields(y, { science: c.pop });
  // Great works: culture each.
  const works = Object.values(c.works ?? {}).reduce((s, w) => s + w.length, 0);
  y = addYields(y, { culture: works * workCulture(effects) });
  // Buildings' and the empire's flat and per-citizen yields.
  for (const e of effects) {
    y = addYields(y, e.yields);
    if (e.perPop) for (const k of YIELD_KEYS) if (e.perPop[k]) y[k] = (y[k] ?? 0) + Math.floor((e.perPop[k] ?? 0) * c.pop);
    for (const g of e.greatPeople ?? []) gp[g.kind] = (gp[g.kind] ?? 0) + g.points;
  }
  // Percentages: the city's and the empire's, a golden age's culture, and the specials that depend on how things stand.
  const pct: Yields = {};
  for (const e of effects) for (const k of YIELD_KEYS) pct[k] = (pct[k] ?? 0) + (e.percent?.[k] ?? 0);
  if (p.goldenTurns > 0) pct.culture = (pct.culture ?? 0) + 20 + (has(effects, 'golden_age_culture_33') ? 33 : 0);
  if (mood >= 0) pct.science = (pct.science ?? 0) + (has(effects, 'science_10_happy') ? 10 : 0) + (has(effects, 'science_15_happy') ? 15 : 0);
  if (has(effects, 'religious_community')) {
    const r = cityReligion(c);
    pct.prod = (pct.prod ?? 0) + Math.min(15, r ? (c.followers?.[r] ?? 0) : 0);
  }
  if (has(effects, 'plowshares') && !game.players.some((o) => o.alive && !o.cityState && o.civ !== 'barbarian' && atWar(game, p.index, o.index))) pct.food = (pct.food ?? 0) + 15;
  if (has(effects, 'hanse_trade_production')) pct.prod = (pct.prod ?? 0) + 5 * (p.routes ?? []).filter((r) => r.from === c.id && game.players[game.cities.find((x) => x.id === r.to)?.owner ?? -1]?.cityState).length;
  // An unhappy empire grows slowly; specialists eat like the rest (half, with Civil Society).
  const food = (y.food ?? 0) + cityStateBonus(game, p).food;
  const eaten = 2 * (c.pop - specialists) + specialists * (has(effects, 'specialists_eat_half') ? 1 : 2);
  let surplus = food - eaten;
  // Growth slows when the empire is unhappy (Civ V: -75%, and none below -10). Kept to the hundredth,
  // as Civ V keeps food: a quarter of 3 is 0.75 a turn, not nothing.
  if (surplus > 0 && mood < 0) surplus = mood <= -10 ? 0 : surplus / 4;
  if (surplus > 0) surplus = Math.round(surplus * (1 + (pct.food ?? 0) / 100) * 100) / 100;
  const gpPct = effects.reduce((s, e) => s + (e.greatPeoplePercent ?? 0), 0);
  for (const k of Object.keys(gp) as GreatKind[]) gp[k] = (gp[k] ?? 0) * Math.max(0, 1 + (gpPct + greatPeopleBonus(effects, k) + fundedGreatPeople(game, k)) / 100);
  const out: CityYields = {
    food,
    prod: Math.floor((y.prod ?? 0) * (1 + (pct.prod ?? 0) / 100)),
    gold: Math.floor((y.gold ?? 0) * (1 + (pct.gold ?? 0) / 100)),
    science: Math.floor((y.science ?? 0) * (1 + (pct.science ?? 0) / 100)),
    culture: Math.floor((y.culture ?? 0) * (1 + (pct.culture ?? 0) / 100)),
    faith: Math.floor((y.faith ?? 0) * (1 + (pct.faith ?? 0) / 100)),
    eaten,
    surplus,
    tourism: 0,
    greatPeople: gp,
  };
  if (c.puppet) out.science = Math.floor(out.science * 0.75), (out.culture = Math.floor(out.culture * 0.75));
  if (c.resistance) for (const k of ['prod', 'gold', 'science', 'culture', 'faith'] as const) out[k] = 0;
  return out;
}

/** Food a city needs to grow (Civ V's: 15 + 6(n-1) + (n-1)^1.8, by the game's speed). */
export const growthThreshold = (game: Game, pop: number) => Math.floor((15 + 6 * (pop - 1) + Math.pow(pop - 1, 1.8)) * speed(game));

/** Food kept when a city grows (an aqueduct's 40%, and the rest). */
export function foodKept(game: Game, c: City): number {
  return Math.min(90, cityEffects(game, c).reduce((s, e) => s + (e.foodKept ?? 0), 0));
}

/** Culture a city needs for its next tile (Civ V's: 20 + (10t)^1.1, cheaper with some effects). */
export function tileCultureCost(game: Game, c: City): number {
  const cheaper = cityEffects(game, c).reduce((s, e) => s + (e.borderCost ?? 0), 0);
  return Math.floor((20 + Math.pow(10 * c.tilesBought, 1.1)) * speed(game) * (1 - Math.min(75, cheaper) / 100));
}

/** Gold to buy a tile for a city. */
export function tileGoldCost(game: Game, c: City, t: number): number {
  const cheaper = cityEffects(game, c).reduce((s, e) => s + (e.tileGoldCost ?? 0), 0);
  const d = Math.max(1, distance(game.grid, c.tile, t) - 1);
  return Math.floor((50 + 5 * c.tilesBought) * d * speed(game) * (1 - Math.min(75, cheaper) / 100));
}

/** The next tile a city claims: the best unowned one next to its land, within three tiles. */
export function nextTile(game: Game, c: City): number | null {
  const p = game.players[c.owner];
  let best: number | null = null;
  let bestScore = -Infinity;
  for (const t of within(game.grid, c.tile, 3)) {
    const tile = game.tiles[t];
    if (tile.owner >= 0) continue;
    if (!neighbours(game.grid, t).some((n) => game.tiles[n].city === c.id)) continue;
    const y = tileYields(game, t, p);
    // The best yields first, resources (luxuries most), and nearer the city before further out.
    const score = (y.food ?? 0) * 2 + (y.prod ?? 0) + (y.gold ?? 0) + (tile.resource ? (RESOURCES[tile.resource].kind === 'luxury' ? 6 : 3) : 0) - distance(game.grid, c.tile, t) * 1.5;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/** Claim a tile for a city. */
export function claim(game: Game, c: City, t: number) {
  const tile = game.tiles[t];
  tile.owner = c.owner;
  tile.city = c.id;
}

// -------------------------------------------------------------------------------------------------
// Citizens
// -------------------------------------------------------------------------------------------------

/** How much a tile is worth to a city with a focus (for placing citizens). */
function tileScore(y: Yields, focus: City['focus'], hungry: boolean): number {
  const w: Record<string, number> = { food: hungry ? 3 : 2, prod: 1.6, gold: 1, science: 1.2, culture: 1.2, faith: 1 };
  if (focus === 'food') w.food += 2;
  else if (focus !== 'balanced') w[focus] = (w[focus] ?? 1) + 2.5;
  return YIELD_KEYS.reduce((s, k) => s + (y[k] ?? 0) * w[k], 0);
}

/**
 * Put a city's citizens on its best tiles (the governor), keeping any placed by hand: specialists
 * first (as many as their slots and its people allow), then tiles; the rest specialists or unemployed.
 * Like Civ V's, it never starves a city it could feed, and on a balanced focus it keeps it growing:
 * tiles are swapped for ones with more food until the city eats (with two to spare, balanced).
 */
export function assignCitizens(game: Game, c: City) {
  const effects = cityEffects(game, c);
  const taken = new Set<number>();
  for (const other of game.cities) if (other !== c) for (const t of other.worked) taken.add(t);
  const slots = specialistSlots(game, c);
  const specialists: Partial<Record<SpecialistKind, number>> = {};
  let placed = 0;
  for (const [kind, n] of Object.entries(c.lockedSpecialists ?? {}) as [SpecialistKind, number][]) {
    const use = Math.min(n, slots[kind] ?? 0, c.pop - placed);
    if (use > 0) specialists[kind] = use;
    placed += Math.max(0, use);
  }
  const locked = (c.locked ?? []).filter((t) => workable(game, c).includes(t) && !taken.has(t)).slice(0, c.pop - placed);
  const options = workable(game, c)
    .filter((t) => !taken.has(t) && !locked.includes(t))
    .map((t) => {
      const y = workedYields(game, c, t, effects);
      return { t, food: y.food ?? 0, score: tileScore(y, c.focus, true) };
    })
    .sort((a, b) => b.score - a.score);
  const worked = [...locked];
  for (const o of options) {
    if (worked.length + placed >= c.pop) break;
    worked.push(o.t);
  }
  // Specialists, if there are more people than tiles to work.
  let left = c.pop - placed - worked.length;
  for (const [kind, n] of Object.entries(slots) as [SpecialistKind, number][]) {
    const use = Math.min(left, n - (specialists[kind] ?? 0));
    if (use > 0) {
      specialists[kind] = (specialists[kind] ?? 0) + use;
      left -= use;
    }
  }
  c.worked = worked;
  c.specialists = specialists;
  // Short of food: the swap that feeds it most (losing least of the focus), until it eats (and grows, balanced) or no swap helps. (Its mood slows growth, not hunger.)
  let short = (c.focus === 'balanced' ? 2 : 0) - cityYields(game, c, 0).surplus;
  while (short > 0) {
    let best: { at: number; to: number; gain: number; loss: number } | null = null;
    for (const out of options) {
      if (!worked.includes(out.t)) continue;
      for (const o of options) {
        if (worked.includes(o.t)) continue;
        const gain = o.food - out.food;
        const loss = out.score - o.score;
        if (gain > 0 && (!best || gain > best.gain || (gain === best.gain && loss < best.loss))) best = { at: worked.indexOf(out.t), to: o.t, gain, loss };
      }
    }
    if (!best) break;
    worked[best.at] = best.to;
    short -= best.gain;
  }
}

// -------------------------------------------------------------------------------------------------
// The empire: happiness, gold, culture
// -------------------------------------------------------------------------------------------------

/** The luxuries a civ has (improved, in its land, or traded): each kind once. */
export function luxuries(game: Game, p: Player): Set<string> {
  const out = ownLuxuries(game, p);
  for (const r of alliedLuxuries(game, p)) out.add(r);
  tradeLuxuries(game, p, out);
  // (One the World Congress has banned gives no happiness.)
  for (const r of [...out]) if (banned(game, r)) out.delete(r);
  return out;
}

/** The luxuries a civ has of its own (improved in its land, or under one of its cities). */
function ownLuxuries(game: Game, p: Player): Set<string> {
  const out = new Set<string>();
  game.tiles.forEach((tile) => {
    if (tile.owner === p.index && tile.resource && RESOURCES[tile.resource].kind === 'luxury' && tapped(tile)) out.add(tile.resource);
  });
  for (const c of citiesOf(game, p.index)) {
    const r = game.tiles[c.tile].resource;
    if (r && RESOURCES[r].kind === 'luxury') out.add(r);
  }
  return out;
}

/** Strategic resources a civ has (amount, its city-state allies' included), minus what its units and buildings use. */
export function strategic(game: Game, p: Player): Record<string, { have: number; used: number }> {
  const out: Record<string, { have: number; used: number }> = {};
  const civ = civEffects(game, p);
  const double = has(civ, 'strategic_double') ? 2 : 1;
  const oil = has(civ, 'oil_double') ? 2 : 1;
  game.tiles.forEach((tile, t) => {
    if (tile.owner !== p.index || !tile.resource || RESOURCES[tile.resource].kind !== 'strategic' || !seesResource(p, tile.resource)) return;
    const improved = tapped(tile);
    const isCity = game.cities.some((c) => c.tile === t);
    if (!improved && !isCity) return;
    const r = (out[tile.resource] ??= { have: 0, used: 0 });
    r.have += (tile.amount ?? 1) * double * (tile.resource === 'oil' ? oil : 1);
  });
  const shared = has(civ, 'cs_resources_double') ? 2 : 1;
  for (const [res, n] of Object.entries(alliedStrategics(game, p))) if (seesResource(p, res)) (out[res] ??= { have: 0, used: 0 }).have += n * shared;
  for (const u of unitsOf(game, p.index)) {
    const res = UNITS[u.type]?.resource;
    if (res) (out[res] ??= { have: 0, used: 0 }).used++;
  }
  tradeStrategics(game, p, out);
  return out;
}

/**
 * Unhappiness from each city (a puppet's is half). Civ V has three, but at our quick pace that kept
 * an early empire of four cities with two luxuries at -8 and a seven-city one at -10 all game (its
 * growth stalled); with two, the first few cities with a luxury or two are about content, and
 * going wide still needs luxuries and buildings to stay above zero.
 */
export const UNHAPPINESS_PER_CITY = 2;

/** Each civ's happiness, kept while `weighing` runs. */
const moods = new WeakMap<Game, Map<number, number>>();

/**
 * Runs `look` (which mustn't change the game) with each civ's happiness worked out once, not again
 * for every fight weighed: a strength asks for its side's happiness, and a bot weighing its attacks
 * and sieges asks for hundreds.
 */
export function weighing<T>(game: Game, look: () => T): T {
  if (moods.has(game)) return look();
  moods.set(game, new Map());
  try {
    return look();
  } finally {
    moods.delete(game);
  }
}

/**
 * A civ's happiness (Civ V's: a base, luxuries and buildings against cities and citizens): what
 * makes its people happy, less what makes them unhappy (each part told in `parts`, if given, for the
 * top bar).
 */
export function happiness(game: Game, p: Player, parts?: { label: string; value: number }[]): number {
  const memo = parts ? undefined : moods.get(game);
  if (!memo) return moodOf(game, p, parts);
  let mood = memo.get(p.index);
  if (mood === undefined) memo.set(p.index, (mood = moodOf(game, p)));
  return mood;
}

function moodOf(game: Game, p: Player, parts?: { label: string; value: number }[]): number {
  const cities = citiesOf(game, p.index);
  if (!cities.length) return 0;
  const tell = (label: string, value: number) => {
    if (parts && Math.round(value)) parts.push({ label, value: Math.round(value) });
  };
  const civ = civEffects(game, p);
  const friends = cityStateBonus(game, p).happiness;
  let good = 9 + friends; // Prince's base, and mercantile friends
  tell('Base', 9);
  tell('City-state friends', friends);
  const lux = luxuries(game, p);
  const fromLuxuries = lux.size * (4 + civ.reduce((s, e) => s + (e.happinessPerLuxury ?? 0), 0));
  // Cultural Diplomacy: luxuries from city-state allies half again as cheering.
  const own = has(civ, 'cs_resources_double') ? ownLuxuries(game, p) : null;
  const allied = own ? new Set(alliedLuxuries(game, p).filter((r) => lux.has(r) && !own.has(r))).size * 2 : 0;
  good += fromLuxuries + allied;
  tell(`Luxuries (${lux.size} kind${lux.size === 1 ? '' : 's'})`, fromLuxuries + allied);
  const big = has(civ, 'happiness_per_10_pop') ? cities.reduce((s, c) => s + Math.floor(c.pop / 10), 0) : 0;
  const faith = religionHappiness(game, p);
  const nature = natureHappiness(game, p.index);
  good += big + faith + nature;
  tell('Large cities', big);
  tell('Religion', faith);
  tell('Natural wonders', nature);
  const india = has(civ, 'india_population_happiness');
  let bad = 0;
  let built = 0;
  let fromCities = 0;
  let fromCitizens = 0;
  let fromOccupied = 0;
  let monarchy = 0;
  const memo: CityMemo = {};
  for (const c of cities) {
    const effects = cityEffects(game, c, memo);
    for (const e of effects) built += e.happiness ?? 0;
    fromCities += (c.puppet ? UNHAPPINESS_PER_CITY / 2 : UNHAPPINESS_PER_CITY) * (india ? 2 : 1);
    // (A puppet's people aren't unhappy at the occupation: annexed, they are, till a Courthouse.)
    const occupied = c.occupied && !c.puppet && !has(effects, 'no_occupied_unhappiness');
    fromCitizens += c.pop * (india ? 0.5 : 1);
    fromOccupied += occupied ? c.pop * 0.34 * (india ? 0.5 : 1) : 0;
    // Monarchy: one less for every two citizens in the capital.
    if (c.capital && has(effects, 'capital_unhappiness_half')) monarchy += Math.floor(c.pop / 2);
  }
  good += built;
  const others = dissent(game, p);
  bad = fromCities + fromCitizens + fromOccupied - monarchy + others;
  const less = Math.min(60, civ.reduce((s, e) => s + (e.unhappinessPercent ?? 0), 0));
  tell('Buildings, wonders, policies', built);
  tell(`Cities (${cities.length})`, -fromCities);
  tell('Citizens', -fromCitizens);
  tell('Occupied cities', -fromOccupied);
  tell('Monarchy', monarchy);
  tell('Other ideologies', -others);
  tell(`Policies: ${less}% less unhappiness`, (bad * less) / 100);
  return Math.floor(good - bad * (1 - less / 100));
}

/** Happiness a religion's founder has from its reach: Ceremonial Burial (each city following it), Peace Loving (each 5 followers abroad). */
function religionHappiness(game: Game, p: Player): number {
  const rel = p.religion ? game.religions[p.religion] : undefined;
  if (!rel || rel.founder !== p.index) return 0;
  const following = game.cities.filter((c) => cityReligion(c) === p.religion);
  const beliefs = religionEffects(game, p.religion!);
  let n = 0;
  if (has(beliefs, 'ceremonial_burial')) n += following.length;
  if (has(beliefs, 'peace_loving')) n += Math.floor(following.filter((c) => c.owner !== p.index).reduce((s, c) => s + (c.followers?.[p.religion!] ?? 0), 0) / 5);
  return n;
}

/**
 * Unhappiness from other ideologies (Civ V's public opinion, simply): 2 for each civ of another
 * ideology whose tourism has reached a third of this civ's lifetime of culture (4 from a civ with
 * Dictatorship of the Proletariat).
 */
export function dissent(game: Game, p: Player): number {
  return Object.values(ideologyPressure(game, p)).reduce((s, n) => s + n, 0);
}

/** The dissent each other ideology causes in a civ (`dissent`, by ideology). */
export function ideologyPressure(game: Game, p: Player): Record<string, number> {
  const out: Record<string, number> = {};
  if (!p.ideology || p.lifetimeCulture <= 0) return out;
  for (const o of game.players) {
    if (o === p || !o.alive || !o.ideology || o.ideology === p.ideology) continue;
    if ((o.tourism[p.index] ?? 0) * 3 < p.lifetimeCulture) continue;
    out[o.ideology] = (out[o.ideology] ?? 0) + (has(policyEffects(o, game), 'ideology_pressure_double') ? 4 : 2);
  }
  return out;
}

/** The ideology a civ's people lean to (Civ V's public opinion): the other one pressing it hardest, if any does. */
export function preferredIdeology(game: Game, p: Player): string | null {
  const by = Object.entries(ideologyPressure(game, p)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return by[0]?.[0] ?? null;
}

/** Gold a turn: cities' gold less buildings' and units' upkeep and roads. */
export function goldUpkeep(game: Game, p: Player): { buildings: number; units: number; roads: number } {
  const civ = civEffects(game, p);
  const uCheaper = Math.min(75, civ.reduce((s, e) => s + (e.unitUpkeep ?? 0), 0));
  let buildings = 0;
  for (const c of citiesOf(game, p.index)) for (const b of c.buildings) buildings += BUILDINGS[b]?.upkeep ?? 0;
  // Oligarchy: garrisons are free.
  const garrisonsFree = has(civ, 'garrison_free');
  const military = unitsOf(game, p.index).filter((u) => !['settler', 'worker', 'work_boat'].includes(u.type) && !isGreatPerson(u.type) && !(garrisonsFree && isMilitary(UNITS[u.type]) && game.cities.some((c) => c.tile === u.tile && c.owner === p.index))).length;
  // Civ V's unit upkeep grows with the game: a few are free, the rest cost more as the game goes on
  // (by its turns at quick speed: 1 more each 120, each 180 at standard).
  const free = 3 + citiesOf(game, p.index).length;
  const units = Math.max(0, military - free) * (1 + (game.turn * SPEEDS.quick) / speed(game) / 120) * (inForce(game, 'standing_army_tax') ? 1.25 : 1);
  const roads = game.tiles.filter((t) => t.owner === p.index && t.road && !game.cities.some((c) => game.tiles[c.tile] === t)).length * 0.5 * (has(civ, 'road_upkeep_less') ? 2 / 3 : 1);
  return { buildings: Math.floor(buildings), units: Math.floor(units * (1 - uCheaper / 100)), roads: Math.floor(roads) };
}

/** Culture for the next social policy (Civ V's: 25 + (3n)^2.01, 10% more for each city past the first, at speed). */
export function policyCost(game: Game, p: Player): number {
  const n = p.policies.length;
  const cities = citiesOf(game, p.index).length;
  const civ = civEffects(game, p);
  const cheaper = Math.min(50, civ.reduce((s, e) => s + (e.policyCost ?? 0), 0));
  // Representation: each city adds a third less.
  const perCity = has(civ, 'policy_city_cost_less') ? 0.1 * (2 / 3) : 0.1;
  return Math.floor((25 + Math.pow(3 * n, 2.01)) * (1 + perCity * Math.max(0, cities - 1)) * speed(game) * (1 - cheaper / 100) / 5) * 5;
}

/**
 * Points for the next great person of a kind (100, then more each time). Generals and admirals, from
 * battles' experience, take twice that: one to three in a warlike civ's game, as in Civ V.
 */
export function greatCost(game: Game, p: Player, kind: GreatKind): number {
  const n = p.greatCount[kind] ?? 0;
  return Math.floor((kind === 'general' || kind === 'admiral' ? 200 : 100) * (1 + n) * speed(game));
}

/** Golden age points needed for the next one. */
export const goldenCost = (game: Game, p: Player) => Math.floor((500 + 250 * p.goldenAges) * (1 + 0.02 * citiesOf(game, p.index).length) * speed(game));

/** Production cost of something at the game's speed. */
export const scaled = (game: Game, cost: number) => Math.max(1, Math.floor(cost * speed(game)));

/** Gold to buy something outright (Civ V's: production^0.75 * 16, by speed and with any discount). */
export function purchaseCost(game: Game, p: Player, prodCost: number, kind: 'unit' | 'building' | 'wonder'): number {
  if (kind === 'wonder') return Infinity;
  let cheaper = 0;
  for (const e of civEffects(game, p)) for (const d of e.purchaseDiscount ?? []) if (!d.kind || d.kind === kind) cheaper += d.percent;
  return Math.floor(Math.pow(scaled(game, prodCost) * 30, 0.75) * (1 - Math.min(75, cheaper) / 100));
}
