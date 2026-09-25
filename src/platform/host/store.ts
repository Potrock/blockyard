/** A kept world: its seed, and for games that keep their world (`world.persist`), its edits. */
export interface SavedWorld {
  game: string;
  seed: number;
  /** The engine's exported edits; null until first saved. */
  edits: Uint8Array | null;
  /**
   * The game's own blocks' keys when the edits were saved, in id order (from the first game block
   * id): loaded with other definitions, the edits are translated by name. Absent: none.
   */
  blocks?: string[] | null;
  /** Time of day. */
  time: number;
}

/** Where a player left off in a kept world. */
export interface SavedPlayer {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flying: boolean;
  /** Creative building's block hotbar: ids, and the game's own blocks by key (their ids can move). */
  hotbar?: (number | string)[];
}

/**
 * What a host keeps across restarts: the world, its players by name, and the game's own
 * key-value data (`game.store`). A server keeps it in SQLite (`SqliteStore`); tests and the
 * browser use `MemoryStore`.
 */
export interface Store {
  world(): SavedWorld | null;
  saveWorld(w: SavedWorld): void;
  player(name: string): SavedPlayer | null;
  savePlayer(name: string, p: SavedPlayer): void;
  /** Everything the game has put in `game.store`. */
  data(): Map<string, unknown>;
  /** A change to `game.store` (`undefined`: deleted). */
  put(key: string, value: unknown): void;
  /** Write out anything pending. */
  flush(): void;
  close(): void;
}

/**
 * A store in memory, starting from `initial` and telling `onPut` about each change to the
 * game's data (a worker passes them to its page, which keeps them in localStorage).
 */
export class MemoryStore implements Store {
  private kept: SavedWorld | null = null;
  private players = new Map<string, SavedPlayer>();
  private values: Map<string, unknown>;

  constructor(
    initial: Record<string, unknown> = {},
    private onPut?: (key: string, value: unknown) => void,
  ) {
    this.values = new Map(Object.entries(initial));
  }

  world() {
    return this.kept;
  }

  saveWorld(w: SavedWorld) {
    this.kept = { ...w, edits: w.edits && w.edits.slice() };
  }

  player(name: string) {
    return this.players.get(name) ?? null;
  }

  savePlayer(name: string, p: SavedPlayer) {
    this.players.set(name, { ...p });
  }

  data() {
    return this.values;
  }

  put(key: string, value: unknown) {
    this.onPut?.(key, value);
  }

  flush() {}

  close() {}
}
