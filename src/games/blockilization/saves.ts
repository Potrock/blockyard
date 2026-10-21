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

/**
 * Saved games belong to the people playing them, not to rooms. Each game has an id of its own and
 * is kept under it (`game:<id>`) in the game's store: the server's database on its disk, which
 * outlives every room (rooms stop, restart and come and go; the save stays). Beside it a note
 * (`gamenote:<id>`) says what it is in a few dozen bytes: its turn, who's in it (by account), and
 * where and when it was last played. A lobby reads only the notes to list a person's games; a new
 * game never touches another's save.
 *
 * A game is played at an address of its own: the room named for its id (`?room=<id>`), which
 * opens it as it starts, so its link is the way back to it and the invitation to it. A game begun
 * in a room of one's own takes that room's code for its id; one from before (kept under an id
 * that's no room's code) is given a new id the first time it's opened (`renameGame`).
 *
 * And a game isn't lost. Each turn's start is kept as a backup (`autosave:<id>:<turn>`: the last
 * two, and one from up to ten turns before), and anyone in it can take it back to one (`restoreTurn`)
 * while nobody's playing it. Discarding takes a game off one person's list, not off the others'; it's
 * listed to them as discarded for a week, to bring back, and only once everyone in it has discarded
 * it, and a week has gone by since the last of them did, is it gone (`tidyGames`).
 */

/** A room's code, as the platform takes it (`?room=`): 4 to 24 lower-case letters and digits. */
const ROOM_CODE = /^[a-z0-9]{4,24}$/;
/** Whether a game's id can be its room's code (every new game's is; some from before aren't). */
export const roomCode = (id: string) => ROOM_CODE.test(id);

/** A saved game, in brief. */
export interface GameNote {
  turn: number;
  seats: { key: string; name: string; civ: string | null }[];
  /** The room it was last played in, and when (an ISO time). */
  room: string;
  at: string;
  /** Anyone still in that room playing it (else it was saved as the last of them left). */
  open?: boolean;
  /** Who's discarded it (by seat key: when): off their list, the others' still. Back in it, they're off this. */
  left?: Record<string, string>;
  /** This save's own mark (a few letters, new each time): a room sees whether its game's been saved by another since. */
  mark?: string;
}

/** One of a person's saved games, as their lobby lists it. */
export interface SavedGame {
  id: string;
  turn: number;
  /** Their civ in it. */
  civ: string | null;
  /** The other people in it. */
  with: string[];
  /** When it was last played (an ISO time). */
  at: string;
  /** Being played right now (by whoever's in its room: join them there). */
  live: boolean;
  /** The turns it can be taken back to (the start of each, `restoreTurn`), the latest first. */
  backups: number[];
  /** When they discarded it, if they have: listed a week (`KEEP_DISCARDED`) to bring back. */
  discarded?: string;
}

/** The part of `game.store` the saves need. */
interface Kept {
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  keys(prefix?: string): string[];
}

/** A save as `server.ts` writes it: the game, and its seats. */
export interface Saved<G = { turn: number; over?: unknown }> {
  game: G;
  seats: { key: string; name: string; civ: string | null; bot: boolean }[];
}

export const gameKey = (id: string) => `game:${id}`;
const noteKey = (id: string) => `gamenote:${id}`;
/** A game's autosaves (the game as each of its last few turns began): `autosave:<id>:<turn>`. */
export const autoKey = (id: string, turn: number) => `autosave:${id}:${turn}`;

/** A game saved in the last two minutes with people still in its room is taken to be under way there. */
const LIVE_MS = 2 * 60 * 1000;
/** How long a discarded game is kept (listed to whoever discarded it, to bring back). */
export const KEEP_DISCARDED = 7 * 24 * 60 * 60 * 1000;

/** A game's note: what it is, in brief. */
export const gameNote = (store: Kept, id: string) => store.get<GameNote>(noteKey(id));

/**
 * A game saved, in the room it's played in: the save, and its note (whoever's here, by seat key, no
 * longer among those who've discarded it). The note, if it's saved (a game over isn't: it's gone).
 */
