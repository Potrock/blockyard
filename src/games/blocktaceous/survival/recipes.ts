import type { Recipe } from './craft';

/**
 * The survivor's own recipes: tools, weapons, clothes and food. The building and creature parts
 * add theirs (structures and stations, saddles and taming gear) with `registerRecipes`.
 *
 * The first few are free and known from the start, so a castaway can make a pick and a hatchet
 * with what lies on the beach; everything after is learned with sparks.
 */
export const SURVIVAL_RECIPES: Recipe[] = [
  // ---- By hand ----
  { item: 'stone_pick', needs: { wood: 1, stone: 2, thatch: 4 }, level: 1 },
  { item: 'stone_hatchet', needs: { wood: 1, flint: 2, thatch: 6 }, level: 1 },
  { item: 'cordage', needs: { fiber: 8 }, level: 1, time: 1, xp: 1 },
  { item: 'club', needs: { wood: 6, cordage: 1 }, level: 2 },
  { item: 'cloth_tunic', needs: { fiber: 30, cordage: 1 }, level: 2 },
  { item: 'spear', needs: { wood: 4, flint: 2, cordage: 1 }, level: 3 },
  { item: 'cloth_wraps', needs: { fiber: 16, cordage: 1 }, level: 3 },
  { item: 'cloth_hood', needs: { fiber: 18, cordage: 1 }, level: 3 },
  { item: 'waterskin', needs: { hide: 4, cordage: 2 }, level: 4 },
  { item: 'bandage', count: 2, needs: { fiber: 12, sap: 1 }, level: 4 },
  { item: 'slingshot', needs: { wood: 3, hide: 1, cordage: 2 }, level: 5 },
  { item: 'stone_sickle', needs: { wood: 2, flint: 3, cordage: 1 }, level: 6 },
  { item: 'stone_arrow', count: 6, needs: { wood: 1, flint: 1, feather: 2 }, level: 7 },

  // ---- Campfire ----
  { item: 'cooked_meat', needs: { raw_meat: 1 }, level: 1, station: 'campfire', time: 4, xp: 1 },
  { item: 'cooked_fish', needs: { raw_fish: 1 }, level: 1, station: 'campfire', time: 4, xp: 1 },
  { item: 'charcoal', needs: { wood: 2 }, level: 8, station: 'campfire', time: 5, xp: 1 },
  { item: 'jerky', needs: { raw_meat: 1, berries: 4 }, level: 9, station: 'campfire', time: 10 },
  { item: 'stew', needs: { cooked_meat: 1, berries: 10, egg: 1 }, level: 14, station: 'campfire', time: 8 },

  // ---- Mortar ----
  { item: 'berry_mash', needs: { berries: 10 }, level: 5, station: 'mortar', time: 2 },

  // ---- Workbench ----
  { item: 'bow', needs: { wood: 8, cordage: 6 }, level: 7, station: 'workbench', time: 4 },
  { item: 'hide_cap', needs: { hide: 8, cordage: 2 }, level: 10, station: 'workbench', time: 4 },
  { item: 'hide_vest', needs: { hide: 16, cordage: 4 }, level: 11, station: 'workbench', time: 5 },
  { item: 'hide_boots', needs: { hide: 10, cordage: 3 }, level: 12, station: 'workbench', time: 4 },

  // ---- Forge ----
  { item: 'metal_ingot', needs: { metal_ore: 2, charcoal: 1 }, level: 16, station: 'forge', time: 6 },

  // ---- Smithy ----
  { item: 'metal_pick', needs: { metal_ingot: 4, wood: 2, hide: 2 }, level: 18, station: 'smithy', time: 6 },
  { item: 'metal_hatchet', needs: { metal_ingot: 4, wood: 2, hide: 2 }, level: 18, station: 'smithy', time: 6 },
  { item: 'metal_sickle', needs: { metal_ingot: 3, wood: 2, hide: 1 }, level: 20, station: 'smithy', time: 5 },
  { item: 'metal_spear', needs: { metal_ingot: 5, wood: 6, cordage: 3 }, level: 21, station: 'smithy', time: 6 },
  { item: 'metal_arrow', count: 6, needs: { metal_ingot: 1, wood: 1, feather: 2 }, level: 22, station: 'smithy', time: 3 },
  { item: 'longbow', needs: { wood: 10, metal_ingot: 3, cordage: 8 }, level: 24, station: 'smithy', time: 8 },
  { item: 'metal_helm', needs: { metal_ingot: 8, hide: 4 }, level: 26, station: 'smithy', time: 8 },
  { item: 'metal_greaves', needs: { metal_ingot: 10, hide: 5 }, level: 28, station: 'smithy', time: 8 },
  { item: 'metal_plate', needs: { metal_ingot: 16, hide: 8 }, level: 30, station: 'smithy', time: 10 },
];
