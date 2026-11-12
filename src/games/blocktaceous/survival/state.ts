import type { GameContext, Player, Vec3 } from '@platform';
import { BAG_SLOTS, HOTBAR_SLOTS, levelForXp, WORN_SLOTS, type WornSlot } from './data';

/**
 * Each survivor's state, by player id: what the rest of the survival part reads and changes, and
 * how it is kept in `player.store` (key `survivor`) so that a survivor is the same person the next
 * time they come to the island. A guest's lasts as long as their visit, as the platform has it.
 */

export interface Stack {
  item: string;
  count: number;
}
export type Slot = Stack | null;

/** Something being made: a recipe's key, how many are still to come, and how far along the one in hand is. */
export interface Job {
  key: string;
  left: number;
  t: number;
}

/** What a survivor's screen is showing (never kept). */
export interface ScreenState {
  open: boolean;
  tab: 'pack' | 'craft' | 'lore';
  /** The slot picked up to move (a slot reference, see `pack.ts`), or null. */
  sel: string | null;
  /** The station whose recipes show, and the container open beside the pack. */
  station: string | null;
  container: string | null;
  /** The screen's contents changed: send it again this step. */
  stale: boolean;
  /** The hotbar as last shown, to notice the platform changing it (a pickup, an arrow shot). */
  belt: string;
}

export interface Survivor {
  readonly id: string;
  hunger: number;
  thirst: number;
  /** Exposure: 0 comfortable, down to -100 freezing, up to 100 burning. */
  temp: number;
  xp: number;
  level: number;
  /** Sparks spent on recipes, and the recipes learned (their keys). */
  spent: number;
  learned: Set<string>;
  bag: Slot[];
  worn: Record<WornSlot, string | null>;
  /** The bed they wake at, if they have one. */
  bed: Vec3 | null;
  /** Their lost pack's id while one lies where they died. */
  cache: string | null;
  queue: Job[];
  /** How far along the first goals they are (an index into `GOALS`; past the end: done), and whether they've hidden them. */
  goal: number;
  goalsOff: boolean;
  /** Things done once that a goal asks about ('drank', 'campfire', 'cooked'). */
  deeds: Set<string>;
  /** Uses spent of the tool or weapon of each kind they carry (see `wear.ts`). */
  wear: Record<string, number>;
  // ---- Never kept ----
  ui: ScreenState;
  /** Something changed that must be kept: saved soon. */
  dirty: boolean;
  /** Seconds until the next save may go, the next slow check (weight, weather), and the next harm from want. */
  saveIn: number;
  slowIn: number;
  hurtIn: number;
  /** What they carry weighs, and the most they carry freely, as last worked out. */
  weight: number;
  limit: number;
  /** A campfire (or any warmth) is near. */
  warm: boolean;
  /** Seconds the fire button has been held since the last swing was paid for. */
  swing: number;
  /** Seconds left before they wake after dying (0: alive). */
  wake: number;
  /** The newest lines of what they gained ("+3 Wood"), with seconds left to show. */
  gains: { text: string; left: number; item: string; n: number }[];
  /** They've been told their pack is too heavy, their belt has no arrows. */
  toldHeavy: boolean;
  /** The vitals as last sent to their HUD, to send only changes; and the weather their screen's edges were last told. */
  shown: string;
  weather: string;
  /** The goal card as last sent, and the goal just finished while its tick shows. */
  goalShown: string;
  goalDone: { title: string; xp: number; left: number } | null;
  /** Seconds until a spear may be thrown again. */
  throwIn: number;
}

/** What's kept of a survivor: short names, and stacks as `[item, count]` pairs (0: an empty slot). */
interface Saved {
  v: 1;
  hunger: number;
  thirst: number;
  temp: number;
  xp: number;
  spent: number;
  learned: string[];
  bag: ([string, number] | 0)[];
  belt: ([string, number] | 0)[];
  hand: number;
  worn: (string | null)[];
  bed: [number, number, number] | null;
  cache: string | null;
  health: number;
  queue: [string, number][];
  goal?: number;
  goalsOff?: boolean;
  deeds?: string[];
  wear?: Record<string, number>;
}

const STORE_KEY = 'survivor';

const survivors = new Map<string, Survivor>();

function fresh(id: string): Survivor {
  return {
    id,
    hunger: 100,
    thirst: 100,
    temp: 0,
    xp: 0,
    level: 1,
    spent: 0,
    learned: new Set(),
    bag: Array.from({ length: BAG_SLOTS }, () => null),
    worn: { head: null, body: null, feet: null },
    bed: null,
    cache: null,
    queue: [],
    goal: 0,
    goalsOff: false,
    deeds: new Set(),
    wear: {},
    ui: { open: false, tab: 'pack', sel: null, station: null, container: null, stale: false, belt: '' },
    dirty: false,
    saveIn: 0,
    slowIn: 0,
    hurtIn: 0,
    weight: 0,
    limit: 0,
    warm: false,
    swing: 0,
    wake: 0,
    gains: [],
    toldHeavy: false,
    shown: '',
    weather: '',
    goalShown: '',
    goalDone: null,
    throwIn: 0,
  };
}

const packStacks = (slots: readonly Slot[]): ([string, number] | 0)[] => slots.map((s) => (s ? [s.item, s.count] : 0));

