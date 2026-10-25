import { earthDry, earthSeas, earthLand, earthLatitude, earthRidges, earthRivers, earthWet, TRUE_STARTS, tileOfLonLat } from './earth';
import { distance, neighbour, neighbours, rowOf, colOf, within, type Grid } from './hex';
import { fitsSite, NATURAL_WONDER_LIST, type NaturalWonder } from './nature';
import type { MapType, Tile } from './state';
import { FEATURES, RESOURCES, TERRAINS, type FeatureId, type TerrainId } from './terrain';

/**
 * A new world: land and sea from layered noise (continents, one great landmass, scattered islands,
 * land round an inland sea, broken high country) or the Earth's own (`earth.ts`),
 * mountains and hills where the land rises, climate by latitude and rainfall (snow and tundra toward
 * the poles, desert where it's hot and dry), forests, jungles and marshes, rivers running from the high
 * ground to the sea, resources where each belongs, ancient ruins, hidden antiquity sites, starting places spread fairly,
 * and a few natural wonders where the land suits them. The same seed makes the same world (and the
 * Earth the same Earth, with its hills, forests and resources as the seed has them).
 */

/** A small seeded generator (mulberry32): `next()` 0..1. */
export class Rng {
  constructor(public state: number) {}
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(lo: number, hi: number) {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.next() * list.length)];
  }
  chance(p: number) {
    return this.next() < p;
  }
}

/** Smooth value noise on a lattice of `cell` tiles: on a world that wraps, a whole number of cells across it, the last beside the first, so the noise runs on round it. */
function noiseField(g: Grid, rng: Rng, cell: number): number[] {
  const round = g.wrap ? Math.max(1, Math.round(g.width / cell)) : 0;
  const cw = g.wrap ? round : Math.ceil(g.width / cell) + 2;
  const ch = Math.ceil(g.height / cell) + 2;
  const lattice = Array.from({ length: cw * ch }, () => rng.next());
  const at = (x: number, y: number) => lattice[Math.min(ch - 1, y) * cw + (g.wrap ? x % cw : Math.min(cw - 1, x))];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const out: number[] = [];
  for (let row = 0; row < g.height; row++)
    for (let col = 0; col < g.width; col++) {
      // Rows are offset by half a tile on odd rows, as the hexes are.
      const x = g.wrap ? ((col + (row & 1) * 0.5) / g.width) * round : (col + (row & 1) * 0.5) / cell;
      const y = (row * 0.866) / cell;
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const fx = smooth(x - x0);
      const fy = smooth(y - y0);
      const a = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
      const b = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
      out.push(a * (1 - fy) + b * fy);
    }
  return out;
}

/** Several octaves of noise, 0..1. */
function fractal(g: Grid, rng: Rng, base: number, octaves = 4): number[] {
  const fields = Array.from({ length: octaves }, (_, i) => noiseField(g, rng, Math.max(1.5, base / 2 ** i)));
  const out: number[] = [];
  let total = 0;
  for (let i = 0; i < octaves; i++) total += 0.5 ** i;
  for (let t = 0; t < g.width * g.height; t++) {
    let v = 0;
    for (let i = 0; i < octaves; i++) v += fields[i][t] * 0.5 ** i;
    out.push(v / total);
  }
  return out;
}

/** The value below which `fraction` of the list lies. */
function quantile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * fraction)))];
}

export interface Generated {
  tiles: Tile[];
  /** Good places to start, best first, spread out. */
  starts: number[];
}

/**
 * Make a world. `players` + `cityStates` places to start are looked for; on the Earth, given each
 * start's civ (`trueStarts`, in the same order), each is where that civ really began, or as near as
 * the land allows.
 */
