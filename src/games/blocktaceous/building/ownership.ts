import type { StoreApi } from '@platform';

/**
 * Who placed each structure block: kept in `game.store`, one key per 16 x 16 column of the world
 * that has any (`bt.own:<cx>,<cz>`), so a change saves one small record rather than the whole map.
 * A column's record names its owners once and then lists cells as pairs of numbers:
 * `{ o: ['a:123', …], c: [cell, ownerIndex, cell, ownerIndex, …] }`, a cell being
 * `y * 256 + localX * 16 + localZ`. Owners' names (for "built by Ann") are in `bt.owners`.
 *
 * It's bounded by each owner's limit (`LIMIT` blocks), which the rules enforce when placing.
 */
export const LIMIT = 2500;

const PREFIX = 'bt.own:';
const NAMES = 'bt.owners';

interface Saved {
  o: string[];
  c: number[];
}

const columnOf = (x: number, z: number) => `${x >> 4},${z >> 4}`;
const cellOf = (x: number, y: number, z: number) => y * 256 + (x & 15) * 16 + (z & 15);

export class Ownership {
  private columns = new Map<string, Map<number, string>>();
  private dirty = new Set<string>();
  private counts = new Map<string, number>();
  private names: Record<string, string> = {};
  private namesDirty = false;

  constructor(private store: StoreApi) {}

  /** Read everything kept (at `start`): what was in memory is dropped. */
  load(): void {
    this.columns.clear();
    this.dirty.clear();
    this.counts.clear();
    this.names = this.store.get<Record<string, string>>(NAMES) ?? {};
    this.namesDirty = false;
    for (const key of this.store.keys(PREFIX)) {
      const saved = this.store.get<Saved>(key);
      if (!saved || !Array.isArray(saved.o) || !Array.isArray(saved.c)) continue;
      const cells = new Map<number, string>();
      for (let i = 0; i + 1 < saved.c.length; i += 2) {
        const owner = saved.o[saved.c[i + 1]];
        if (typeof owner !== 'string') continue;
        cells.set(saved.c[i], owner);
        this.counts.set(owner, (this.counts.get(owner) ?? 0) + 1);
      }
      if (cells.size) this.columns.set(key.slice(PREFIX.length), cells);
    }
  }

  /** Write the columns that changed since the last call (the rules call it every few seconds). */
  flush(): void {
    for (const column of this.dirty) {
      const cells = this.columns.get(column);
      if (!cells || cells.size === 0) {
        this.columns.delete(column);
        this.store.delete(PREFIX + column);
        continue;
      }
      const o: string[] = [];
      const index = new Map<string, number>();
      const c: number[] = [];
      for (const [cell, owner] of cells) {
        let i = index.get(owner);
        if (i === undefined) index.set(owner, (i = o.push(owner) - 1));
        c.push(cell, i);
      }
      this.store.set(PREFIX + column, { o, c } satisfies Saved);
    }
    this.dirty.clear();
    if (this.namesDirty) this.store.set(NAMES, this.names);
    this.namesDirty = false;
  }

  ownerOf(x: number, y: number, z: number): string | null {
    return this.columns.get(columnOf(x, z))?.get(cellOf(x, y, z)) ?? null;
  }

  /** The name an owner had when they last built. */
  nameOf(owner: string): string {
    return this.names[owner] ?? 'someone';
  }

  /** How many structure blocks an owner has standing. */
  countOf(owner: string): number {
    return this.counts.get(owner) ?? 0;
  }

  claim(x: number, y: number, z: number, owner: string, name: string): void {
    const column = columnOf(x, z);
    let cells = this.columns.get(column);
    if (!cells) this.columns.set(column, (cells = new Map()));
    const cell = cellOf(x, y, z);
    const was = cells.get(cell);
    if (was === owner) return;
    if (was) this.counts.set(was, Math.max(0, this.countOf(was) - 1));
    cells.set(cell, owner);
    this.counts.set(owner, this.countOf(owner) + 1);
    this.dirty.add(column);
    if (this.names[owner] !== name) {
      this.names[owner] = name;
      this.namesDirty = true;
    }
  }

  release(x: number, y: number, z: number): void {
    const column = columnOf(x, z);
    const cells = this.columns.get(column);
    const cell = cellOf(x, y, z);
    const was = cells?.get(cell);
    if (!cells || !was) return;
    cells.delete(cell);
    this.counts.set(was, Math.max(0, this.countOf(was) - 1));
    this.dirty.add(column);
  }

  /**
   * Everything the owners `gone` says yes to becomes nobody's (a guest who has left: their key
   * will be handed to the next guest, who mustn't inherit their walls). Returns how many cells.
   */
  releaseOwners(gone: (owner: string) => boolean): number {
    let n = 0;
    for (const [column, cells] of this.columns) {
      for (const [cell, owner] of cells) {
        if (!gone(owner)) continue;
        cells.delete(cell);
        n++;
        this.dirty.add(column);
      }
    }
    for (const owner of [...this.counts.keys()]) if (gone(owner)) this.counts.delete(owner);
    return n;
  }

  /**
   * The owner of a structure block within `reach` cells of a cell (in a cube round it) for whom
   * `foreign` says yes, or null: who a builder would be crowding. Columns with nothing built are
   * skipped whole, so out in the wild it costs a few map lookups.
   */
  near(x: number, y: number, z: number, reach: number, foreign?: (owner: string) => boolean): string | null {
    for (let cx = (x - reach) >> 4; cx <= (x + reach) >> 4; cx++) {
      for (let cz = (z - reach) >> 4; cz <= (z + reach) >> 4; cz++) {
        const cells = this.columns.get(`${cx},${cz}`);
        if (!cells || cells.size === 0) continue;
        for (const [cell, owner] of cells) {
          const bx = cx * 16 + ((cell >> 4) & 15);
          const bz = cz * 16 + (cell & 15);
          const by = cell >> 8;
          if (Math.abs(bx - x) > reach || Math.abs(by - y) > reach || Math.abs(bz - z) > reach) continue;
          if (!foreign || foreign(owner)) return owner;
        }
      }
    }
    return null;
  }
}