export function saveGame(store: Kept, id: string, room: string, save: Saved, now = new Date(), open = true, here: readonly string[] = []): GameNote | null {
  if (save.game.over) {
    forgetGame(store, id);
    return null;
  }
  store.set(gameKey(id), save);
  const left = Object.fromEntries(Object.entries(gameNote(store, id)?.left ?? {}).filter(([key]) => !here.includes(key)));
  const note: GameNote = { turn: save.game.turn, seats: save.seats.filter((s) => !s.bot).map((s) => ({ key: s.key, name: s.name, civ: s.civ })), room, at: now.toISOString(), open, mark: gameId().slice(0, 6) };
  if (Object.keys(left).length) note.left = left;
  store.set(noteKey(id), note);
  return note;
}

/** A game's turns kept as autosaves, newest first. */
export const autosaveTurns = (store: Kept, id: string) =>
  store
    .keys(`autosave:${id}:`)
    .map((k) => Number(k.slice(k.lastIndexOf(':') + 1)))
    .filter(Number.isFinite)
    .sort((a, b) => b - a);

/**
 * The turns whose backups a game keeps, of those it has (`turns`, the latest first): the latest two,
 * and one from before them, the latest whose turn is a tenth (else the earliest), so a game can go
 * back a turn or two, or further, to before whatever went wrong.
 */
export function backupsKept(turns: readonly number[]): Set<number> {
  const before = turns.slice(2);
  return new Set([...turns.slice(0, 2), ...(before.length ? [before.find((t) => t % 10 === 0) ?? before[before.length - 1]] : [])]);
}

/** A game gone (won, or discarded by everyone in it a week ago): its save, its note and its autosaves. */
export function forgetGame(store: Kept, id: string) {
  store.delete(gameKey(id));
  store.delete(noteKey(id));
  for (const t of autosaveTurns(store, id)) store.delete(autoKey(id, t));
}

/** Whether a person (their seat's key) has a seat in a saved game. */
export const inGame = (store: Kept, id: string, who: string) => !!store.get<GameNote>(noteKey(id))?.seats.some((s) => s.key === who);

/** Whether a game's note says it's being played right now (saved a moment ago, with people still there). */
const live = (note: GameNote, now: Date) => note.open !== false && now.getTime() - Date.parse(note.at) < LIVE_MS;

/**
 * A game's room says it's still being played (its people may give no order for minutes, reading or
 * away from the keys): its note's time is now, nothing else changed. Every half a minute or so, so
 * no one takes a game back to an earlier turn while it's played.
 */
export function stillPlayed(store: Kept, id: string, now = new Date()) {
  const note = gameNote(store, id);
  if (note) store.set(noteKey(id), { ...note, at: now.toISOString(), open: true });
}

/** Whether a saved game is being played right now, anywhere. */
export function playedNow(store: Kept, id: string, now = new Date()): boolean {
  const note = gameNote(store, id);
  return !!note && live(note, now);
}

/** Whether a saved game is being played right now in a room other than `here`. */
export function playedElsewhere(store: Kept, id: string, here: string, now = new Date()): boolean {
  const note = store.get<GameNote>(noteKey(id));
  return !!note && note.room !== here && live(note, now);
}

/**
 * The saved games a person (their seat's key) has a seat in, the latest played first: those they've
 * discarded too, for a week (`discarded`), to bring back.
 */
export function savedGames(store: Kept, who: string, now = new Date()): SavedGame[] {
  const out: SavedGame[] = [];
  for (const key of store.keys('gamenote:')) {
    const id = key.slice('gamenote:'.length);
    const note = store.get<GameNote>(key);
    const mine = note?.seats.find((s) => s.key === who);
    if (!note || !mine) continue;
    const discarded = note.left?.[who];
    if (discarded && now.getTime() - Date.parse(discarded) >= KEEP_DISCARDED) continue;
    const g: SavedGame = { id, turn: note.turn, civ: mine.civ, with: note.seats.filter((s) => s !== mine).map((s) => s.name), at: note.at, live: live(note, now), backups: autosaveTurns(store, id) };
    if (discarded) g.discarded = discarded;
    out.push(g);
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || b.turn - a.turn);
}