export function generate(g: Grid, seed: number, type: MapType, players: number, cityStates: number, trueStarts?: string[]): Generated {
  const rng = new Rng(seed);
  const n = g.width * g.height;
  const earth = type === 'earth';
  // --- Land and sea
  const base = type === 'pangaea' || type === 'inland_sea' ? Math.max(g.width, g.height) / 2.2 : type === 'archipelago' ? 4 : type === 'fractal' || type === 'highlands' || earth ? 6 : 9;
  const elev = fractal(g, rng, base, 5);
  // The Earth: its own land, the noise only the lie of it (higher along the great ranges).
  const earthShare = earth ? earthLand(g) : [];
  // (The narrow seas drawn on: `earth.ts`.)
  if (earth) for (const t of earthSeas(g)) earthShare[t] = 0;
  if (earth) {
    const ridges = earthRidges(g, (t) => neighbours(g, t));
    for (let t = 0; t < n; t++) elev[t] = isEarthLand(g, earthShare, t) ? 0.35 + 0.35 * elev[t] + ridges[t] : 0.3 * elev[t];
  }
  // Falloff toward the map's edges (and, for continents, a channel down the middle so there's more than one).
  // A world that wraps has no east and west edges: a pangaea has its ocean round it at a longitude of
  // its own (as a flat map's are at its edges, joined), continents two oceans half the world apart,
  // and fractal land and islands run on round it; north and south fall off to the poles as ever.
  // An inland sea: land all round a great sea in the middle (and a world that wraps, land on round
  // its back), only the poles' edges sea.
  const meridian = g.wrap && !earth ? rng.next() : 0;
  for (let t = 0; !earth && t < n; t++) {
    const y = (rowOf(g, t) + 0.5) / g.height;
    const poles = Math.min(y * 1.4, (1 - y) * 1.4);
    if (type === 'inland_sea') {
      const x = g.wrap ? ((colOf(g, t) + 0.5) / g.width - meridian + 1.5) % 1 : (colOf(g, t) + 0.5) / g.width;
      const d = Math.hypot((x - 0.5) / 0.32, (y - 0.5) / 0.36);
      elev[t] = (0.35 * elev[t] + 0.65 * Math.min(1, Math.max(0, (d - 0.55) / 0.5))) * Math.min(1, poles * 14) * (g.wrap ? 1 : Math.min(1, Math.min(x, 1 - x) * 14));
      continue;
    }
    if (g.wrap) {
      const x = ((colOf(g, t) + 0.5) / g.width - meridian + 1) % 1;
      const ocean = type === 'pangaea' ? Math.min(x, 1 - x) : type === 'continents' ? 2 * Math.min(x, Math.abs(x - 0.5), 1 - x) : Infinity;
      elev[t] *= Math.min(1, Math.min(ocean, poles) * 6);
      continue;
    }
    const x = (colOf(g, t) + 0.5) / g.width;
    const edge = Math.min(x, 1 - x, poles);
    elev[t] *= Math.min(1, edge * 6);
    if (type === 'continents') elev[t] *= 1 - 0.55 * Math.exp(-(((x - 0.5) / 0.07) ** 2));
  }
  // Archipelago: the world in cells round scattered points, sea between them, so its land comes as
  // many islands (each civ mostly on its own) rather than one mass with a few rocks off it. The
  // first points' cells (one for each civ) are given land enough for three or four cities (below).
  const cellOf = new Array<number>(n).fill(-1);
  if (type === 'archipelago') {
    const cells = players + Math.ceil(cityStates / 2) + 3;
    const spacing = Math.sqrt(n / cells);
    const points: number[] = [];
    for (let tries = 0; points.length < cells && tries < cells * 60; tries++) {
      const t = rng.int(0, n - 1);
      const x = (colOf(g, t) + 0.5) / g.width;
      const y = (rowOf(g, t) + 0.5) / g.height;
      if ((!g.wrap && (x < 0.08 || x > 0.92)) || y < 0.12 || y > 0.88) continue;
      if (points.every((p) => distance(g, p, t) >= spacing * 0.75)) points.push(t);
    }
    for (let t = 0; t < n; t++) {
      const ds = points.map((p, i) => ({ d: distance(g, p, t), i })).sort((a, b) => a.d - b.d);
      // (Two tiles or so of sea where two cells meet.)
      const gap = (ds[1]?.d ?? Infinity) - ds[0].d;
      elev[t] *= Math.min(1, Math.max(0, (gap - 1) / 2.5));
      cellOf[t] = ds[0].i;
    }
  }
  const landShare = type === 'archipelago' ? 0.3 : type === 'pangaea' ? 0.42 : type === 'inland_sea' ? 0.6 : type === 'highlands' ? 0.52 : 0.38;
  const sea = quantile(elev, 1 - landShare);
  const land = earth ? earthShare.map((_, t) => isEarthLand(g, earthShare, t)) : elev.map((e) => e > sea);
  // A civ's cell whose main island is too small for three or four cities: the island grown into the
  // cell's highest ground beside it (never touching another cell's land) to `START_ISLAND` and a few.
  if (type === 'archipelago')
    for (let i = 0; i < players; i++) {
      const cell = elev.map((_, t) => t).filter((t) => cellOf[t] === i);
      if (!cell.length) continue;
      const labels = landmassesOf(g, land);
      const count = new Map<number, number>();
      for (const t of cell) if (labels[t] >= 0) count.set(labels[t], (count.get(labels[t]) ?? 0) + 1);
      const main = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const island = new Set(main === undefined ? [cell.sort((a, b) => elev[b] - elev[a])[0]] : labels.flatMap((l, t) => (l === main ? [t] : [])));
      for (const t of island) land[t] = true;
      while (island.size < START_ISLAND + 4) {
        let best = -1;
        for (const t of island) for (const x of neighbours(g, t)) if (!land[x] && cellOf[x] === i && !neighbours(g, x).some((y) => land[y] && cellOf[y] !== i) && (best < 0 || elev[x] > elev[best])) best = x;
        if (best < 0) break;
        land[best] = true;
        island.add(best);
      }
    }
  // Highlands: ridges of mountains with hills either side over nearly half the land (along the lines
  // where a noise crosses its middle), the low ground in valleys between; elsewhere the highest land.
  const highlands = type === 'highlands';
  const rise = highlands ? fractal(g, rng, 5, 3).map((v) => 1 - Math.abs(2 * v - 1)) : elev;
  const landVals = rise.filter((_, t) => land[t]);
  const mountainAt = quantile(landVals, highlands ? 0.88 : 0.93);
  const hillAt = quantile(landVals, highlands ? 0.5 : 0.78);

  // --- Climate
  const wet = fractal(g, rng, 6, 4);
  const warmth = fractal(g, rng, 8, 3);
  const tiles: Tile[] = [];
  // 0 at the equator, 1 at the poles (the Earth's, by its real latitude).
  const latOf = (t: number) => (earth ? earthLatitude(g, t) : Math.abs((rowOf(g, t) + 0.5) / g.height - 0.5) * 2);
  // The Earth's rain: little in the deserts, most in the rainforests.
  if (earth) for (let t = 0; t < n; t++) wet[t] = earthDry(g, t) ? 0.15 : earthWet(g, t) ? 0.8 : 0.2 + 0.5 * wet[t];
  for (let t = 0; t < n; t++) {
    const lat = latOf(t);
    const temp = 1 - lat * 1.05 + (warmth[t] - 0.5) * (earth ? 0.15 : 0.35);
    if (!land[t]) {
      tiles.push({ terrain: 'ocean', elevation: 'flat', owner: -1, height: 0, ...(lat > 0.9 && rng.chance(0.6) ? { feature: 'ice' as FeatureId } : {}) });
      continue;
    }
    let terrain: TerrainId;
    if (temp < 0.12) terrain = 'snow';
    else if (temp < 0.28) terrain = 'tundra';
    else if ((temp > 0.72 && wet[t] < 0.42) || (earth && temp > 0.35 && earthDry(g, t))) terrain = 'desert';
    else if (wet[t] > 0.45) terrain = 'grassland';
    else terrain = 'plains';
    const elevation = rise[t] > mountainAt ? 'mountain' : rise[t] > hillAt ? 'hills' : 'flat';
    tiles.push({ terrain, elevation, owner: -1, height: 1 });
  }
  // Coast: sea next to land; lakes: small seas with no way out.
  for (let t = 0; t < n; t++) if (!land[t] && neighbours(g, t).some((x) => land[x])) tiles[t].terrain = 'coast';
  markLakes(g, tiles);

  // --- Features: jungle in the wet tropics; forests in woods of their own (not wherever it's wet, which
  // would cover nearly all the grassland: a quarter of the land is wooded, as on Civ V's maps).
  const woods = fractal(g, rng, 5, 4);
  const woodsAt = quantile(woods.filter((_, t) => land[t]), 0.7);
  for (let t = 0; t < n; t++) {
    const tile = tiles[t];
    if (TERRAINS[tile.terrain].water || tile.elevation === 'mountain') continue;
    const lat = latOf(t);
    const w = wet[t];
    if (tile.terrain === 'desert') {
      if (rng.chance(0.04) && tile.elevation === 'flat') tile.feature = 'oasis';
      continue;
    }
    if (tile.terrain === 'snow') continue;
    if (lat < 0.35 && w > 0.6 && tile.terrain !== 'tundra' && rng.chance(0.7)) tile.feature = 'jungle';
    else if (woods[t] > woodsAt && rng.chance(0.85)) tile.feature = 'forest';
    else if (tile.terrain === 'grassland' && tile.elevation === 'flat' && w > 0.6 && rng.chance(0.18)) tile.feature = 'marsh';
    if (tile.feature === 'jungle') tile.terrain = 'plains';
  }

  // --- Rivers: from high ground down to the sea or a lake (on the Earth, its great rivers and fewer others).
  if (earth) for (const course of earthRivers(g)) for (const t of course) if (tiles[t].elevation !== 'mountain' && !TERRAINS[tiles[t].terrain].water) tiles[t].river = true;
  const rivers = Math.round((g.width * g.height) / (earth ? 280 : 140));
  for (let i = 0; i < rivers; i++) {
    const springs = tiles.map((_, t) => t).filter((t) => tiles[t].elevation === 'hills' || (tiles[t].elevation === 'mountain' && neighbours(g, t).some((x) => tiles[x].elevation !== 'mountain')));
    if (!springs.length) break;
    let at = rng.pick(springs);
    if (tiles[at].elevation === 'mountain') at = neighbours(g, at).find((x) => tiles[x].elevation !== 'mountain' && !TERRAINS[tiles[x].terrain].water) ?? at;
    const seen = new Set<number>();
    for (let step = 0; step < 40; step++) {
      seen.add(at);
      if (tiles[at].elevation !== 'mountain' && !TERRAINS[tiles[at].terrain].water) tiles[at].river = true;
      const next = neighbours(g, at)
        .filter((x) => !seen.has(x) && tiles[x].elevation !== 'mountain')
        .sort((a, b) => elev[a] - elev[b])[0];
      if (next === undefined || TERRAINS[tiles[next].terrain].water) break;
      at = next;
    }
  }
  // Flood plains: desert on a river.
  for (const tile of tiles) if (tile.river && tile.terrain === 'desert' && tile.elevation === 'flat' && !tile.feature) tile.feature = 'floodplains';

  // --- Heights for the voxel map: hills a step up, mountains tall, land rising inland.
  for (let t = 0; t < n; t++) {
    const tile = tiles[t];
    if (TERRAINS[tile.terrain].water) tile.height = 0;
    else tile.height = 1 + (tile.elevation === 'hills' ? 2 : tile.elevation === 'mountain' ? 5 + Math.round(rng.next() * 3) : 0);
  }

  // --- Starting places, then resources (a fair few near each start), ruins.
  let starts = type === 'archipelago' ? pickIslandStarts(g, tiles, rng, players, cityStates, cellOf) : pickStarts(g, tiles, rng, players + cityStates);
  if (earth && trueStarts) starts = pickTrueStarts(g, tiles, trueStarts, starts);
  placeResources(g, tiles, rng, starts.slice(0, players));
  for (let t = 0; t < n; t++) {
    const tile = tiles[t];
    if (TERRAINS[tile.terrain].water || tile.elevation === 'mountain' || tile.resource) continue;
    if (starts.some((s) => distance(g, s, t) < 4)) continue;
    if (rng.chance(0.012)) tile.ruin = true;
  }
  // Antiquity sites of older times, hidden until Treasure Fleets or Aesthetics show them.
  for (let t = 0; t < n; t++) {
    const tile = tiles[t];
    if (TERRAINS[tile.terrain].water || tile.elevation === 'mountain' || tile.ruin || starts.includes(t)) continue;
    if (rng.chance(0.01)) {
      tile.antiquity = true;
      tile.hiddenAntiquity = true;
    }
  }
  placeNaturalWonders(g, tiles, rng, starts, players);
  strategicBalance(g, tiles, rng, starts.slice(0, players));
  modernStrategics(g, tiles, rng, starts, starts.slice(players, players + cityStates).filter((t) => t >= 0));
  return { tiles, starts };
}

