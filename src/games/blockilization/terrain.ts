import { baseX, centre, centreNear, corners, extent, HEX, nearX, ORIGIN, period, SEA_Y, tileAt, UNIT_SPOTS } from './geometry';
import { landmark } from './landmarks';
import { neighbour, type Grid } from './rules/hex';
import type { Tile } from './rules/state';
import { TERRAINS } from './rules/terrain';

/**
 * The map in blocks: what the server sets in the world (on its sea) when a game begins. Every block
 * column takes the tile it's in: the sea's floor under the coast is sand, land stands a block over the
 * water (in its terrain's colour, with earth under it), hills rise in a dome with rock showing on
 * their crowns, mountains in a rocky peak with snow on top. Each terrain has its own look: tufts of
 * grass on grassland, dry grass on the plains, dunes in the desert, old snow lying in patches on the
 * tundra. Forests are round trees round a tile's edge (pines in the cold), jungles taller trees with
 * flat crowns over ferns; rivers run between their tiles as channels a block deep, banked with silt;
 * marshes are pools among reeds; an oasis is a pool with a palm; a natural wonder is its landmark
 * (`landmarks.ts`). A world that wraps is built once across its period (`geometry.ts`), what runs
 * over its seam (a river, a tree, a landmark) on both sides of it.
 */

export type Edit = [x: number, y: number, z: number, block: string];

/** Each land terrain's top block. */
export const TOP: Record<string, string> = {
  grassland: 'civ_grass',
  plains: 'civ_plains',
  desert: 'civ_desert',
  tundra: 'civ_tundra',
  snow: 'civ_snow',
};

/** Plants on the ground (grass, reeds, ferns): not the land's surface; improvements and roads go over them (ferns, under a jungle's trees, go with the trees). */
export const PLANT_BLOCKS = new Set(['civ_tuft', 'civ_drygrass', 'civ_reeds', 'civ_fern']);

/**
 * Each river tile's links: the directions (`neighbour`) its river comes in and goes out by. The river
 * tiles make a tree, not a web: joining every one to every other beside it (a river that bends back
 * on itself, or two running side by side) drowned them. Worked out from the tiles alone, an old game's
 * too: each run of river tiles is walked out from its mouths (those by the sea or a lake), or from its
 * lowest tile if it has none, a ring at a time, each tile linked to the first it's reached from; and
 * each mouth out to one water beside it, the one most along its river. (A natural wonder on a river
 * is part of it, though its channel isn't drawn: its landmark's in the way.)
 */
export function riverLinks(g: Grid, tiles: Tile[]): Map<number, number[]> {
  const river = (t: number) => t >= 0 && !!tiles[t].river && !TERRAINS[tiles[t].terrain].water;
  const water = (t: number) => t >= 0 && !!TERRAINS[tiles[t].terrain].water;
  const links = new Map<number, number[]>();
  const link = (t: number, d: number) => links.set(t, [...(links.get(t) ?? []), d]);
  const done = new Set<number>();
  for (let first = 0; first < tiles.length; first++) {
    if (!river(first) || done.has(first)) continue;
    const run = [first];
    done.add(first);
    for (let i = 0; i < run.length; i++)
      for (let d = 0; d < 6; d++) {
        const n = neighbour(g, run[i], d);
        if (river(n) && !done.has(n)) {
          done.add(n);
          run.push(n);
        }
      }
    run.sort((a, b) => a - b);
    const mouths = run.filter((t) => [0, 1, 2, 3, 4, 5].some((d) => water(neighbour(g, t, d))));
    const roots = mouths.length ? mouths : [run.reduce((a, b) => (tiles[b].height < tiles[a].height ? b : a))];
    const reached = new Set(roots);
    const queue = [...roots];
    for (let i = 0; i < queue.length; i++)
      for (let d = 0; d < 6; d++) {
        const n = neighbour(g, queue[i], d);
        if (!river(n) || reached.has(n)) continue;
        reached.add(n);
        queue.push(n);
        link(queue[i], d);
        link(n, (d + 3) % 6);
      }
    // (Most along its river: turned furthest from the ways it comes in, straight on if it can.)
    for (const t of mouths) {
      const ins = links.get(t) ?? [];
      let out = -1;
      let most = -1;
      for (let d = 0; d < 6; d++) {
        if (!water(neighbour(g, t, d))) continue;
        const turn = ins.reduce((sum, i) => sum + Math.min((d - i + 6) % 6, (i - d + 6) % 6), 0);
        if (turn > most) {
          most = turn;
          out = d;
        }
      }
      link(t, out);
    }
  }
  return links;
}

