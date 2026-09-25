import type { GameContext, Vec3 } from '@platform';

/**
 * (Copied from Call of Blocky's `nav.ts`, slabs and stairs told apart by state. The platform has no walking grid for bots, so
 * every game with bot players brings its own.)
 *
 * Where bots can walk: every cell of the map a player can stand in (solid below, two cells of
 * room), linked to its neighbours by a step, a jump (one block up) or a drop, and A* over that.
 * Built once from the world's blocks when the match starts.
 */

export interface Cell {
  x: number;
  /** Feet height (the top of the block below). */
  y: number;
  z: number;
  id: number;
  edges: { to: Cell; cost: number; jump: boolean }[];
}

const key = (x: number, y: number, z: number) => ((x + 512) * 1024 + (z + 512)) * 256 + y;

export class NavGrid {
  private cells = new Map<number, Cell>();
  readonly list: Cell[] = [];
  /** Cells by column, lowest first. */
  private columns = new Map<number, Cell[]>();

  constructor(
    private game: GameContext,
    private bounds: { min: Vec3; max: Vec3 },
  ) {}

  get size(): number {
    return this.list.length;
  }

  build() {
    const w = this.game.world;
    const info = new Map<number, { solid: boolean; step: boolean; liquid: boolean }>();
    const at = (x: number, y: number, z: number) => {
      const id = w.getBlock(x, y, z);
      let i = info.get(id);
      if (!i) {
        const b = id < 0 ? null : w.blockInfo(id);
        const name = b?.name ?? '';
        // A slab or stairs is walked up without a jump. (BlockInfo has no shape, so tell them by
        // their states: a slab has a `type`, stairs a `half`. Call of Blocky goes by the name,
        // which misses a game's own slabs and stairs, like the boardwalk.)
        const st = b?.state ?? {};
        i = { solid: id < 0 || !!b?.solid, step: name.endsWith('_stairs') || name.endsWith('_slab') || 'type' in st || 'half' in st, liquid: !!b?.liquid };
        info.set(id, i);
      }
      return i;
    };
    const { min, max } = this.bounds;
    const x0 = Math.floor(min.x);
    const x1 = Math.ceil(max.x);
    const z0 = Math.floor(min.z);
    const z1 = Math.ceil(max.z);
    const y0 = Math.floor(min.y) + 1;
    const y1 = Math.ceil(max.y);
    let id = 0;
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++)
        for (let y = y0; y <= y1; y++) {
          const below = at(x, y - 1, z);
          if (!below.solid || at(x, y, z).solid || at(x, y + 1, z).solid) continue;
          const c: Cell = { x, y, z, id: id++, edges: [] };
          this.cells.set(key(x, y, z), c);
          this.list.push(c);
          const col = (x + 512) * 1024 + (z + 512);
          let list = this.columns.get(col);
          if (!list) this.columns.set(col, (list = []));
          list.push(c);
        }
    const free = (x: number, y: number, z: number) => !at(x, y, z).solid && !at(x, y + 1, z).solid;
    for (const c of this.list) {
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) {
          if (!dx && !dz) continue;
          // Diagonals only where both sides are open (no cutting corners).
          if (dx && dz && !(free(c.x + dx, c.y, c.z) && free(c.x, c.y, c.z + dz))) continue;
          for (let dy = 1; dy >= -3; dy--) {
            const n = this.cells.get(key(c.x + dx, c.y + dy, c.z + dz));
            if (!n) continue;
            // Up a block: a step (stairs, slabs) or a jump (room overhead).
            let jump = false;
            if (dy === 1) {
              const step = at(n.x, n.y - 1, n.z).step;
              if (!step) {
                if (at(c.x, c.y + 2, c.z).solid) break;
                jump = true;
              }
            }
            // Down: nothing in the way above the lower cell.
            if (dy < 0 && at(n.x, c.y, n.z).solid) break;
            const d = Math.hypot(dx, dz, dy * 0.5);
            c.edges.push({ to: n, cost: d + (jump ? 0.8 : 0) + (dy < -1 ? 0.5 : 0) + (at(n.x, n.y, n.z).liquid ? 3 : 0), jump });
            break;
          }
        }
    }
  }

  /** The cell someone standing at `p` is in (or the nearest one near it). */
  cellAt(p: Vec3): Cell | null {
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    const y = Math.round(p.y);
    for (const dy of [0, 1, -1, 2, -2]) {
      const c = this.cells.get(key(x, y + dy, z));
      if (c) return c;
    }
    let best: Cell | null = null;
    let bd = 9;
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        for (const c of this.columns.get((x + dx + 512) * 1024 + (z + dz + 512)) ?? []) {
          const d = Math.abs(c.x + 0.5 - p.x) + Math.abs(c.z + 0.5 - p.z) + Math.abs(c.y - p.y) * 2;
          if (d < bd) {
            bd = d;
            best = c;
          }
        }
      }
    return best;
  }

  random(rnd: () => number): Cell | null {
    return this.list.length ? this.list[Math.floor(rnd() * this.list.length)] : null;
  }

  /** A* from one point to another: the cells to walk through (not including the start), or null. */
  path(from: Vec3, to: Vec3, limit = 6000): Cell[] | null {
    const a = this.cellAt(from);
    const b = this.cellAt(to);
    if (!a || !b) return null;
    if (a === b) return [b];
    const g = new Map<number, number>([[a.id, 0]]);
    const came = new Map<number, Cell>();
    const h = (c: Cell) => Math.hypot(c.x - b.x, c.z - b.z, (c.y - b.y) * 0.7);
    const open = new Heap();
    open.push(a, h(a));
    const closed = new Set<number>();
    let n = 0;
    while (open.size && n++ < limit) {
      const c = open.pop()!;
      if (c === b) {
        const out: Cell[] = [];
        for (let k: Cell | undefined = b; k && k !== a; k = came.get(k.id)) out.push(k);
        return out.reverse();
      }
      if (closed.has(c.id)) continue;
      closed.add(c.id);
      const gc = g.get(c.id)!;
      for (const e of c.edges) {
        const t = gc + e.cost;
        if (t < (g.get(e.to.id) ?? Infinity)) {
          g.set(e.to.id, t);
          came.set(e.to.id, c);
          open.push(e.to, t + h(e.to));
        }
      }
    }
    return null;
  }

  /** Whether stepping from one cell to the next needs a jump. */
  needsJump(a: Cell, b: Cell): boolean {
    return a.edges.some((e) => e.to === b && e.jump);
  }
}

/** A binary min-heap of cells by priority. */
class Heap {
  private items: { c: Cell; p: number }[] = [];
  get size() {
    return this.items.length;
  }
  push(c: Cell, p: number) {
    const a = this.items;
    a.push({ c, p });
    let i = a.length - 1;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (a[j].p <= a[i].p) break;
      [a[i], a[j]] = [a[j], a[i]];
      i = j;
    }
  }
  pop(): Cell | undefined {
    const a = this.items;
    if (!a.length) return undefined;
    const top = a[0].c;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].p < a[m].p) m = l;
        if (r < a.length && a[r].p < a[m].p) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}
