/**
 * The hex grid: pointy-topped hexes in rows, every other row pushed half a hex to the right ("odd-r"
 * offset coordinates, as Civilization V lays its map out). A tile is its index in the map's array
 * (`row * width + col`); the maths works in cube coordinates underneath. A world that wraps (Civ V's)
 * goes on round from its east edge to its west: the last column's east neighbour is the first, and
 * every distance, line and way is the shorter way round. North and south are edges.
 */

export interface Grid {
  width: number;
  height: number;
  /** The columns wrap round east to west (a new game's world; one saved without it is flat). */
  wrap?: boolean;
}

/** A tile's column and row from its index. */
export const colOf = (g: Grid, t: number) => t % g.width;
export const rowOf = (g: Grid, t: number) => Math.floor(t / g.width);
/** The tile at a column and row (-1 off the map: a column off either side is round the other on a world that wraps). */
export function tileAt(g: Grid, col: number, row: number): number {
  if (row < 0 || row >= g.height) return -1;
  if (col < 0 || col >= g.width) {
    if (!g.wrap) return -1;
    col = ((col % g.width) + g.width) % g.width;
  }
  return row * g.width + col;
}

/** Cube coordinates of a tile (q + r + s = 0). */
export function cube(g: Grid, t: number): [number, number, number] {
  const col = colOf(g, t);
  const row = rowOf(g, t);
  const q = col - (row - (row & 1)) / 2;
  return [q, row, -q - row];
}

/** The tile at cube coordinates (-1 off the map). */
export function fromCube(g: Grid, q: number, r: number): number {
  const col = q + (r - (r & 1)) / 2;
  return tileAt(g, col, r);
}

/** The six directions, in cube steps: east, north-east, north-west, west, south-west, south-east (rows grow to the south). */
const DIRS: [number, number][] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

/** The neighbour in direction `d` (0..5, as `DIRS`), or -1 off the map. */
export function neighbour(g: Grid, t: number, d: number): number {
  const [q, r] = cube(g, t);
  const [dq, dr] = DIRS[d];
  return fromCube(g, q + dq, r + dr);
}

/** Each grid's neighbours, worked out once: six to a tile, in direction order (-1 off the map). */
const neighbourTables = new WeakMap<Grid, Int32Array>();

/** A tile's neighbours on the map (up to six), in direction order. */
export function neighbours(g: Grid, t: number): number[] {
  let table = neighbourTables.get(g);
  if (!table || table.length !== g.width * g.height * 6) {
    table = new Int32Array(g.width * g.height * 6);
    for (let x = 0; x < g.width * g.height; x++) for (let d = 0; d < 6; d++) table[x * 6 + d] = neighbour(g, x, d);
    neighbourTables.set(g, table);
  }
  const out: number[] = [];
  for (let d = 0; d < 6; d++) {
    const n = table[t * 6 + d];
    if (n >= 0) out.push(n);
  }
  return out;
}

/** Steps between two tiles (in cube coordinates, worked out in place: it's asked very often). */
export function distance(g: Grid, a: number, b: number): number {
  const w = g.width;
  const ar = Math.floor(a / w);
  const br = Math.floor(b / w);
  let dq = (a % w) - (ar - (ar & 1)) / 2 - ((b % w) - (br - (br & 1)) / 2);
  const dr = ar - br;
  // Round the world, the shorter way: the steps grow with how far apart they are across (dq + dr / 2,
  // the columns between them), so that's brought within half the world's width.
  if (g.wrap) {
    const apart = dq + dr / 2;
    if (apart > w / 2) dq -= w;
    else if (apart < -w / 2) dq += w;
  }
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

/** The direction from a tile to a neighbour (-1 if they aren't neighbours). */
export function directionTo(g: Grid, from: number, to: number): number {
  for (let d = 0; d < 6; d++) if (neighbour(g, from, d) === to) return d;
  return -1;
}

/** Every tile within `radius` steps of `t` (itself included), nearest first. */
export function within(g: Grid, t: number, radius: number): number[] {
  const out: number[] = [t];
  for (let k = 1; k <= radius; k++) out.push(...ring(g, t, k));
  return out;
}

/** The tiles exactly `radius` steps from `t`. */
export function ring(g: Grid, t: number, radius: number): number[] {
  if (radius <= 0) return [t];
  // (A ring as wide as the world meets itself round the back: each tile once, at its real distance.)
  if (g.wrap && radius * 2 >= g.width) return [...new Set(walkRing(g, t, radius))].filter((n) => distance(g, t, n) === radius);
  return walkRing(g, t, radius);
}

/** A ring's tiles as its six sides are walked (round the world, each side as it comes). */
function walkRing(g: Grid, t: number, radius: number): number[] {
  const [q0, r0] = cube(g, t);
  const out: number[] = [];
  // Start `radius` steps south-west (direction 4), then walk each of the six sides.
  let q = q0 + DIRS[4][0] * radius;
  let r = r0 + DIRS[4][1] * radius;
  for (let side = 0; side < 6; side++)
    for (let i = 0; i < radius; i++) {
      const n = fromCube(g, q, r);
      if (n >= 0) out.push(n);
      q += DIRS[side][0];
      r += DIRS[side][1];
    }
  return out;
}

/** The tiles on a straight line between two tiles (both ends included): round the world the shorter way. */
export function line(g: Grid, a: number, b: number): number[] {
  const n = distance(g, a, b);
  const [aq, ar, as] = cube(g, a);
  let [bq, br, bs] = cube(g, b);
  // (The copy of b round the world nearest a, as `distance` takes it.)
  if (g.wrap) {
    const apart = bq - aq + (br - ar) / 2;
    const k = apart > g.width / 2 ? -1 : apart < -g.width / 2 ? 1 : 0;
    bq += k * g.width;
    bs -= k * g.width;
  }
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const k = n === 0 ? 0 : i / n;
    // A nudge so ties fall the same way every time.
    const [q, r] = roundCube(aq + (bq - aq) * k + 1e-6, ar + (br - ar) * k + 2e-6, as + (bs - as) * k - 3e-6);
    const t = fromCube(g, q, r);
    if (t >= 0 && out[out.length - 1] !== t) out.push(t);
  }
  return out;
}