/**
 * The volcanoes (`disasters.ts`), set on a few of a new world's mountains after the rest of it is
 * made (in a game with disasters), by a stream of random numbers of their own (so the map a seed made before is the same, but for them): mountains
 * with land beside them for the ash to fall on, not by a start, and spread apart.
 */
export function placeVolcanoes(g: Grid, tiles: Tile[], seed: number, starts: number[]) {
  const rng = new Rng((seed ^ 0x766f6c63) >>> 0);
  const count = Math.max(2, Math.round((g.width * g.height) / 260));
  const sites = tiles
    .map((_, t) => t)
    .filter((t) => {
      const tile = tiles[t];
      if (tile.elevation !== 'mountain' || tile.wonder || tile.feature === 'ice' || TERRAINS[tile.terrain].water) return false;
      if (starts.some((s) => distance(g, s, t) <= 2)) return false;
      return neighbours(g, t).filter((n) => !TERRAINS[tiles[n].terrain].water && tiles[n].elevation !== 'mountain' && !tiles[n].wonder).length >= 2;
    });
  const placed: number[] = [];
  while (placed.length < count && sites.length) {
    const t = sites.splice(Math.floor(rng.next() * sites.length), 1)[0];
    if (placed.some((p) => distance(g, p, t) < 5)) continue;
    tiles[t].volcano = true;
    placed.push(t);
  }
}

