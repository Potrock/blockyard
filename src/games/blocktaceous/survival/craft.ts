import type { Player } from '@platform';
import { MAX_LEVEL, nameOf, sparksAt } from './data';
import { addItems, countItems, removeItems, roomFor } from './pack';
import { survivorOf, touch, type Survivor } from './state';

/**
 * Recipes, what a survivor knows of them, and what they're making. Every part of the game adds
 * its recipes to one book (`registerRecipes`); a survivor learns a recipe with sparks (earned by
 * levelling up) once they've reached its level, and makes what they know by hand or, for a
 * station's recipes, while that station's screen is open.
 */

/** The stations recipes can need (the building part's blocks open them: `openStation`). */
export type Station = 'campfire' | 'mortar' | 'workbench' | 'forge' | 'smithy';

export const STATION_NAMES: Record<string, string> = {
  campfire: 'Campfire',
  mortar: 'Mortar',
  workbench: 'Workbench',
  forge: 'Forge',
  smithy: 'Smithy',
};

/** A recipe, as a part gives it. */
export interface Recipe {
  /** What it makes, and how many at a time (default 1). */
  item: string;
  count?: number;
  /** What it uses up: item ids to amounts (or a list of `[item, amount]` pairs). */
  needs: Record<string, number> | readonly (readonly [string, number])[];
  /** The level it can be learned at. */
  level: number;
  /** Where it's made (by hand anywhere, if none). */
  station?: string;
  /** Sparks to learn it (default: by its level; 0 is known from the start). */
  cost?: number;
  /** Seconds to make one batch (default: a second or two by hand, longer at a station). */
  time?: number;
  /** Experience for making a batch (default: by its level). */
  xp?: number;
}

/** A recipe in the book, with its defaults filled in. */
export interface BookRecipe {
  /** Its name in the book and in what's kept of a survivor: the item, and its station if it has one. */
  key: string;
  item: string;
  count: number;
  needs: [string, number][];
  level: number;
  station: string | null;
  cost: number;
  time: number;
  xp: number;
}

const book = new Map<string, BookRecipe>();

/** Sparks a recipe costs unless it says: more for what comes later. */
const costAt = (level: number): number => (level <= 1 ? 0 : level < 8 ? 1 : level < 20 ? 2 : level < 35 ? 3 : 4);

/**
 * Add recipes to the book. Any part may call it, during its `setup` or later, before or after the
 * survival part's own: a recipe for the same item at the same station replaces the earlier one.
 */
export function registerRecipes(list: readonly Recipe[]): void {
  for (const r of list) {
    if (!r || typeof r.item !== 'string') continue;
    const needs: [string, number][] = (Array.isArray(r.needs) ? r.needs.map(([item, n]) => [item, n] as [string, number]) : Object.entries(r.needs as Record<string, number>)).filter(
      ([, n]) => n > 0,
    );
    const level = Math.min(MAX_LEVEL, Math.max(1, Math.floor(r.level ?? 1)));
    const station = r.station ?? null;
    const key = station ? `${r.item}@${station}` : r.item;
    book.set(key, {
      key,
      item: r.item,
      count: Math.max(1, Math.floor(r.count ?? 1)),
      needs,
      level,
      station,
      cost: Math.max(0, Math.floor(r.cost ?? costAt(level))),
      time: Math.max(0, r.time ?? (station ? 3 : 1.5)),
      xp: Math.max(0, r.xp ?? 2 + Math.round(level * 0.6)),
    });
  }
  ordered = null;
}

let ordered: BookRecipe[] | null = null;

/** Every recipe, by level, then by name. */
export function recipes(): BookRecipe[] {
  ordered ??= [...book.values()].sort((a, b) => a.level - b.level || nameOf(a.item).localeCompare(nameOf(b.item)));
  return ordered;
}

export const recipeOf = (key: string): BookRecipe | undefined => book.get(key);

/** Empty the book (a new game in the same process: tests). */
export function clearRecipes(): void {
  book.clear();
  ordered = null;
}

