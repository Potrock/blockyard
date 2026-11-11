import type { Player, Vec3 } from '@platform';
import { canAfford as affords, registerRecipes as addRecipes, STATION_NAMES, type Recipe } from './craft';
import { harvestTool as toolOf, type HarvestTool } from './data';
import { addItems, container, countItems, dropContainer, removeItems, roomFor as roomIn, type Container } from './pack';
import { gainXp, levelOfPlayer } from './progress';
import { closeJournal, openJournal } from './screen';
import { survivorOf, theGame, touch, type Stack } from './state';

/**
 * What the other parts ask of survival: a survivor's belongings, experience, crafting screens,
 * storage and bed. Everything here takes the player it's about, and works for many at once.
 *
 * A survivor carries a belt (the platform's nine-slot hotbar) and a backpack of forty slots; these
 * functions see both as one inventory.
 */

export type { Recipe } from './craft';
export type { HarvestTool, ToolKind } from './data';
export type { Stack } from './state';

// -----------------------------------------------------------------------------------------------
// Belongings
// -----------------------------------------------------------------------------------------------

/**
 * Put items in a survivor's inventory (stacks they have first, then the belt for things to hold
 * and the pack for materials); what doesn't fit drops at their feet. Returns how many they kept.
 */
export function give(player: Player, item: string, count = 1): number {
  return addItems(player, item, count, true);
}

/** Take items from a survivor if they have that many; false (and nothing taken) if not. */
export function take(player: Player, item: string, count = 1): boolean {
  return removeItems(player, item, count);
}

/** How many of an item a survivor carries, hotbar and backpack together. */
export function count(player: Player, item: string): number {
  return countItems(player, item);
}

/** How many more of an item a survivor has room for (stack space and empty slots; weight never refuses anything, it only slows them). */
export function roomFor(player: Player, item: string): number {
  return roomIn(player, item);
}

/** Whether a survivor carries everything a list of needs asks for (`{ wood: 4, stone: 2 }`, or `[item, amount]` pairs), `times` over. */
export function canAfford(player: Player, needs: Record<string, number> | readonly (readonly [string, number])[], times = 1): boolean {
  return affords(player, needs, times);
}

/** What the item in a survivor's hand harvests as (see `harvestTool`). */
export function heldTool(player: Player): HarvestTool {
  return toolOf(player.inventory.held?.item);
}

/**
 * What an item harvests as: `{ kind: 'pick' | 'hatchet' | 'sickle' | 'hand', tier }`, with tier 0
 * for bare hands (or anything that isn't a tool), 1 for stone, 2 for metal. Pure.
 */
export function harvestTool(heldItemId: string | null | undefined): HarvestTool {
  return toolOf(heldItemId);
}

// -----------------------------------------------------------------------------------------------
// Experience
// -----------------------------------------------------------------------------------------------

/** Experience for something done (a harvest, a kill, a tame, a craft). */
export function addXp(player: Player, amount: number): void {
  gainXp(player, amount);
}

/** A survivor's level, from 1. */
export function levelOf(player: Player): number {
  return levelOfPlayer(player);
}

// -----------------------------------------------------------------------------------------------
// Recipes and stations
// -----------------------------------------------------------------------------------------------

/**
 * Add recipes to the game's book: `{ item, count?, needs, level, station?, cost?, time?, xp? }`.
 * `needs` is `{ itemId: amount }`; `level` is when it can be learned; `station` is one of
 * `'campfire'`, `'mortar'`, `'workbench'`, `'forge'`, `'smithy'` (none: made by hand); `cost` is
 * the sparks to learn it (by default 1 to 4 by level; 0 makes it known from the start). Callable
 * during any part's `setup` (before or after survival's own), or later.
 */
export function registerRecipes(list: readonly Recipe[]): void {
  addRecipes(list);
}

/** Open the crafting screen of a station a survivor is using ('campfire', 'mortar', 'forge', 'smithy', 'workbench'). */
export function openStation(player: Player, station: string): void {
  if (!player.alive || player.bot) return;
  if (!(station in STATION_NAMES)) return;
  openJournal(player, 'craft', { station });
}

// -----------------------------------------------------------------------------------------------
// Storage
// -----------------------------------------------------------------------------------------------

/**
 * Open a container beside a survivor's pack, to move things across. A container is a list of
 * slots kept in `game.store` under `box:<containerId>`, made empty the first time it's opened:
 * give each storage box an id of its own (its block's place: `'box:12,64,-7'` works) and the
 * number of slots it has. Several survivors may have one open at once.
 */
export function openContainer(player: Player, containerId: string, slots: number, title = 'Storage Box'): void {
  if (!player.alive || player.bot) return;
  container(containerId, Math.max(1, Math.min(60, Math.floor(slots))), title);
  openJournal(player, 'pack', { container: containerId });
}

/** What a container holds (its stacks, empty slots left out), whether or not anyone has it open. */
export function containerContents(containerId: string, slots = 1): Stack[] {
  return container(containerId, slots).slots.filter((s): s is Stack => !!s).map((s) => ({ ...s }));
}

/** Whether a container holds nothing (a box may be taken down without spilling anything). */
export function containerEmpty(containerId: string): boolean {
  return container(containerId, 1).slots.every((s) => !s);
}

/**
 * A container is gone (its box was broken): forget it, and with `spillAt` drop what it held there
 * as pickups. Anyone looking into it has their screen closed.
 */
export function removeContainer(containerId: string, spillAt?: Vec3): void {
  const game = theGame();
  const held: Container = container(containerId, 1);
  for (const player of game.players) {
    const s = survivorOf(player);
    if (s.ui.container === containerId) closeJournal(player);
  }
  if (spillAt) {
    for (const stack of held.slots) {
      if (stack && game.items.get(stack.item)) game.items.spawnPickup(stack.item, { x: spillAt.x, y: spillAt.y + 0.5, z: spillAt.z }, { count: stack.count, velocity: { x: 0, y: 2, z: 0 }, despawn: 600 });
    }
  }
  dropContainer(containerId);
}

/** Close whatever survival screen a survivor has open (the pack, a station, a container). */
export function closeScreens(player: Player): void {
  closeJournal(player);
}

// -----------------------------------------------------------------------------------------------
// Beds
// -----------------------------------------------------------------------------------------------

/**
 * A survivor's bed: where they wake after dying, as long as a bed block (`bt_bed…`) still stands
 * at `pos` (the block's own cell). Null forgets it (the bed was broken): they wake on a beach.
 */
export function setBedSpawn(player: Player, pos: Vec3 | null): void {
  const s = survivorOf(player);
  s.bed = pos ? { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } : null;
  touch(s);
  if (pos) player.hud.toast('You will wake here');
}

/** Where a survivor's bed is, if they have one. */
export function bedOf(player: Player): Vec3 | null {
  const bed = survivorOf(player).bed;
  return bed ? { ...bed } : null;
}