/**
 * Civ V's Strategic Balance: every civ's start has Horses and Iron within about four tiles (a near
 * spot first), and Coal and Oil on its own landmass within ten, unless there's no ground for them
 * (Oil may lie just off the coast). Each is placed only where the civ has none in reach already.
 */
function strategicBalance(g: Grid, tiles: Tile[], rng: Rng, starts: number[]) {
  const fits = (t: number, id: string) => {
    const tile = tiles[t];
    if (tile.resource || tile.ruin || tile.wonder || tile.antiquity || tile.elevation === 'mountain' || tile.feature === 'ice' || tile.feature === 'oasis') return false;
    return RESOURCES[id].on.some((on) => on === tile.terrain || on === tile.feature || on === tile.elevation);
  };
  // One of `id` in reach, or placed: on a nearer spot if one fits, else anywhere in reach.
  const ensure = (id: string, reach: number[], nearer: number[] = reach) => {
    if (reach.some((t) => tiles[t].resource === id)) return;
    const options = nearer.some((t) => fits(t, id)) ? nearer.filter((t) => fits(t, id)) : reach.filter((t) => fits(t, id));
    if (!options.length) return;
    const t = rng.pick(options);
    tiles[t].resource = id;
    const amount = RESOURCES[id].amount;
    if (amount) tiles[t].amount = rng.int(amount[0], amount[1]);
  };
  for (const s of starts) {
    const ground = (r: number) => within(g, s, r).filter((t) => t !== s && !TERRAINS[tiles[t].terrain].water);
    for (const id of ['horses', 'iron']) ensure(id, ground(4), ground(3));
    const land = landmass(g, tiles, s);
    const onLand = within(g, s, 10).filter((t) => t !== s && !starts.includes(t) && land.has(t));
    const offshore = within(g, s, 10).filter((t) => TERRAINS[tiles[t].terrain].water && neighbours(g, t).some((n) => land.has(n)));
    ensure('coal', onLand);
    ensure('oil', [...onLand, ...offshore], onLand);
  }
}

