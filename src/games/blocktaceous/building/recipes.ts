/**
 * What each structure piece and station is crafted from: a plain list the survival part's crafting
 * reads. `count` is how many one craft makes (1 if left out), `level` the survivor's level it
 * unlocks at, `station` the station it's made at (left out: by hand, anywhere).
 */
export interface Recipe {
  item: string;
  count?: number;
  needs: Record<string, number>;
  level: number;
  station?: string;
}

export const recipes: Recipe[] = [
  // The first night: a fire, a light, a hut of thatch and a place to wake up.
  { item: 'bt_campfire', needs: { stone: 8, wood: 4, thatch: 6, flint: 1 }, level: 1 },
  { item: 'bt_torch', count: 2, needs: { wood: 1, fiber: 2, flint: 1 }, level: 1 },
  { item: 'bt_thatch_wall', count: 2, needs: { thatch: 6, fiber: 2, wood: 1 }, level: 1 },
  { item: 'bt_thatch_slab', count: 2, needs: { thatch: 4, fiber: 2 }, level: 1 },
  { item: 'bt_wood_door', needs: { wood: 8, fiber: 4 }, level: 2 },
  { item: 'bt_bed', needs: { thatch: 15, fiber: 12 }, level: 2 },
  { item: 'bt_ladder', count: 2, needs: { wood: 4, fiber: 2 }, level: 3 },
  { item: 'bt_fence', count: 2, needs: { wood: 4 }, level: 3 },
  { item: 'bt_storage', needs: { wood: 12, thatch: 6, fiber: 6 }, level: 3 },
  { item: 'bt_mortar', needs: { stone: 12, wood: 2 }, level: 3 },
  // Wood.
  { item: 'bt_wood_wall', count: 2, needs: { wood: 6, thatch: 2, fiber: 1 }, level: 4 },
  { item: 'bt_wood_floor', count: 2, needs: { wood: 5, fiber: 1 }, level: 4 },
  { item: 'bt_wood_slab', count: 2, needs: { wood: 3 }, level: 4 },
  { item: 'bt_window', needs: { wood: 4, fiber: 2 }, level: 4 },
  { item: 'bt_gate', needs: { wood: 6, fiber: 4 }, level: 4 },
  { item: 'bt_wood_ramp', needs: { wood: 4 }, level: 5 },
  { item: 'bt_workbench', needs: { wood: 20, stone: 8, fiber: 10, flint: 4 }, level: 5 },
  // Stone, cut at the workbench.
  { item: 'bt_stone_wall', count: 2, needs: { stone: 8, wood: 2, thatch: 2 }, level: 8, station: 'workbench' },
  { item: 'bt_stone_floor', count: 2, needs: { stone: 6 }, level: 8, station: 'workbench' },
  { item: 'bt_stone_slab', count: 2, needs: { stone: 4 }, level: 8, station: 'workbench' },
  { item: 'bt_stone_ramp', needs: { stone: 6 }, level: 9, station: 'workbench' },
  { item: 'bt_forge', needs: { stone: 30, wood: 10, flint: 6 }, level: 10, station: 'workbench' },
  // Metal.
  { item: 'bt_smithy', needs: { metal_ingot: 8, wood: 20, stone: 12 }, level: 14, station: 'workbench' },
  { item: 'bt_metal_wall', count: 2, needs: { metal_ingot: 4, stone: 4 }, level: 18, station: 'smithy' },
];

const byItem = new Map(recipes.map((r) => [r.item, r]));

/** The recipe that makes an item, if it's one of the builders'. */
export function recipeOf(item: string): Recipe | undefined {
  return byItem.get(item);
}
