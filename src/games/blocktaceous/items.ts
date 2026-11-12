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
  cordage: item('Cordage', 100, 0.05),
  charcoal: item('Charcoal', 100, 0.2),
  stone_pick: item('Stone Pick', 1, 2),
  metal_pick: item('Metal Pick', 1, 3),
  stone_hatchet: item('Stone Hatchet', 1, 2),
  metal_hatchet: item('Metal Hatchet', 1, 3),
  stone_sickle: item('Stone Sickle', 1, 1.5),
  metal_sickle: item('Metal Sickle', 1, 2),
  club: item('Club', 1, 3),
  spear: item('Flint Spear', 1, 2.5),
  metal_spear: item('Metal Pike', 1, 3.5),
  bow: item('Hunting Bow', 1, 1.5),
  longbow: item('Longbow', 1, 2.5),
  slingshot: item('Slingshot', 1, 0.8),
  stone_arrow: item('Stone Arrow', 50, 0.05),
  metal_arrow: item('Metal Arrow', 50, 0.08),
  waterskin: item('Waterskin', 1, 0.3),
  waterskin_full: item('Full Waterskin', 1, 1.3),
  berry_mash: item('Berry Mash', 20, 0.15),
  jerky: item('Jerky', 40, 0.05),
  stew: item('Hearty Stew', 5, 0.5),
  bandage: item('Bandage', 20, 0.05),
  cloth_hood: item('Cloth Hood', 1, 0.3),
  cloth_tunic: item('Cloth Tunic', 1, 0.6),
  cloth_wraps: item('Cloth Wraps', 1, 0.3),
  hide_cap: item('Hide Cap', 1, 0.8),
  hide_vest: item('Hide Vest', 1, 1.8),
  hide_boots: item('Hide Boots', 1, 1),
  metal_helm: item('Metal Helm', 1, 3),
  metal_plate: item('Metal Plate', 1, 7),
  metal_greaves: item('Metal Greaves', 1, 4),
  lost_pack: item('Lost Pack', 1, 0),

  // ---- Building: structure pieces and stations (building/) ----
  // Each is named for the block it places (`building/def.ts`).
  bt_thatch_wall: item('Thatch Wall', 100, 1),
  bt_thatch_slab: item('Thatch Roof', 100, 0.5),
  bt_wood_wall: item('Wooden Wall', 100, 2),
  bt_wood_floor: item('Wooden Floor', 100, 2),
  bt_wood_slab: item('Wooden Slab', 100, 1),
  bt_wood_ramp: item('Wooden Ramp', 100, 2),
  bt_stone_wall: item('Stone Wall', 100, 4),
  bt_stone_floor: item('Stone Floor', 100, 4),
  bt_stone_slab: item('Stone Slab', 100, 2),
  bt_stone_ramp: item('Stone Ramp', 100, 4),
  bt_metal_wall: item('Metal Wall', 100, 6),
  bt_wood_door: item('Wooden Door', 20, 3),
  bt_gate: item('Gate', 20, 3),
  bt_window: item('Lattice Window', 50, 1),
  bt_fence: item('Fence', 100, 1),
  bt_ladder: item('Ladder', 50, 1),
  bt_campfire: item('Campfire', 5, 4),
  bt_torch: item('Standing Torch', 20, 0.5),
  bt_mortar: item('Mortar', 5, 6),
  bt_workbench: item('Workbench', 5, 10),
  bt_forge: item('Forge', 5, 20),
  bt_smithy: item('Smithy', 5, 20),
  bt_storage: item('Storage Box', 5, 6),
  bt_bed: item('Bedroll', 5, 3),

  // ---- Creatures: saddles and taming gear (creatures/) ----
  wooden_club: item('Wooden Club', 1, 3),
  bola: item('Bola', 10, 0.8),
  blowpipe: item('Blowpipe', 1, 1),
  sleep_dart: item('Sleep Dart', 40, 0.05),
  saddle_small: item('Small Saddle', 1, 6),
  saddle_medium: item('Saddle', 1, 12),
  saddle_large: item('Great Saddle', 1, 22),
  saddle_giant: item('Howdah Saddle', 1, 40),
} satisfies Record<string, ItemEntry>;

export type ItemId = keyof typeof ITEMS;