/** A person discards a game: it's off their list (listed as discarded a week), not off the others'. */
export function discardGame(store: Kept, id: string, who: string, now = new Date()) {
  const note = gameNote(store, id);
  if (note?.seats.some((s) => s.key === who)) store.set(noteKey(id), { ...note, left: { ...note.left, [who]: now.toISOString() } });
}

/** A game they'd discarded brought back to their list. */
export function keepGame(store: Kept, id: string, who: string) {
  const note = gameNote(store, id);
  if (!note?.left?.[who]) return;
  const { [who]: _, ...left } = note.left;
  const kept: GameNote = { ...note, left };
  if (!Object.keys(left).length) delete kept.left;
  store.set(noteKey(id), kept);
}

/**
 * A game taken back to the start of one of its turns (a backup of it, `backupsKept`): saved as it
 * was then (`edit` may add to it: a word to its people), and the backups after it gone, a future no
 * longer. Whether it was.
 */
export function restoreTurn(store: Kept, id: string, turn: number, now = new Date(), edit?: (save: Saved) => void): boolean {
  const backup = store.get<Saved>(autoKey(id, turn));
  const note = gameNote(store, id);
  if (!backup?.game || !Array.isArray(backup.seats) || !note) return false;
  const save = structuredClone(backup);
  edit?.(save);
  if (!saveGame(store, id, note.room, save, now, false)) return false;
  for (const t of autosaveTurns(store, id)) if (t > turn) store.delete(autoKey(id, t));
  return true;
}

/** The games everyone in has discarded, the last of them a week ago or more: gone. */
export function tidyGames(store: Kept, now = new Date()) {
  for (const key of store.keys('gamenote:')) {
    const note = store.get<GameNote>(key);
    const left = note?.left ?? {};
    const gone = !!note?.seats.length && note.seats.every((s) => left[s.key] && now.getTime() - Date.parse(left[s.key]) >= KEEP_DISCARDED);
    if (gone) forgetGame(store, key.slice('gamenote:'.length));
  }
}

/**
 * A game from before games had addresses, kept under an id that's no room's code (`room-public`):
 * moved to a new id (`to`), its save, note and autosaves with it, the old keys gone.
 */
export function renameGame(store: Kept, from: string, to: string) {
  const save = store.get(gameKey(from));
  if (save === undefined) return;
  store.set(gameKey(to), save);
  const note = store.get<GameNote>(noteKey(from));
  if (note) store.set(noteKey(to), { ...note, room: to });
  for (const t of autosaveTurns(store, from)) store.set(autoKey(to, t), store.get(autoKey(from, t)));
  forgetGame(store, from);
}

/**
 * Saves from when they were kept by room (`save:<room>`, its autosaves `autosave:<room>:<turn>`,
 * and the notes beside them for a while, `savenote:<room>`): each made a game of its own, under an
 * id from its room (so two rooms starting at once make the same one), and the room's keys gone.
 */
export function moveRoomSaves(store: Kept, now = new Date()) {
  for (const key of store.keys('save:')) {
    const room = key.slice('save:'.length);
    const save = store.get<Saved>(key);
    const id = `room-${room}`;
    if (save?.game && Array.isArray(save.seats) && !save.game.over && !store.get(gameKey(id))) {
      saveGame(store, id, room, save, now);
      for (const k of store.keys(`autosave:${room}:`)) {
        const turn = Number(k.slice(k.lastIndexOf(':') + 1));
        if (Number.isFinite(turn)) store.set(autoKey(id, turn), store.get(k));
        store.delete(k);
      }
    }
    store.delete(key);
  }
  for (const key of store.keys('savenote:')) store.delete(key);
}

/** A new game's id: ten letters and digits. */
export function gameId(random = Math.random): string {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 10 }, () => abc[Math.floor(random() * abc.length)]).join('');
}
