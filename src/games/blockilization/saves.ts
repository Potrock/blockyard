/**
 * When the game's save is written (`server.ts`). A late game's save is a few hundred kilobytes,
 * and an uploaded game's room sends every write on to the server's database: written at every
 * order, a busy minute came to tens of megabytes. So what matters is saved at once (a turn's end,
 * the game begun, the last person gone), and the orders in between at most once every `every`
 * seconds: the first at once, the rest together a little later. A restart then carries on from
 * the latest turn's start at worst (and in practice from a few seconds before it stopped).
 */
export class SaveThrottle {
  /** When the last save was written (game seconds), and whether a change waits for the next. */
  private last = -Infinity;
  private waiting = false;

  constructor(private readonly every: number) {}

  /** Something changed: whether to save now (it's been long enough since the last); else it waits for `tick`. */
  changed(now: number): boolean {
    if (now - this.last >= this.every) return true;
    this.waiting = true;
    return false;
  }

  /** Each tick: whether a change that waited is due now. */
  tick(now: number): boolean {
    return this.waiting && now - this.last >= this.every;
  }

  /** Saved now, whatever the reason: nothing waits. */
  saved(now: number) {
    this.last = now;
    this.waiting = false;
  }

  /** Whether a change waits to be saved. */
  get pending(): boolean {
    return this.waiting;
  }

  /** A new match (the game's clock starts again): nothing saved yet, nothing waiting. */
  reset() {
    this.last = -Infinity;
    this.waiting = false;
  }
}

/** What a room's save is, in brief: the game's turn, and who's in it (people only), for the list of a person's saved games. */
export interface SaveNote {
  turn: number;
  seats: { key: string; name: string; civ: string | null }[];
}

/** One of a person's saved games, in another room: where (`public`, or a room's code), the turn, their civ, and who else is in it. */
export interface SavedGame {
  room: string;
  turn: number;
  civ: string | null;
  with: string[];
}

/** The part of `game.store` the notes need. */
interface Kept {
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  keys(prefix?: string): string[];
}

/** A save as `server.ts` writes it (`save:<room>`): the game, and its seats. */
interface Saved {
  game: { turn: number; over?: unknown };
  seats: { key: string; name: string; civ: string | null; bot: boolean }[];
}

/**
 * The notes of every room's save (`savenote:<room>`), kept beside the saves. A save is a few hundred
 * kilobytes and the lobby would have to read every room's to find a person's; a note is a few
 * dozen bytes. Saves are the game's, shared by all its rooms, so each lobby can list them all.
 */
const noteKey = (room: string) => `savenote:${room}`;

/** A room's save was written: its note too (none for a game that's over). */
export function noteSave(store: Kept, room: string, save: Saved) {
  if (save.game.over) return store.delete(noteKey(room));
  const note: SaveNote = { turn: save.game.turn, seats: save.seats.filter((s) => !s.bot).map((s) => ({ key: s.key, name: s.name, civ: s.civ })) };
  store.set(noteKey(room), note);
}

/** A room's save is gone (the game won, or discarded): its note too. */
export const forgetSave = (store: Kept, room: string) => store.delete(noteKey(room));

/**
 * Notes for the saves made before there were notes (read once each, then never again), and none
 * kept for a save that's gone.
 */
export function noteOldSaves(store: Kept) {
  const saved = store.keys('save:');
  for (const key of saved) {
    const room = key.slice('save:'.length);
    if (store.get(noteKey(room))) continue;
    const save = store.get<Saved>(key);
    if (save?.game && Array.isArray(save.seats)) noteSave(store, room, save);
  }
  for (const key of store.keys('savenote:')) if (!saved.includes(`save:${key.slice('savenote:'.length)}`)) store.delete(key);
}

/** The saved games a person (`who`: their seat's key) has a seat in, but for this room's own: the latest turns first. */
export function savedGames(store: Kept, who: string, here: string): SavedGame[] {
  const out: SavedGame[] = [];
  for (const key of store.keys('savenote:')) {
    const room = key.slice('savenote:'.length);
    const note = store.get<SaveNote>(key);
    const mine = note?.seats.find((s) => s.key === who);
    if (room === here || !note || !mine) continue;
    out.push({ room, turn: note.turn, civ: mine.civ, with: note.seats.filter((s) => s !== mine).map((s) => s.name) });
  }
  return out.sort((a, b) => b.turn - a.turn || a.room.localeCompare(b.room));
}

/**
 * A room's save set aside in a room of its own (`to`, a new room's code), its note with it: a new
 * game begun where a game was saved doesn't lose it. Its people find it in their list of saved
 * games, with the new room's address. Whether there was one to set aside.
 */
export function setAside(store: Kept, room: string, to: string): boolean {
  const save = store.get<Saved>(`save:${room}`);
  if (!save || save.game.over) return false;
  store.set(`save:${to}`, save);
  noteSave(store, to, save);
  store.delete(`save:${room}`);
  forgetSave(store, room);
  return true;
}

/** A new room's code: eight letters and digits, as the platform's own (`?room=`). */
export function roomCode(random = Math.random): string {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 8 }, () => abc[Math.floor(random() * abc.length)]).join('');
}