function unpackStacks(list: unknown, length: number): Slot[] {
  const out: Slot[] = Array.from({ length }, () => null);
  if (!Array.isArray(list)) return out;
  for (let i = 0; i < Math.min(length, list.length); i++) {
    const s = list[i];
    if (Array.isArray(s) && typeof s[0] === 'string' && typeof s[1] === 'number' && s[1] > 0) out[i] = { item: s[0], count: Math.floor(s[1]) };
  }
  return out;
}

const num = (v: unknown, fallback: number, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);

/**
 * The survivor a player is, made the first time they're asked for: from what was kept for them, or
 * new. Their hotbar and health are put back as they were, too (the platform keeps neither).
 */
export function survivorOf(player: Player): Survivor {
  let s = survivors.get(player.id);
  if (s) return s;
  s = fresh(player.id);
  survivors.set(player.id, s);
  const kept = player.bot ? undefined : player.store.get<Partial<Saved>>(STORE_KEY);
  if (kept && typeof kept === 'object') {
    s.hunger = num(kept.hunger, 100, 0, 100);
    s.thirst = num(kept.thirst, 100, 0, 100);
    s.temp = num(kept.temp, 0, -100, 100);
    s.xp = num(kept.xp, 0, 0, 1e9);
    s.level = levelForXp(s.xp);
    s.spent = num(kept.spent, 0, 0, 1e6);
    if (Array.isArray(kept.learned)) for (const k of kept.learned) if (typeof k === 'string') s.learned.add(k);
    s.bag = unpackStacks(kept.bag, BAG_SLOTS);
    WORN_SLOTS.forEach((slot, i) => {
      const w = kept.worn?.[i];
      s!.worn[slot] = typeof w === 'string' ? w : null;
    });
    if (Array.isArray(kept.bed) && kept.bed.length === 3) s.bed = { x: num(kept.bed[0], 0, -1e6, 1e6), y: num(kept.bed[1], 0, -1e6, 1e6), z: num(kept.bed[2], 0, -1e6, 1e6) };
    s.cache = typeof kept.cache === 'string' ? kept.cache : null;
    if (Array.isArray(kept.queue)) {
      for (const j of kept.queue) if (Array.isArray(j) && typeof j[0] === 'string' && typeof j[1] === 'number' && j[1] > 0) s.queue.push({ key: j[0], left: Math.floor(j[1]), t: 0 });
    }
    s.goal = num(kept.goal, 0, 0, 1000);
    s.goalsOff = kept.goalsOff === true;
    if (Array.isArray(kept.deeds)) for (const d of kept.deeds) if (typeof d === 'string') s.deeds.add(d);
    if (kept.wear && typeof kept.wear === 'object') {
      for (const [item, n] of Object.entries(kept.wear)) if (typeof n === 'number' && n > 0) s.wear[item] = Math.floor(n);
    }
    const belt = unpackStacks(kept.belt, HOTBAR_SLOTS);
    player.inventory.clear();
    belt.forEach((stack, i) => stack && player.inventory.set(i, stack));
    player.inventory.select(num(kept.hand, 0, 0, HOTBAR_SLOTS - 1));
    // Someone who left hurt comes back hurt (but never dead: the island gives them that much).
    if (typeof kept.health === 'number' && player.alive) player.health = Math.max(2, Math.min(player.maxHealth, kept.health));
  }
  return s;
}

/** The survivor a player is if they've been met already (never made here). */
export const survivorIfKnown = (playerId: string): Survivor | undefined => survivors.get(playerId);

/** Keep a survivor now. */
export function save(player: Player, s: Survivor): void {
  s.dirty = false;
  s.saveIn = 10;
  if (player.bot) return;
  const data: Saved = {
    v: 1,
    hunger: Math.round(s.hunger * 10) / 10,
    thirst: Math.round(s.thirst * 10) / 10,
    temp: Math.round(s.temp),
    xp: Math.round(s.xp),
    spent: s.spent,
    learned: [...s.learned],
    bag: packStacks(s.bag),
    belt: packStacks(player.inventory.slots.map((x) => (x ? { item: x.item, count: x.count } : null))),
    hand: player.inventory.selected,
    worn: WORN_SLOTS.map((slot) => s.worn[slot]),
    bed: s.bed ? [s.bed.x, s.bed.y, s.bed.z] : null,
    cache: s.cache,
    health: player.alive ? player.health : player.maxHealth,
    queue: s.queue.map((j) => [j.key, j.left]),
    goal: s.goal,
    goalsOff: s.goalsOff,
    deeds: [...s.deeds],
    wear: s.wear,
  };
  player.store.set(STORE_KEY, data);
}

/** They left: keep them, and forget them here. */
export function forget(player: Player): void {
  const s = survivors.get(player.id);
  if (!s) return;
  save(player, s);
  survivors.delete(player.id);
}

/** Forget everyone without keeping anything (a new game in the same process: tests). */
export function forgetAll(): void {
  survivors.clear();
}

/** Mark a survivor as changed: kept within a few seconds, and their screen redrawn if it's open. */
export function touch(s: Survivor): void {
  s.dirty = true;
  s.ui.stale = true;
}

// -----------------------------------------------------------------------------------------------
// The running game
// -----------------------------------------------------------------------------------------------

let running: GameContext | null = null;

/** The game these rules run in: set in `setup`, so that functions taking only a player can reach it. */
export function setGame(game: GameContext): void {
  running = game;
}

export function theGame(): GameContext {
  if (!running) throw new Error('survival: used before its setup ran');
  return running;
}

export const gameIfRunning = (): GameContext | null => running;