/**
 * Civ V's modern strategics, the last of a new world's resources: Aluminum about as common across the
 * land as Iron or Oil (commoner than Oil, in Civ V), Uranium about half as common, each scattered
 * where it belongs and near no start in particular, so many to the tiles that suit it (as Civ V
 * counts them, so a map is never without); and three city-states in four a small deposit of Coal,
 * Oil or Aluminum beside them (Civ V's `AddModernMinorStrategicsToCityStates`). (Left to the roll in
 * `placeResources` alone they were rare: a small map often had no Aluminum at all, and so no Jet
 * Fighters, Stealth Bombers, Modern Armor, Hydro Plants or Spaceship Factories.)
 */
function modernStrategics(g: Grid, tiles: Tile[], rng: Rng, starts: number[], cityStates: number[]) {
  const fits = (t: number, id: string) => {
    const tile = tiles[t];
    if (tile.resource || tile.ruin || tile.wonder || tile.antiquity || starts.includes(t) || tile.elevation === 'mountain' || tile.feature === 'ice' || tile.feature === 'oasis') return false;
    return RESOURCES[id].on.some((on) => on === tile.terrain || on === tile.feature || on === tile.elevation);
  };
  const place = (t: number, id: string, small = false) => {
    const [lo, hi] = RESOURCES[id].amount!;
    tiles[t].resource = id;
    tiles[t].amount = small ? lo : rng.int(lo, hi);
  };
  for (const [id, share] of Object.entries(MODERN_SHARE)) {
    const spots = tiles.map((_, t) => t).filter((t) => fits(t, id));
    // (Spread out: none beside another of its kind.)
    for (let left = Math.ceil(spots.length * share); left > 0 && spots.length; ) {
      const t = spots.splice(Math.floor(rng.next() * spots.length), 1)[0];
      if (neighbours(g, t).some((n) => tiles[n].resource === id)) continue;
      place(t, id);
      left--;
    }
  }
  for (const cs of cityStates) {
    const roll = rng.int(0, 3);
    if (!roll) continue;
    const id = (['coal', 'oil', 'aluminum'] as const)[roll - 1];
    const spots = within(g, cs, 3).filter((t) => t !== cs && fits(t, id));
    if (spots.length) place(rng.pick(spots), id, true);
  }
}

/** The share of the tiles free for it that get a deposit, in `modernStrategics`. */
const MODERN_SHARE = { aluminum: 0.03, uranium: 0.02 };

/** The land tiles joined to a tile by land (mountains included). */
function landmass(g: Grid, tiles: Tile[], from: number): Set<number> {
  const out = new Set<number>([from]);
  const queue = [from];
  while (queue.length) {
    for (const n of neighbours(g, queue.pop()!)) {
      if (out.has(n) || TERRAINS[tiles[n].terrain].water) continue;
      out.add(n);
      queue.push(n);
    }
  }
  return out;
}

/**
 * Natural wonders: a few for the map's size (two on a duel map, six on a large one), each of a kind
 * picked at random where its site fits (`nature.ts`; a pair of tiles for some), spread apart, kept
 * off the starts (four tiles from a civ's, two from a city-state's) and never closing a way through
 * the land. Its tiles become its own: nothing else on them, and mountains to the rules unless it can
 * be entered.
 */