/** The nearest whole cube coordinates. */
export function roundCube(q: number, r: number, s: number): [number, number, number] {
  let rq = Math.round(q);
  let rr = Math.round(r);
  let rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  else rs = -rq - rr;
  return [rq, rr, rs];
}

/** A binary heap of values by priority, least first (ties: the first pushed first). */
function heapOf() {
  // (Three arrays side by side, not a tuple a node: the order is the same, by priority then by what came first.)
  const pri: number[] = [];
  const ord: number[] = [];
  const val: number[] = [];
  let added = 0;
  const before = (i: number, j: number) => pri[i] < pri[j] || (pri[i] === pri[j] && ord[i] < ord[j]);
  const swap = (i: number, j: number) => {
    let x = pri[i];
    pri[i] = pri[j];
    pri[j] = x;
    x = ord[i];
    ord[i] = ord[j];
    ord[j] = x;
    x = val[i];
    val[i] = val[j];
    val[j] = x;
  };
  return {
    get size() {
      return pri.length;
    },
    push(priority: number, value: number) {
      pri.push(priority);
      ord.push(added++);
      val.push(value);
      for (let i = pri.length - 1; i > 0; ) {
        const up = (i - 1) >> 1;
        if (!before(i, up)) break;
        swap(i, up);
        i = up;
      }
    },
    pop(): number {
      const top = val[0];
      const lp = pri.pop()!;
      const lo = ord.pop()!;
      const lv = val.pop()!;
      if (pri.length) {
        pri[0] = lp;
        ord[0] = lo;
        val[0] = lv;
        for (let i = 0; ; ) {
          const l = i * 2 + 1;
          const r = l + 1;
          let m = i;
          if (l < pri.length && before(l, m)) m = l;
          if (r < pri.length && before(r, m)) m = r;
          if (m === i) break;
          swap(i, m);
          i = m;
        }
      }
      return top;
    },
  };
}

/** `path`'s working memory, kept between searches (a search's marks told apart by its number). */
const scratch = { spent: new Float64Array(0), came: new Int32Array(0), mark: new Uint32Array(0), search: 0 };

/**
 * The cheapest way from `from` to `to` (A*): `cost(a, b)` is what stepping from a to its neighbour b
 * costs (Infinity: can't). Returns the tiles after `from`, up to and including `to`, or null.
 */
export function path(g: Grid, from: number, to: number, cost: (a: number, b: number) => number, limit = 4000): number[] | null {
  if (from === to) return [];
  const size = g.width * g.height;
  if (scratch.mark.length < size) Object.assign(scratch, { spent: new Float64Array(size), came: new Int32Array(size), mark: new Uint32Array(size), search: 0 });
  const { spent, came, mark } = scratch;
  const search = ++scratch.search;
  const spentOn = (t: number) => (mark[t] === search ? spent[t] : Infinity);
  const open = heapOf();
  open.push(0, from);
  mark[from] = search;
  spent[from] = 0;
  let visited = 0;
  while (open.size && visited++ < limit) {
    const t = open.pop();
    if (t === to) {
      const out: number[] = [];
      for (let c = to; c !== from; c = came[c]) out.push(c);
      return out.reverse();
    }
    for (const n of neighbours(g, t)) {
      const step = cost(t, n);
      if (!Number.isFinite(step)) continue;
      const total = spent[t] + step;
      if (total < spentOn(n)) {
        mark[n] = search;
        spent[n] = total;
        came[n] = t;
        open.push(total + distance(g, n, to), n);
      }
    }
  }
  return null;
}

/** A step that takes every move left (embarking, disembarking, crossing a river without a bridge). */
export const ALL = 1e9;

