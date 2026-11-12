import type { StoreApi, WorldApi } from '@platform';

/**
 * Harvested trees, plants and rock grow back: each harvest is remembered as a group of cells (one
 * rock; a felled tree, trunk and crown together) and put back, whole, once its time has come and
 * nobody is near to watch it pop in. Kept in `game.store` under `bt.regrow`, so a server restart
 * doesn't leave the island scarred: `{ n: names, g: [x, y, z, secondsLeft, count, (dx, dy, dz, name) * count, …] }`.
 *
 * It's bounded: at most `MAX_CELLS` cells are remembered; past that the oldest harvests are
 * forgotten (those stay harvested).
 */
export const MAX_CELLS = 20000;
/** Nothing regrows with a survivor this close. */
export const QUIET = 20;

const KEY = 'bt.regrow';

interface Group {
  x: number;
  y: number;
  z: number;
  due: number;
  /** dx, dy, dz, index into `names`, for each cell. */
  cells: number[];
}

export class Regrowth {
  private groups: Group[] = [];
  private names: string[] = [];
  private nameIndex = new Map<string, number>();
  private cells = 0;
  private dirty = false;

  constructor(private store: StoreApi) {}

  get pending(): number {
    return this.cells;
  }

  load(now: number): void {
    this.groups = [];
    this.names = [];
    this.nameIndex.clear();
    this.cells = 0;
    this.dirty = false;
    const saved = this.store.get<{ n: string[]; g: number[] }>(KEY);
    if (!saved || !Array.isArray(saved.n) || !Array.isArray(saved.g)) return;
    this.names = saved.n.slice();
    this.names.forEach((name, i) => this.nameIndex.set(name, i));
    const g = saved.g;
    for (let i = 0; i + 4 < g.length; ) {
      const count = g[i + 4];
      const cells = g.slice(i + 5, i + 5 + count * 4);
      if (cells.length === count * 4) {
        this.groups.push({ x: g[i], y: g[i + 1], z: g[i + 2], due: now + g[i + 3], cells });
        this.cells += count;
      }
      i += 5 + count * 4;
    }
  }

  /** Write it out if it changed (the rules call it now and then). */
  save(now: number): void {
    if (!this.dirty) return;
    this.dirty = false;
    if (this.groups.length === 0) {
      this.store.delete(KEY);
      return;
    }
    const g: number[] = [];
    for (const group of this.groups) g.push(group.x, group.y, group.z, Math.max(0, Math.round(group.due - now)), group.cells.length / 4, ...group.cells);
    this.store.set(KEY, { n: this.names, g });
  }

  /** Remember blocks just harvested (each by its exact variant, so a log lies as it lay), to return after `delay` seconds. */
  add(blocks: { x: number; y: number; z: number; variant: string }[], delay: number, now: number): void {
    if (blocks.length === 0) return;
    const base = blocks[0];
    const cells: number[] = [];
    for (const b of blocks) {
      let i = this.nameIndex.get(b.variant);
      if (i === undefined) this.nameIndex.set(b.variant, (i = this.names.push(b.variant) - 1));
      cells.push(b.x - base.x, b.y - base.y, b.z - base.z, i);
    }
    this.groups.push({ x: base.x, y: base.y, z: base.z, due: now + delay, cells });
    this.cells += blocks.length;
    while (this.cells > MAX_CELLS && this.groups.length > 1) this.cells -= this.groups.shift()!.cells.length / 4;
    this.dirty = true;
  }

  /** Forget whatever would have grown back in a cell (something was built there). */
  forget(x: number, y: number, z: number): void {
    for (let gi = this.groups.length - 1; gi >= 0; gi--) {
      const group = this.groups[gi];
      if (Math.abs(group.x - x) > 12 || Math.abs(group.z - z) > 12) continue;
      const c = group.cells;
      for (let i = 0; i < c.length; i += 4) {
        if (group.x + c[i] !== x || group.y + c[i + 1] !== y || group.z + c[i + 2] !== z) continue;
        c.splice(i, 4);
        this.cells--;
        this.dirty = true;
        break;
      }
      if (c.length === 0) this.groups.splice(gi, 1);
    }
  }

  /**
   * Put back what's due (at most `most` harvests a call). `quiet(x, y, z)` says nobody's near;
   * `settled(x, y, z)` that someone has built there, where nothing should ever grow through a floor.
   * Returns how many blocks came back.
   */
  update(now: number, world: WorldApi, quiet: (x: number, y: number, z: number) => boolean, settled: (x: number, y: number, z: number) => boolean, most = 6): number {
    let restored = 0;
    let done = 0;
    for (let gi = 0; gi < this.groups.length && done < most; gi++) {
      const group = this.groups[gi];
      if (group.due > now) continue;
      // Not loaded: nobody's anywhere near, but there's nothing to write to yet either.
      if (world.getBlock(group.x, group.y, group.z) < 0) continue;
      if (!quiet(group.x, group.y, group.z)) continue;
      done++;
      this.groups.splice(gi--, 1);
      this.cells -= group.cells.length / 4;
      this.dirty = true;
      if (settled(group.x, group.y, group.z)) continue;
      const c = group.cells;
      for (let i = 0; i < c.length; i += 4) {
        const x = group.x + c[i];
        const y = group.y + c[i + 1];
        const z = group.z + c[i + 2];
        const name = this.names[c[i + 3]];
        if (!name || !world.blockInfo(name)) continue;
        const there = world.blockInfo(world.getBlock(x, y, z));
        if (!there || !there.replaceable || there.liquid) continue;
        if (world.setBlock(x, y, z, name)) restored++;
      }
    }
    return restored;
  }
}