// -----------------------------------------------------------------------------------------------
// Knowing
// -----------------------------------------------------------------------------------------------

/** Whether a survivor knows a recipe: learned, or free and within their level. */
export function knows(s: Survivor, r: BookRecipe): boolean {
  return s.learned.has(r.key) || (r.cost === 0 && s.level >= r.level);
}

/** Sparks they have left to spend. */
export function sparksLeft(s: Survivor): number {
  return Math.max(0, sparksAt(s.level) - s.spent);
}

/** Learn a recipe, if they've the level and the sparks. */
export function learn(player: Player, key: string): boolean {
  const s = survivorOf(player);
  const r = book.get(key);
  if (!r || knows(s, r) || s.level < r.level || sparksLeft(s) < r.cost) return false;
  s.spent += r.cost;
  s.learned.add(r.key);
  touch(s);
  player.audio.play('bt_learn');
  return true;
}

// -----------------------------------------------------------------------------------------------
// Making
// -----------------------------------------------------------------------------------------------

/** Whether a survivor carries everything a list of needs asks for, `times` over. */
export function canAfford(player: Player, needs: Record<string, number> | readonly (readonly [string, number])[], times = 1): boolean {
  const list = Array.isArray(needs) ? needs : Object.entries(needs as Record<string, number>);
  return list.every(([item, n]) => countItems(player, item) >= n * times);
}

/** Jobs a survivor may have waiting at once. */
export const QUEUE_MAX = 6;

/** Why a survivor can't make a recipe now, or null if they can. */
export function whyNot(player: Player, r: BookRecipe, times = 1): string | null {
  const s = survivorOf(player);
  if (!knows(s, r)) return 'You haven’t learned that';
  if (r.station && s.ui.station !== r.station) return `Needs a ${STATION_NAMES[r.station] ?? r.station}`;
  if (!canAfford(player, r.needs, times)) return 'Missing materials';
  if (s.queue.length >= QUEUE_MAX && s.queue.at(-1)?.key !== r.key) return 'Your hands are full';
  return null;
}

/**
 * Start making a recipe `times` over: the materials are taken now, and the batches come one after
 * another (a job in their queue). False, with nothing taken, if they can't.
 */
export function craft(player: Player, key: string, times = 1): boolean {
  const r = book.get(key);
  const n = Math.max(1, Math.min(50, Math.floor(times)));
  if (!r || whyNot(player, r, n)) return false;
  const s = survivorOf(player);
  for (const [item, amount] of r.needs) removeItems(player, item, amount * n);
  const last = s.queue.at(-1);
  if (last?.key === r.key) last.left += n;
  else s.queue.push({ key: r.key, left: n, t: 0 });
  touch(s);
  return true;
}

/** Give up a job: what hasn't been made comes back as materials. */
export function cancelJob(player: Player, index: number): boolean {
  const s = survivorOf(player);
  const job = s.queue[index];
  const r = job && book.get(job.key);
  if (!job) return false;
  s.queue.splice(index, 1);
  if (r) for (const [item, amount] of r.needs) addItems(player, item, amount * job.left, true);
  touch(s);
  return true;
}

/** Work on what they're making. Returns the experience earned this step. */
export function workQueue(player: Player, s: Survivor, dt: number): number {
  const job = s.queue[0];
  if (!job) return 0;
  const r = book.get(job.key);
  if (!r) {
    // A recipe that's gone from the book (a part changed): nothing to make, nothing to give back.
    s.queue.shift();
    return 0;
  }
  job.t += dt;
  if (job.t < r.time) return 0;
  // No room: it waits, finished, until there is.
  if (roomFor(player, r.item) < r.count) {
    job.t = r.time;
    return 0;
  }
  job.t = 0;
  job.left--;
  if (job.left <= 0) s.queue.shift();
  addItems(player, r.item, r.count, true);
  player.audio.play('bt_craft');
  touch(s);
  return r.xp;
}
