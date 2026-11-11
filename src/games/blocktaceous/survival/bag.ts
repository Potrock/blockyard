import type { Player } from '@platform';

/**
 * What the other parts ask of survival: a survivor's belongings, experience and crafting screens.
 * PLACEHOLDER bodies (the hotbar alone): the survival part replaces them; the signatures stay.
 */

/** Put items in a survivor's inventory; what doesn't fit drops at their feet. Returns how many they kept. */
export function give(player: Player, item: string, count = 1): number {
  player.inventory.give(item, count);
  return count;
}

/** Take items from a survivor if they have that many; false (and nothing taken) if not. */
export function take(player: Player, item: string, count = 1): boolean {
  if (player.inventory.count(item) < count) return false;
  player.inventory.take(item, count);
  return true;
}

/** How many of an item a survivor carries, hotbar and backpack together. */
export function count(player: Player, item: string): number {
  return player.inventory.count(item);
}

/** Experience for something done (a harvest, a kill, a tame, a craft). */
export function addXp(_player: Player, _amount: number): void {}

/** A survivor's level, from 1. */
export function levelOf(_player: Player): number {
  return 1;
}

/** Open the crafting screen of a station a survivor is using ('campfire', 'mortar', 'forge', 'smithy', 'workbench'). */
export function openStation(_player: Player, _station: string): void {}