/** A mover, as `findWay` needs to know it: what its steps cost, where it may pass and stop, its moves. */
export interface Walker {
  /** The moves a step from a to its neighbour b costs (ALL: every move it has left; Infinity: it can't). */
  cost(a: number, b: number): number;
  /** Whether it may go through b on its way (its own side's units don't bar it). */
  pass(b: number): boolean;
  /** Whether it may end this turn on b (one unit of each kind to a tile). */
  stop(b: number): boolean;
  /** Whether b is held by one of its own that stays there (fortified, asleep, at work): not to end a later turn on either. */
  held?(b: number): boolean;
  /** What stepping onto b costs a plan on top of its moves (the danger there). */
  risk?(b: number): number;
  /** Whether a step from a to b ends its move (from one zone of control into another). */
  halts?(a: number, b: number): boolean;
  /** Its moves a turn, and those it has left now (none: it goes on next turn). */
  full: number;
  left: number;
}

/**
 * A mover's way from `from` to `to`, turn by turn (Civ V's): any step can be taken with moves left,
 * however few (it takes what's left); this turn may only end where it can stop, so where the next
 * step would end it on one of its own it waits short of it instead (the moves it doesn't use count as
 * spent). Later turns may end wherever it may pass, but not where its own stay put: the others will
 * mostly have moved on by then, and if not it finds a way as it comes to them. The cheapest in moves
 * (waits included) and danger; the tiles after `from`, each with the turn it's reached on (0: this
 * one), or null.
 */
export function findWay(g: Grid, from: number, to: number, w: Walker, limit = 20000): { tiles: number[]; turns: number[] } | null {
  if (from === to) return { tiles: [], turns: [] };
  // A state: a tile, the moves left there (in sixtieths: roads and railroads cost fractions), and
  // whether it's this turn (where it may stop matters) or a later one.
  const Q = 60;
  const startTurn = w.left > 0 ? 0 : 1;
  const key = (t: number, left: number, turn: number) => (t * 1024 + Math.round(left * Q)) * 2 + (turn > startTurn ? 1 : 0);
  const tileOf = (k: number) => Math.floor(k / 2048);
  const leftOf = (k: number) => (Math.floor(k / 2) % 1024) / Q;
  const start = key(from, w.left > 0 ? w.left : w.full, startTurn);
  const turn = new Map<number, number>([[start, startTurn]]);
  const spent = new Map<number, number>([[start, 0]]);
  // How each state was reached: the state before, and whether by a step (else by waiting).
  const came = new Map<number, { from: number; step: boolean }>();
  const open = heapOf();
  open.push(0, start);
  const reach = (k: number, from: number, cost: number, t: number, step: boolean) => {
    if (cost >= (spent.get(k) ?? Infinity)) return;
    spent.set(k, cost);
    turn.set(k, t);
    came.set(k, { from, step });
    open.push(cost + distance(g, tileOf(k), to), k);
  };
  let visited = 0;
  while (open.size && visited++ < limit) {
    const k = open.pop();
    const t = tileOf(k);
    const left = leftOf(k);
    const now = turn.get(k)!;
    const so = spent.get(k)!;
    if (t === to) {
      const tiles: number[] = [];
      const turns: number[] = [];
      for (let c = k; c !== start; ) {
        const how = came.get(c)!;
        if (how.step) {
          tiles.push(tileOf(c));
          // (Reached in the turn it set out in, though that turn ends on it.)
          turns.push(turn.get(how.from)!);
        }
        c = how.from;
      }
      return { tiles: tiles.reverse(), turns: turns.reverse() };
    }
    // (Where it may end this turn; later ones, anywhere it may pass.)
    const stops = (n: number) => (now > startTurn ? !w.held?.(n) : w.stop(n));
    // Waiting here for the next turn (where it may stop, with moves it hasn't used; where it stands, even with all of them, for its own units ahead to move on).
    if ((left < w.full || (t === from && now === startTurn)) && (t === from || stops(t))) reach(key(t, w.full, now + 1), k, so + left, now + 1, false);
    for (const n of neighbours(g, t)) {
      const c = w.cost(t, n);
      if (!Number.isFinite(c) || (n !== to && !w.pass(n))) continue;
      const use = c >= ALL ? left : Math.min(c, left);
      const rest = c >= ALL || w.halts?.(t, n) ? 0 : left - use;
      // (A step that takes every move left is planned as a whole turn's, as ever: a way round that
      // doesn't embark or ford is taken if it costs no more.)
      // (And a hair more for each step: of ways as cheap, the one with fewer steps, waiting rather than wandering.)
      const price = so + (c >= ALL ? w.full : use) + (w.risk?.(n) ?? 0) + 1e-3;
      if (rest > 1e-6) reach(key(n, rest, now), k, price, now, true);
      // Its turn ends there: only where it may stop (or there, at the end).
      else if (n === to || stops(n)) reach(key(n, w.full, now + 1), k, price, now + 1, true);
    }
  }
  return null;
}