function placeNaturalWonders(g: Grid, tiles: Tile[], rng: Rng, starts: number[], players: number) {
  const want = Math.max(1, Math.round((g.width * g.height) / 250));
  const kinds = [...NATURAL_WONDER_LIST];
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  const placed: number[] = [];
  let count = 0;
  const edge = (t: number) => (!g.wrap && (colOf(g, t) < 1 || colOf(g, t) >= g.width - 1)) || rowOf(g, t) < 2 || rowOf(g, t) >= g.height - 2;
  const free = (t: number) => !edge(t) && starts.every((s, i) => distance(g, s, t) >= (i < players ? 4 : 3)) && placed.every((p) => distance(g, p, t) >= 5);
  // Taking a tile (with its partner) keeps the land joined round it, and leaves it workable.
  const open = (w: NaturalWonder, t: number, partner = -1) => (w.passable || tiles[t].elevation === 'mountain' || TERRAINS[tiles[t].terrain].water || keepsWayThrough(g, tiles, t, partner)) && reachable(g, tiles, t);
  for (const w of kinds) {
    if (count >= want) break;
    const sites: number[][] = [];
    for (let t = 0; t < tiles.length; t++) {
      if (!free(t) || !fitsSite(g, tiles, t, w) || !open(w, t)) continue;
      if (!w.pair) {
        sites.push([t]);
        continue;
      }
      for (const d of w.pair.dirs) {
        const n = neighbour(g, t, d);
        if (n < 0 || !free(n) || !w.pair.terrain.includes(tiles[n].terrain) || !w.pair.elevation.includes(tiles[n].elevation) || tiles[n].feature === 'ice') continue;
        if (open(w, t, n) && open(w, n, t)) sites.push([t, n]);
      }
    }
    if (!sites.length) continue;
    for (const t of rng.pick(sites)) {
      const tile = tiles[t];
      tile.wonder = w.id;
      for (const k of ['feature', 'resource', 'amount', 'river', 'ruin', 'antiquity', 'hiddenAntiquity'] as const) delete tile[k];
      if (!w.passable) {
        tile.elevation = 'mountain';
        tile.height = w.top;
      }
      placed.push(t);
    }
    count++;
  }
}

/** Whether land a tile's taken from (with another, `also`) stays joined round it: the land that can be crossed next to it is all one run. */
function keepsWayThrough(g: Grid, tiles: Tile[], t: number, also = -1): boolean {
  const open = Array.from({ length: 6 }, (_, d) => {
    const n = neighbour(g, t, d);
    return n >= 0 && n !== also && !TERRAINS[tiles[n].terrain].water && tiles[n].elevation !== 'mountain' && tiles[n].feature !== 'ice' && !tiles[n].wonder;
  });
  return open.filter((o, d) => o && !open[(d + 5) % 6]).length <= 1;
}

/** Whether a wonder there could be worked: some land (or, for one at sea, sea) next to it that isn't a mountain. */
const reachable = (g: Grid, tiles: Tile[], t: number) => neighbours(g, t).filter((n) => tiles[n].elevation !== 'mountain' && tiles[n].feature !== 'ice').length >= 2;

/** Seas cut off from the ocean and smaller than ten tiles are lakes. */
function markLakes(g: Grid, tiles: Tile[]) {
  const seen = new Set<number>();
  for (let t = 0; t < tiles.length; t++) {
    if (seen.has(t) || !TERRAINS[tiles[t].terrain].water) continue;
    const body: number[] = [];
    const stack = [t];
    seen.add(t);
    while (stack.length) {
      const x = stack.pop()!;
      body.push(x);
      for (const y of neighbours(g, x)) if (!seen.has(y) && TERRAINS[tiles[y].terrain].water) (seen.add(y), stack.push(y));
    }
    if (body.length < 10) for (const x of body) tiles[x].terrain = 'lake';
  }
}

/** How good a place is to found a city: what's around it (food first), fresh water, the coast. */
export function startValue(g: Grid, tiles: Tile[], t: number): number {
  const tile = tiles[t];
  if (TERRAINS[tile.terrain].water || tile.elevation === 'mountain' || tile.terrain === 'snow' || tile.feature === 'ice') return -Infinity;
  let v = 0;
  for (const x of within(g, t, 2)) {
    const o = tiles[x];
    const y = o.elevation === 'hills' ? { food: 0, prod: 2 } : o.elevation === 'mountain' ? {} : TERRAINS[o.terrain].yields;
    const f = o.feature ? FEATURES[o.feature] : null;
    const food = (f?.replace ? (f.yields.food ?? 0) : (y.food ?? 0) + (f?.yields.food ?? 0)) + (o.resource ? (RESOURCES[o.resource].yields.food ?? 0) : 0);
    const prod = f?.replace ? (f.yields.prod ?? 0) : (y.prod ?? 0);
    v += food * 1.4 + prod + (o.river ? 0.5 : 0) + (o.resource ? 1 : 0);
  }
  if (tile.river) v += 4;
  if (neighbours(g, t).some((x) => tiles[x].terrain === 'coast')) v += 3;
  if (tile.elevation === 'hills') v += 2;
  return v;
}

