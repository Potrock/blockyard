import type { ItemId } from '../items';

/**
 * How the creatures' items are made, for the survival part's crafting screens: what each takes,
 * the survivor's level it opens at, and the station it's made at (none: by hand).
 */
export interface CreatureRecipe {
  item: ItemId;
  needs: Partial<Record<ItemId, number>>;
  level: number;
  station?: 'campfire' | 'mortar' | 'forge' | 'smithy' | 'workbench';
  /** How many one crafting makes (default 1). */
  count?: number;
}

export const recipes: CreatureRecipe[] = [
  { item: 'wooden_club', needs: { wood: 8, fiber: 6 }, level: 1 },
  { item: 'bola', needs: { fiber: 12, stone: 3, thatch: 4 }, level: 2 },
  { item: 'blowpipe', needs: { wood: 6, fiber: 10 }, level: 4 },
  { item: 'sleep_dart', needs: { thatch: 2, flint: 1, berries: 6 }, level: 4, station: 'mortar', count: 2 },
  { item: 'saddle_small', needs: { hide: 20, fiber: 30, wood: 8 }, level: 5 },
  { item: 'saddle_medium', needs: { hide: 50, fiber: 60, wood: 20, keratin: 10 }, level: 10, station: 'workbench' },
  { item: 'saddle_large', needs: { hide: 110, fiber: 120, metal_ingot: 25, keratin: 30 }, level: 18, station: 'smithy' },
  { item: 'saddle_giant', needs: { hide: 220, fiber: 200, metal_ingot: 60, wood: 80 }, level: 25, station: 'smithy' },
];
