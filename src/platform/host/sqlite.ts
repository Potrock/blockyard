import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SavedPlayer, SavedWorld, Store } from './store';

/**
 * A game server's store: one SQLite file per server (Node's built-in `node:sqlite`). The world,
 * players by name, and the game's `game.store` data. Changes to the game's data are kept in
 * memory and written in one transaction on `flush` (the server flushes every few seconds and when
 * it stops), so a game setting values every tick costs nothing.
 */
export class SqliteStore implements Store {
  private db: DatabaseSync;
  private values = new Map<string, unknown>();
  private dirty = new Map<string, unknown>();

  private constructor(
    path: string,
    private game: string,
  ) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS world (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        game TEXT NOT NULL,
        seed INTEGER NOT NULL,
        edits BLOB,
        time REAL NOT NULL DEFAULT 0.3,
        created TEXT NOT NULL DEFAULT (datetime('now')),
        saved TEXT
      );
      CREATE TABLE IF NOT EXISTS players (
        name TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        seen TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    for (const row of this.db.prepare('SELECT key, value FROM kv').all() as { key: string; value: string }[]) this.values.set(row.key, JSON.parse(row.value));
  }

  /** Open (or create) a server's database. It belongs to one game: opening it for another fails. */
  static open(path: string, game: string): SqliteStore {
    const s = new SqliteStore(path, game);
    const w = s.world();
    if (w && w.game !== game) {
      s.close();
      throw new Error(`${path} holds a ${w.game} world, not ${game}: use another --db`);
    }
    return s;
  }

  world(): SavedWorld | null {
    const row = this.db.prepare('SELECT game, seed, edits, time FROM world WHERE id = 1').get() as { game: string; seed: number; edits: Uint8Array | null; time: number } | undefined;
    return row ? { game: row.game, seed: row.seed >>> 0, edits: row.edits ? new Uint8Array(row.edits) : null, time: row.time } : null;
  }

  saveWorld(w: SavedWorld) {
    this.db
      .prepare(
        `INSERT INTO world (id, game, seed, edits, time, saved) VALUES (1, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT (id) DO UPDATE SET seed = excluded.seed, edits = excluded.edits, time = excluded.time, saved = excluded.saved`,
      )
      .run(this.game, w.seed, w.edits, w.time);
  }

  player(name: string): SavedPlayer | null {
    const row = this.db.prepare('SELECT state FROM players WHERE name = ?').get(name) as { state: string } | undefined;
    return row ? (JSON.parse(row.state) as SavedPlayer) : null;
  }

  savePlayer(name: string, p: SavedPlayer) {
    this.db.prepare(`INSERT INTO players (name, state, seen) VALUES (?, ?, datetime('now')) ON CONFLICT (name) DO UPDATE SET state = excluded.state, seen = excluded.seen`).run(name, JSON.stringify(p));
  }

  data() {
    return this.values;
  }

  put(key: string, value: unknown) {
    this.dirty.set(key, value);
  }

  flush() {
    if (!this.dirty.size) return;
    const set = this.db.prepare(`INSERT INTO kv (key, value, updated) VALUES (?, ?, datetime('now')) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated = excluded.updated`);
    const del = this.db.prepare('DELETE FROM kv WHERE key = ?');
    this.db.exec('BEGIN');
    try {
      for (const [k, v] of this.dirty) {
        if (v === undefined) del.run(k);
        else set.run(k, JSON.stringify(v));
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    this.dirty.clear();
  }

  close() {
    this.flush();
    this.db.close();
  }
}