/** `count` starting places: good ones, as far apart as the land allows. */
function pickStarts(g: Grid, tiles: Tile[], rng: Rng, count: number): number[] {
  const value = tiles.map((_, t) => startValue(g, tiles, t));
  const candidates = tiles.map((_, t) => t).filter((t) => Number.isFinite(value[t]) && value[t] > 12);
  const starts: number[] = [];
  // Space them by the map's size, closer as needed.
  for (let spacing = Math.max(5, Math.round(Math.sqrt((g.width * g.height * 0.38) / count) * 1.1)); spacing >= 3 && starts.length < count; spacing--) {
    const sorted = [...candidates].sort((a, b) => value[b] + rng.next() * 3 - (value[a] + rng.next() * 3));
    for (const t of sorted) {
      if (starts.length >= count) break;
      if (starts.every((s) => distance(g, s, t) >= spacing)) starts.push(t);
    }
  }
  return starts;
}

/**
 * The Earth's true starting places: each civ (and city-state) on the best ground within a few tiles
 * of where it really began (`TRUE_STARTS`), nearer counting for more, four tiles at least from any
 * start already placed; one that can't (or isn't from the Earth), a place of the usual ones
 * (`fallback`) clear of those.
 */
function pickTrueStarts(g: Grid, tiles: Tile[], civs: string[], fallback: number[]): number[] {
  const value = tiles.map((_, t) => startValue(g, tiles, t));
  const homes = civs.map((civ) => (TRUE_STARTS[civ] ? tileOfLonLat(g, TRUE_STARTS[civ]) : -1));
  // Each civ's places, nearest home first: the tiles a city can be founded on, out to six tiles.
  const places = homes.map((home) =>
    home < 0 ? [] : within(g, home, 6).filter((t) => Number.isFinite(value[t])).sort((a, b) => distance(g, home, a) - distance(g, home, b) || value[b] - value[a]),
  );
  // (Placed one after another, the first civs take the best of a crowded old world and push the rest
  // out to sea or desert; so the civs are placed in many orders, those with the fewest places first
  // among them, and the order that leaves the starts nearest their homes kept.)
  const place = (order: number[]) => {
    const starts: number[] = civs.map(() => -1);
    const clear = (t: number, gap: number) => starts.every((s) => s < 0 || distance(g, s, t) >= gap);
    let cost = 0;
    for (const i of order) {
      if (homes[i] < 0) continue;
      // (The nearest tile, the best land of those as near: a start stays where it belongs, desert or
      // not. Four tiles apart where they can be, so a first city moved a tile to better ground doesn't
      // crowd out the next; else three, as near as cities may be founded, counted a tile further.)
      const score = (t: number) => value[t] - 1e6 * (distance(g, homes[i], t) + (clear(t, 4) ? 0 : 1));
      const best = places[i].filter((t) => clear(t, 3)).sort((a, b) => score(b) - score(a))[0];
      if (best === undefined) cost += 100;
      else {
        starts[i] = best;
        cost += distance(g, homes[i], best) ** 2;
      }
    }
    return { starts, cost };
  };
  const crowded = civs.map((_, i) => i).sort((a, b) => places[a].length - places[b].length);
  let seed = 1;
  const orders = [civs.map((_, i) => i), crowded];
  for (let k = 0; k < 60; k++) {
    const o = [...crowded];
    for (let j = o.length - 1; j > 0; j--) {
      seed = (seed * 16807) % 2147483647;
      const r = seed % (j + 1);
      [o[j], o[r]] = [o[r], o[j]];
    }
    orders.push(o);
  }
  let { starts } = orders.map(place).reduce((a, b) => (b.cost < a.cost ? b : a));
  starts = [...starts];
  const clear = (t: number, gap: number) => starts.every((s) => s < 0 || distance(g, s, t) >= gap);
  for (let i = 0; i < civs.length; i++) {
    if (starts[i] >= 0) continue;
    const t = fallback.find((x) => !starts.includes(x) && clear(x, 4)) ?? fallback.find((x) => !starts.includes(x) && clear(x, 3));
    if (t !== undefined) starts[i] = t;
  }
  // (A place none could be found for, on a map too small: those after it go without, as `pickStarts`'s do.)
  const end = starts.indexOf(-1);
  return end < 0 ? starts : starts.slice(0, end);
}

/**
 * Whether an Earth tile is land: two-fifths of it at least, or (so the islands a coarse map would lose,
 * Japan, New Zealand, the Philippines, stay) a quarter, away from other land (so coasts don't grow).
 */
function isEarthLand(g: Grid, share: number[], t: number): boolean {
  if (share[t] >= 0.4) return true;
  return share[t] >= 0.25 && neighbours(g, t).every((x) => share[x] < 0.4);
}

/** The land an archipelago civ's island must have to start on: room for three or four cities. */
export const START_ISLAND = 30;

