/**
 * Every item's id, name and stack size: the vocabulary the game's parts share. What an item does
 * (a tool's harvest, a weapon's damage, a food's meal) is defined by the part that owns it, in its
 * `setup`; how it looks, by the client code. A part that needs a new item adds a line to its own
 * section here.
 */
export interface ItemEntry {
  name: string;
  /** How many fit in one slot. */
  stack: number;
  /** What it weighs, each (a survivor carries only so much). */
  weight: number;
}

const item = (name: string, stack: number, weight: number): ItemEntry => ({ name, stack, weight });

export const ITEMS = {
  // ---- Resources: gathered from the island (building/), or from creatures (creatures/) ----
  wood: item('Wood', 100, 0.5),
  thatch: item('Thatch', 100, 0.1),
  fiber: item('Fiber', 200, 0.02),
  stone: item('Stone', 100, 0.5),
  flint: item('Flint', 100, 0.1),
  berries: item('Berries', 100, 0.05),
  seeds: item('Seeds', 100, 0.02),
  metal_ore: item('Metal Ore', 100, 1),
  metal_ingot: item('Metal Ingot', 100, 1),
  crystal: item('Crystal', 100, 1),
  obsidian: item('Obsidian', 100, 1),
  sap: item('Sap', 100, 0.2),
  raw_meat: item('Raw Meat', 40, 0.1),
  cooked_meat: item('Cooked Meat', 40, 0.1),
  prime_meat: item('Prime Meat', 10, 0.2),
  raw_fish: item('Raw Fish', 40, 0.1),
  cooked_fish: item('Cooked Fish', 40, 0.1),
  hide: item('Hide', 200, 0.05),
  keratin: item('Keratin', 100, 0.05),
  feather: item('Feather', 200, 0.01),
  egg: item('Egg', 10, 0.3),

  // ---- Survival: tools, weapons, gear, food (survival/) ----

  // ---- Building: structure pieces and stations (building/) ----

  // ---- Creatures: saddles and taming gear (creatures/) ----
} satisfies Record<string, ItemEntry>;

export type ItemId = keyof typeof ITEMS;