/** A point on the map (blocks). */
type Point = { x: number; z: number };

/**
 * A river tile's channel (its riverbed's columns: `bed`, null for rock and off the land), from the
 * ways its river comes in and goes out (`riverLinks`): two blocks wide between the middles of those
 * edges (out a little into the sea or the lake at its mouth), kept off the tile's middle, where its
 * units, town and resources stand. Straight through, it bends to one side; turning, it cuts across
 * toward the inner corner; at its source (or an end with no water) it runs in from its edge to a
 * spring short of the middle; three ways or more, a river through by two of them, bent toward the
 * rest, which flow into its bend (or all meet off to one side). Or, where that would still wet
 * where its units stand, it keeps to the tile's rim, round by its corners. A tile's columns lie a
 * little differently from the next's, so a few such courses are tried, the one that keeps its middle
 * driest (and spills least into its neighbours, and is shortest) taken.
 */
function riverCourse(g: Grid, tiles: Tile[], t: number, links: number[], bed: (x: number, z: number) => Column | undefined): Column[] {
  const c = centre(g, t);
  const ends = links.map((d) => {
    const n = neighbour(g, t, d);
    const b = centreNear(g, n, c.x);
    const k = TERRAINS[tiles[n].terrain].water ? 0.62 : 0.5;
    return { x: c.x + (b.x - c.x) * k, z: c.z + (b.z - c.z) * k };
  });
  const toward = (p: Point, r: number, turn = 0): Point => {
    const a = Math.atan2(p.z - c.z, p.x - c.x) + turn;
    return { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r };
  };
  // A curve from a to b, drawn toward a point between (a quadratic Bezier), as points close together.
  const curve = (a: Point, via: Point, b: Point): Point[] =>
    Array.from({ length: 33 }, (_, i) => {
      const s = i / 32;
      return { x: (1 - s) ** 2 * a.x + 2 * s * (1 - s) * via.x + s ** 2 * b.x, z: (1 - s) ** 2 * a.z + 2 * s * (1 - s) * via.z + s ** 2 * b.z };
    });
  const line = (a: Point, b: Point) => curve(a, { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, b);
  const courses: Point[][][] = [];
  // Round the rim: from one end to another by the corners between them (drawn in a little), going the
  // way round that's `way` (1: clockwise, as the corners go; -1: the other).
  const corner = corners(g, t);
  const at = (p: Point) => Math.atan2(p.z - c.z, p.x - c.x);
  const rim = (from: Point, to: Point, way: number, r: number): Point[] => {
    const a0 = at(from);
    const span = ((((at(to) - a0) * way) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const by = corner
      .map((k) => ({ k, along: ((((at(k) - a0) * way) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) }))
      .filter((k) => k.along > 0 && k.along < span)
      .sort((p, q) => p.along - q.along)
      .map(({ k }) => ({ x: c.x + ((k.x - c.x) * r) / HEX, z: c.z + ((k.z - c.z) * r) / HEX }));
    const stops = [from, ...by, to];
    return stops.slice(1).flatMap((q, i) => line(stops[i], q));
  };
  for (const r of [2.6, 3, 3.4]) {
    if (ends.length === 1) for (const way of [-1, 1]) courses.push([rim(ends[0], toward(ends[0], r, way * 1.05), way, r)]);
    else {
      // (All the ends, by the rim, the long way round the widest gap between them left out.)
      const round = [...ends].sort((p, q) => at(p) - at(q));
      const gaps = round.map((p, i) => (at(round[(i + 1) % round.length]) - at(p) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI);
      const widest = gaps.indexOf(Math.max(...gaps));
      for (const skip of ends.length === 2 ? [0, 1] : [widest]) {
        const order = round.map((_, i) => round[(skip + 1 + i) % round.length]);
        courses.push([order.slice(1).flatMap((q, i) => rim(order[i], q, 1, r))]);
      }
    }
  }
  if (ends.length === 1) {
    for (const turn of [0, -0.6, 0.6, -1.05, 1.05]) for (const r of [1.7, 2.2, 2.7]) courses.push([line(ends[0], toward(ends[0], r, turn))]);
  } else if (ends.length === 2) {
    const [a, b] = ends;
    const apart = Math.abs(Math.atan2(Math.sin(Math.atan2(a.z - c.z, a.x - c.x) - Math.atan2(b.z - c.z, b.x - c.x)), Math.cos(Math.atan2(a.z - c.z, a.x - c.x) - Math.atan2(b.z - c.z, b.x - c.x))));
    if (apart < 2.6) {
      // A turn: toward the corner (or the edge) between its two edges.
      const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      for (const r of [2.6, 3, 3.4, 3.8]) courses.push([curve(a, toward(mid, r), b)]);
    } else for (const side of [-1, 1]) for (const r of [2.6, 3.4, 4.2, 5, 5.8, 6.6]) courses.push([curve(a, toward(a, r, (side * Math.PI) / 2), b)]);
  } else {
    // Three ways or more: a river through by two of them, bent toward the rest, which flow into it at its
    // bend; or all of them meeting off to one side.
    for (let i = 0; i < ends.length; i++)
      for (let j = i + 1; j < ends.length; j++) {
        const rest = ends.filter((_, k) => k !== i && k !== j);
        const side = { x: rest.reduce((s, e) => s + e.x, 0) / rest.length, z: rest.reduce((s, e) => s + e.z, 0) / rest.length };
        for (const r of [3.4, 4.2, 5]) {
          const main = curve(ends[i], toward(side, r), ends[j]);
          const into = (e: Point) => main.reduce((p, q) => (Math.hypot(q.x - e.x, q.z - e.z) < Math.hypot(p.x - e.x, p.z - e.z) ? q : p));
          courses.push([main, ...rest.map((e) => line(e, into(e)))]);
        }
      }
    for (let i = 0; i < 12; i++)
      for (const r of [1.7, 2.3]) {
        const meet = { x: c.x + Math.cos((i * Math.PI) / 6) * r, z: c.z + Math.sin((i * Math.PI) / 6) * r };
        courses.push(ends.map((e) => line(e, meet)));
      }
  }
  // Each course's columns: two either side of its line, all along it.
  const spots = UNIT_SPOTS.map(([ox, oz]) => bed(Math.floor(c.x + ox), Math.floor(c.z + oz)));
  let best: Column[] = [];
  let least = Infinity;
  for (const course of courses) {
    const cols = new Set<Column>();
    for (const pts of course)
      for (let i = 1; i < pts.length; i++) {
        const [p, q] = [pts[i - 1], pts[i]];
        const len = Math.hypot(q.x - p.x, q.z - p.z);
        if (!len) continue;
        const [ax, az] = [-(q.z - p.z) / len, (q.x - p.x) / len];
        for (let s = 0; s <= len; s += 0.25)
          for (const w of [-0.5, 0.5]) {
            const col = bed(Math.floor(p.x + ((q.x - p.x) * s) / len + ax * w), Math.floor(p.z + ((q.z - p.z) * s) / len + az * w));
            if (col) cols.add(col);
          }
      }
    // (Its units' spots wet worst, the middle wet next, a neighbour's columns taken after; then the fewest columns.)
    let score = cols.size;
    spots.forEach((col, i) => col && cols.has(col) && (score += i ? 500 : 2000));
    for (const col of cols) score += col.t !== t ? 3 : col.d * HEX < 1.75 ? 20 : 0;
    if (score < least) {
      least = score;
      best = [...cols];
    }
  }
  return best;
}

/** A column's own small random number, the same every time. */
function hash(x: number, z: number, k = 0): number {
  let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(k, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A land column: where, its tile and how far it is from the tile's middle (0 there, 1 at its corners), its height (its top block's y) and its top block. */
interface Column {
  x: number;
  z: number;
  t: number;
  d: number;
  y: number;
  cap: string;
}

export function terrainEdits(g: Grid, tiles: Tile[]): Edit[] {
  const out: Edit[] = [];
  const size = extent(g);
  // (A column's key: on a world that wraps, its x in the world as built, whichever copy it's asked at.)
  const key = (x: number, z: number) => `${baseX(g, x)},${z}`;
  // Each land column, worked out first so rivers, trees and the land's details know them.
  const land = new Map<string, Column>();
  for (let x = g.wrap ? 0 : Math.floor(ORIGIN.x); x < Math.ceil(size.w); x++)
    for (let z = Math.floor(ORIGIN.z); z < Math.ceil(size.d); z++) {
      const t = tileAt(g, x + 0.5, z + 0.5);
      if (t < 0 || tiles[t].wonder) continue;
      const tile = tiles[t];
      const c = centreNear(g, t, x + 0.5);
      const d = Math.min(1, Math.hypot(x + 0.5 - c.x, z + 0.5 - c.z) / HEX);
      if (TERRAINS[tile.terrain].water) {
        // Shallow water over sand by the coast and in lakes; ice on polar seas.
        if (tile.terrain !== 'ocean') out.push([x, SEA_Y - 1, z, 'civ_coast_floor']);
        if (tile.feature === 'ice') out.push([x, SEA_Y, z, 'ice']);
        continue;
      }
      let h = 1;
      if (tile.elevation === 'hills') h = 1 + Math.round(2.6 * Math.pow(1 - d, 0.8) + hash(x, z) * 0.5);
      else if (tile.elevation === 'mountain') h = 1 + Math.round((tile.height + 1) * Math.pow(1 - d, 1.1) + hash(x, z) * 1.5);
      let y = SEA_Y + h;
      let cap = TOP[tile.terrain] ?? 'civ_grass';
      if (tile.elevation === 'mountain') cap = y >= SEA_Y + 6 ? 'civ_snow' : 'civ_rock';
      // Rock showing through on a hill's crown; old snow lying in patches on the tundra.
      else if (tile.elevation === 'hills' && h >= 4 && hash(x, z, 5) < 0.35) cap = 'civ_rock';
      else if (tile.terrain === 'tundra' && hash(x >> 1, z >> 1, 7) < 0.1) cap = 'civ_snow';
      if (tile.feature === 'floodplains') cap = 'civ_floodplain';
      if (tile.feature === 'marsh') cap = hash(x, z, 1) < 0.38 ? 'water' : 'civ_marsh';
      // What the world has done to it (`rules/disasters.ts`, `rules/climate.ts`): dark rich soil where
      // ash or silt has fallen; the sea standing in pools on land it's flooded; a volcano's crater
      // glowing at its peak, its slopes ash.
      else if (tile.flooded) cap = hash(x, z, 2) < 0.45 ? 'water' : 'civ_silt';
      else if (tile.soil && tile.feature !== 'floodplains' && tile.elevation !== 'mountain') cap = 'civ_loam';
      if (tile.volcano && tile.elevation === 'mountain') {
        if (d < 0.2) {
          y -= 1;
          cap = 'civ_magma';
        } else cap = y >= SEA_Y + 5 ? 'civ_ashrock' : 'civ_rock';
      }
      land.set(key(x, z), { x, z, t, d, y, cap });
    }
  // Rivers: a channel two blocks wide through each river tile, a block down into the land, its banks
  // of silt (flood plains are their own). The channels make a tree (`riverLinks`), each tile's running
  // between the edges its river comes in and goes out by, kept off its middle (`riverCourse`).
  const channel = new Set<Column>();
  const riverbed = (x: number, z: number) => {
    const col = land.get(key(x, z));
    return col && col.cap !== 'civ_rock' && col.cap !== 'civ_snow' ? col : undefined;
  };
  for (const [t, links] of riverLinks(g, tiles)) for (const col of riverCourse(g, tiles, t, links, riverbed)) channel.add(col);
  for (const col of channel)
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const bank = land.get(key(col.x + dx, col.z + dz));
      if (bank && !channel.has(bank) && bank.cap !== 'water' && bank.cap !== 'civ_floodplain' && tiles[bank.t].elevation !== 'mountain') bank.cap = 'civ_bank';
    }
  for (const col of land.values()) {
    const { x, z } = col;
    const rock = tiles[col.t].elevation === 'mountain';
    if (channel.has(col)) {
      col.y -= 1;
      col.cap = 'water';
    }
    for (let yy = SEA_Y; yy < col.y; yy++) out.push([x, yy, z, rock ? 'civ_rock' : 'civ_dirt']);
    out.push([x, col.y, z, col.cap]);
  }
  // The land's details (away from each tile's middle, kept clear for the units and towns on it):
  // grass and dry grass, reeds in the marsh, ferns under the jungle, dunes, boulders on the hills.
  for (const col of land.values()) {
    const tile = tiles[col.t];
    if (col.d < 0.3 || channel.has(col)) continue;
    const { x, z, y, cap } = col;
    const roll = hash(x, z, 8);
    if (cap === 'civ_marsh' && roll < 0.4) out.push([x, y + 1, z, 'civ_reeds']);
    else if (tile.feature === 'jungle' && roll < 0.14) out.push([x, y + 1, z, 'civ_fern']);
    else if (tile.feature === 'forest' || tile.feature === 'jungle') continue;
    else if (cap === 'civ_grass' && roll < 0.07) out.push([x, y + 1, z, 'civ_tuft']);
    else if (cap === 'civ_plains' && roll < 0.05) out.push([x, y + 1, z, 'civ_drygrass']);
    else if (cap === 'civ_desert' && !tile.river && !tile.feature && col.d > 0.4 && dune(x, z, period(g))) {
      out.push([x, y + 1, z, 'civ_desert']);
      col.y += 1;
    } else if (tile.elevation === 'hills' && y === SEA_Y + 3 && roll < 0.06) {
      out.push([x, y + 1, z, 'civ_rock']);
      col.y += 1;
    }
  }
  // Trees and the oasis (a wide clearing round each natural wonder, so it stands clear of the woods).
  const wonders = tiles.flatMap((tile, t) => (tile.wonder ? [centre(g, t)] : []));
  const clearing = (x: number, z: number) => wonders.some((w) => Math.hypot(x + 0.5 - nearX(g, w.x, x + 0.5), z + 0.5 - w.z) < 8.5);
  /** The ground a tree can stand on at a column (its top; not in a river), or undefined. */
  const ground = (x: number, z: number) => {
    const col = land.get(key(x, z));
    return col && !channel.has(col) && !clearing(x, z) ? col.y : undefined;
  };
  for (let t = 0; t < tiles.length; t++) {
    const tile = tiles[t];
    const f = tile.feature;
    if (f !== 'forest' && f !== 'jungle' && f !== 'oasis') continue;
    const c = centre(g, t);
    if (f === 'oasis') {
      const cx = Math.floor(c.x);
      const cz = Math.floor(c.z);
      for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const y = ground(cx + dx, cz + dz);
        if (y !== undefined) out.push([cx + dx, y, cz + dz, 'water']);
      }
      tree(out, ground, cx + 2, cz, 'civ_jungle', 3);
      continue;
    }
    const pines = f === 'forest' && (tile.terrain === 'tundra' || tile.terrain === 'snow');
    // Four trees round the tile's edge (its middle kept clear for the units and towns on it).
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + hash(t, i) * 0.9;
      const r = 2.7 + hash(t, i, 2) * 0.4;
      const x = Math.floor(c.x + Math.cos(a) * r);
      const z = Math.floor(c.z + Math.sin(a) * r);
      if (f === 'jungle') jungleTree(out, ground, x, z, hash(t, i, 3));
      else tree(out, ground, x, z, pines ? 'civ_pine' : 'civ_leaves', pines ? 2 : 1);
    }
  }
  // The natural wonders: each built once over its tile or tiles (a pair's from its land tile, or else its northern one).
  const sea = (x: number, z: number) => {
    const n = tileAt(g, x + 0.5, z + 0.5);
    return n >= 0 && !!TERRAINS[tiles[n].terrain].water;
  };
  const built = new Set<string>();
  for (let t = 0; t < tiles.length; t++) {
    const id = tiles[t].wonder;
    if (!id || built.has(id)) continue;
    built.add(id);
    const water = (n: number) => (TERRAINS[tiles[n].terrain].water ? 1 : 0);
    const [first, second] = tiles.flatMap((tile, n) => (tile.wonder === id ? [n] : [])).sort((a, b) => water(a) - water(b) || a - b);
    const c = centre(g, first);
    const p = second === undefined ? undefined : centreNear(g, second, c.x);
    const own = (x: number, z: number) => tiles[tileAt(g, x + 0.5, z + 0.5)]?.wonder === id;
    landmark(id, { cx: c.x, cz: c.z, pair: p && { cx: p.x, cz: p.z }, cap: TOP[tiles[first].terrain] ?? 'civ_grass', own, sea }, (x, y, z, block) => out.push([x, y, z, block]));
  }
  // (Round a world that wraps, what was built over its seam goes in on the other side.)
  if (g.wrap) for (const e of out) e[0] = baseX(g, e[0]);
  return out;
}

/** Trees' blocks (with their seasons' looks, `seasons.ts`), and the ferns under a jungle's (a city's founding, or the woods cut down, clears them from a tile). */
export const TREE_BLOCKS = new Set(['civ_trunk', 'civ_leaves', 'civ_pine', 'civ_jungle', 'civ_fern', 'civ_leaves_autumn', 'civ_leaves_snow', 'civ_pine_snow']);

/** The ground a tree can stand on at a column (its top), or undefined (none: off the land, in a river). */
type Ground = (x: number, z: number) => number | undefined;

/** A little tree: a trunk and a blob of leaves (a cone, for pines). */
function tree(out: Edit[], ground: Ground, x: number, z: number, leaves: string, trunk: number) {
  const base = ground(x, z);
  if (base === undefined) return;
  for (let i = 1; i <= trunk; i++) out.push([x, base + i, z, 'civ_trunk']);
  const y = base + trunk + 1;
  const pine = leaves === 'civ_pine';
  out.push([x, y, z, leaves]);
  out.push([x, y + 1, z, leaves]);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    out.push([x + dx, y - (pine ? 1 : 0), z + dz, leaves]);
    if (!pine) out.push([x + dx, y + 1, z + dz, leaves]);
  }
  if (!pine) for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) out.push([x + dx, y, z + dz, leaves]);
  if (pine) out.push([x, y + 2, z, leaves]);
}

/** A jungle tree: a tall trunk under a flat crown spreading out a block more on a side or two, a little crown over it, creepers hanging from its rim (`roll`: which sides). */
function jungleTree(out: Edit[], ground: Ground, x: number, z: number, roll: number) {
  const base = ground(x, z);
  if (base === undefined) return;
  for (let i = 1; i <= 3; i++) out.push([x, base + i, z, 'civ_trunk']);
  const y = base + 4;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) out.push([x + dx, y, z + dz, 'civ_jungle']);
  for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) out.push([x + dx, y + 1, z + dz, 'civ_jungle']);
  const sides: [number, number][] = [[2, 0], [-2, 0], [0, 2], [0, -2]];
  for (let i = 0; i < 4; i++) {
    if (!((roll * 16) & (1 << i))) continue;
    const [dx, dz] = sides[i];
    out.push([x + dx, y, z + dz, 'civ_jungle']);
    out.push([x + dx, y - 1, z + dz, 'civ_jungle']);
  }
}

/** Where the desert's dunes run: long ridges across it from west to east, gently winding (round a world that wraps, in whole waves). */
function dune(x: number, z: number, period: number): boolean {
  const wave = (f: number) => (period ? (Math.PI * 2 * Math.max(1, Math.round((period * f) / (Math.PI * 2)))) / period : f);
  const v = z / 4 + Math.sin(x * wave(0.25)) * 0.55 + Math.sin(x * wave(0.09) + 1) * 0.45;
  return v - Math.floor(v) < 0.25;
}