/**
 * An archipelago's starts: each civ on the main island of its own cell (the best start there), so
 * on an island of its own with room for three or four cities (`START_ISLAND`); then the
 * city-states where they fit (`pickStarts`, away from the civs).
 */
function pickIslandStarts(g: Grid, tiles: Tile[], rng: Rng, players: number, cityStates: number, cellOf: number[]): number[] {
  const island = landmasses(g, tiles);
  const value = tiles.map((_, t) => startValue(g, tiles, t));
  const starts: number[] = [];
  for (let i = 0; i < players; i++) {
    // The cell's main island: the landmass most of its land is on.
    const count = new Map<number, number>();
    for (let t = 0; t < tiles.length; t++) if (cellOf[t] === i && island[t] >= 0) count.set(island[t], (count.get(island[t]) ?? 0) + 1);
    const main = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const t = tiles
      .map((_, x) => x)
      .filter((x) => island[x] === main && Number.isFinite(value[x]) && starts.every((s) => distance(g, s, x) >= 6))
      .sort((a, b) => value[b] - value[a])[0];
    if (t !== undefined) starts.push(t);
  }
  // (A civ without one, and the city-states: the usual way, off the civs' islands where they can be.)
  const civIslands = new Set(starts.map((t) => island[t]));
  const rest = pickStarts(g, tiles, rng, players + cityStates).filter((t) => starts.every((s) => distance(g, s, t) >= 4));
  const others = [...rest.filter((t) => !civIslands.has(island[t])), ...rest.filter((t) => civIslands.has(island[t]))];
  return [...starts, ...others].slice(0, players + cityStates);
}

/** Each tile's landmass (an index; -1 for water). */
const landmasses = (g: Grid, tiles: Tile[]) => landmassesOf(g, tiles.map((t) => !TERRAINS[t.terrain].water));

/** Each tile's landmass by which tiles are land (an index; -1 for water). */
function landmassesOf(g: Grid, land: boolean[]): number[] {
  const out = new Array<number>(land.length).fill(-1);
  let next = 0;
  for (let t = 0; t < land.length; t++) {
    if (out[t] >= 0 || !land[t]) continue;
    const stack = [t];
    out[t] = next;
    while (stack.length) for (const n of neighbours(g, stack.pop()!)) if (out[n] < 0 && land[n]) (out[n] = next), stack.push(n);
    next++;
  }
  return out;
}

/** Resources across the map, each kind where it belongs; a couple of food and luxuries near each start. */
function placeResources(g: Grid, tiles: Tile[], rng: Rng, starts: number[]) {
  const fits = (t: number, id: string) => {
    const tile = tiles[t];
    const r = RESOURCES[id];
    if (tile.resource || tile.elevation === 'mountain' || tile.feature === 'ice' || tile.feature === 'oasis') return false;
    return r.on.some((on) => on === tile.terrain || on === tile.feature || on === tile.elevation);
  };
  const ids = Object.keys(RESOURCES);
  const place = (t: number, id: string) => {
    const r = RESOURCES[id];
    tiles[t].resource = id;
    if (r.amount) tiles[t].amount = rng.int(r.amount[0], r.amount[1]);
  };
  // Every tile has a chance, weighted by kind.
  for (let t = 0; t < tiles.length; t++) {
    if (!rng.chance(0.12)) continue;
    const options = ids.filter((id) => fits(t, id));
    if (!options.length) continue;
    const total = options.reduce((s, id) => s + RESOURCES[id].weight, 0);
    let roll = rng.next() * total;
    for (const id of options) if ((roll -= RESOURCES[id].weight) < 0) {
      place(t, id);
      break;
    }
  }
  // Food: Civ V's maps are rich in wheat, cattle, sheep, deer, bananas and fish (more than in luxuries
  // and strategics); the pass above alone left about two food resources in a hundred land tiles.
  const food = ids.filter((id) => RESOURCES[id].kind === 'bonus' && (RESOURCES[id].yields.food ?? 0) > 0);
  for (let t = 0; t < tiles.length; t++) {
    if (tiles[t].resource || !rng.chance(TERRAINS[tiles[t].terrain].water ? 0.03 : 0.07)) continue;
    const options = food.filter((id) => fits(t, id));
    if (options.length) place(t, rng.pick(options));
  }
  // Near each start: a food resource and a luxury, if there's room for them.
  for (const s of starts) {
    const ring = within(g, s, 3).filter((t) => t !== s && distance(g, s, t) >= 1);
    for (const kind of ['bonus', 'luxury', 'luxury'] as const) {
      const spots = ring.filter((t) => !tiles[t].resource);
      for (let tries = 0; tries < 20 && spots.length; tries++) {
        const t = rng.pick(spots);
        const options = ids.filter((id) => RESOURCES[id].kind === kind && fits(t, id));
        if (!options.length) continue;
        place(t, rng.pick(options));
        break;
      }
    }
  }
}
