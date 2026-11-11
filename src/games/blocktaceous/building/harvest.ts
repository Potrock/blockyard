/**
 * What the island's own blocks give a survivor, by the tool in their hand: pure tables, so the
 * rules, the tests and anything else that wants to show a yield read the same numbers.
 *
 * The rule that keeps the island an island: only its *resources* are ever removed (trees, plants,
 * rock, ore), and those grow back. Its ground (soil, sand, gravel, snow) is never dug: it's
 * foraged in place for a stone or a flint, and a foraged spot is picked clean for a while.
 */

export type ToolKind = 'pick' | 'hatchet' | 'sickle' | 'hand';

/** A tool as the survival part describes it: `tier` 0 bare hands, 1 stone, 2 metal (or better). */
export interface Tool {
  kind: ToolKind;
  tier: number;
}

/** One line of a yield: between `min` and `max` of an item, given at all with `chance` (default 1). */
export interface Yield {
  item: string;
  min: number;
  max: number;
  chance?: number;
}

export interface Harvest {
  /** Seconds of holding the button. */
  time: number;
  yields: Yield[];
  /** The block comes away (and grows back after `regrow` seconds); otherwise it's foraged where it lies. */
  removes: boolean;
  regrow: number;
  xp: number;
  /** Which of the game's voices each swing plays. */
  sound: 'bt_chop' | 'bt_pick' | 'bt_rustle' | 'bt_dig';
}

/** Why a block gives nothing to this tool, in words for the survivor (empty: say nothing). */
export interface Refusal {
  refuse: string;
}

const y = (item: string, min: number, max = min, chance?: number): Yield => ({ item, min, max, chance });

/** Seconds until harvested things grow back. */
export const REGROW = { tree: 300, plant: 180, rock: 600, ore: 900 };
/** Seconds a foraged patch of ground stays picked clean. */
export const FORAGE_REST = 120;

const ROCK = /^(stone|cobblestone|mossy_cobblestone|granite|diorite|andesite|deepslate|sandstone|end_stone|basalt|mesa_red|mesa_tan)$/;
const SOIL = /^(dirt|grass_block|snowy_grass|podzol|sand|gravel|clay|snow_block|mud|red_sand|ash)$/;
const METAL_ROCK = /^(metal_rock|iron_ore|gold_ore|redstone_ore|lapis_ore)$/;
const CRYSTAL_ROCK = /^(crystal_rock|diamond_ore)$/;
const OBSIDIAN_ROCK = /^(obsidian_rock|obsidian)$/;

/**
 * What `block` (a family name, as `world.blockName` gives it) yields to `tool`. `plant` is
 * `blockInfo(block).plant`: anything small the island grows that this table doesn't name is
 * gathered like grass. Null: not something to harvest at all (someone's bricks, bedrock, water).
 */
export function harvestOf(block: string, plant: boolean, tool: Tool): Harvest | Refusal | null {
  const metal = tool.tier >= 2;

  if (block.endsWith('_log')) {
    if (tool.kind === 'hatchet') return { time: metal ? 0.7 : 1.2, yields: metal ? [y('wood', 5, 7), y('thatch', 1)] : [y('wood', 3, 4), y('thatch', 1, 1, 0.5)], removes: true, regrow: REGROW.tree, xp: 2, sound: 'bt_chop' };
    if (tool.kind === 'pick') return { time: metal ? 1 : 1.6, yields: metal ? [y('thatch', 5, 7), y('wood', 1, 2)] : [y('thatch', 3, 4), y('wood', 1)], removes: true, regrow: REGROW.tree, xp: 2, sound: 'bt_chop' };
    return { time: 3, yields: [y('thatch', 1, 2), y('wood', 1)], removes: true, regrow: REGROW.tree, xp: 1, sound: 'bt_chop' };
  }
  if (block.endsWith('_leaves')) {
    return { time: 0.35, yields: [y('thatch', 1, 1, 0.5), y('seeds', 1, 1, 0.1), y('sap', 1, 1, 0.06), ...(tool.kind === 'sickle' ? [y('fiber', 1)] : [])], removes: true, regrow: REGROW.tree, xp: 0, sound: 'bt_rustle' };
  }

  if (block === 'berry_bush') {
    return { time: 0.6, yields: [y('berries', tool.kind === 'sickle' ? 4 : 2, tool.kind === 'sickle' ? 6 : 4), y('seeds', 1, 1, 0.6), y('fiber', 1, 1, 0.5)], removes: true, regrow: REGROW.plant, xp: 1, sound: 'bt_rustle' };
  }
  if (block === 'fiber_plant') {
    const n = tool.kind === 'sickle' ? (metal ? 9 : 6) : 3;
    return { time: tool.kind === 'sickle' ? 0.3 : 0.6, yields: [y('fiber', n, n + 2), y('seeds', 1, 1, 0.25)], removes: true, regrow: REGROW.plant, xp: 1, sound: 'bt_rustle' };
  }
  if (block === 'reed') return { time: tool.kind === 'sickle' ? 0.2 : 0.4, yields: [y('fiber', tool.kind === 'sickle' ? 4 : 2, tool.kind === 'sickle' ? 5 : 3), y('thatch', 1, 2)], removes: true, regrow: REGROW.plant, xp: 1, sound: 'bt_rustle' };
  if (block === 'cactus') return { time: 1, yields: [y('fiber', 2, 3), y('sap', 1, 1, 0.5)], removes: true, regrow: REGROW.plant, xp: 1, sound: 'bt_rustle' };
  if (block === 'dead_bush') return { time: 0.4, yields: [y('wood', 1), y('thatch', 1, 2)], removes: true, regrow: REGROW.plant, xp: 1, sound: 'bt_rustle' };
  if (block.endsWith('_mushroom')) return { time: 0.3, yields: [y('seeds', 1, 2)], removes: true, regrow: REGROW.plant, xp: 1, sound: 'bt_rustle' };
  if (plant) {
    const n = tool.kind === 'sickle' ? (metal ? 5 : 3) : 1;
    return { time: tool.kind === 'sickle' ? 0.15 : 0.3, yields: [y('fiber', n, n + (tool.kind === 'sickle' ? 1 : 0)), y('seeds', 1, 1, 0.2)], removes: true, regrow: REGROW.plant, xp: 1, sound: 'bt_rustle' };
  }

  if (ROCK.test(block)) {
    if (tool.kind === 'pick') return { time: metal ? 0.9 : 1.5, yields: metal ? [y('stone', 4, 6), y('flint', 1, 2)] : [y('stone', 2, 3), y('flint', 1, 1, 0.5)], removes: true, regrow: REGROW.rock, xp: 2, sound: 'bt_pick' };
    // Without a pick the rock stays where it is: a loose stone comes off it, slowly.
    return { time: tool.kind === 'hatchet' ? 2 : 2.6, yields: [y('stone', 1), y('flint', 1, 1, 0.3)], removes: false, regrow: 0, xp: 1, sound: 'bt_pick' };
  }
  if (block === 'coal_ore') {
    if (tool.kind !== 'pick') return { refuse: 'Needs a pick' };
    return { time: metal ? 1 : 1.8, yields: [y('flint', metal ? 3 : 2, metal ? 5 : 3), y('stone', 1)], removes: true, regrow: REGROW.ore, xp: 3, sound: 'bt_pick' };
  }
  if (METAL_ROCK.test(block)) {
    if (tool.kind !== 'pick') return { refuse: 'Needs a pick' };
    return { time: metal ? 1.3 : 2.4, yields: [y('metal_ore', metal ? 3 : 1, metal ? 4 : 2), y('stone', 1)], removes: true, regrow: REGROW.ore, xp: 4, sound: 'bt_pick' };
  }
  if (CRYSTAL_ROCK.test(block)) {
    if (tool.kind !== 'pick' || !metal) return { refuse: 'Needs a metal pick' };
    return { time: 1.8, yields: [y('crystal', 2, 3)], removes: true, regrow: REGROW.ore, xp: 6, sound: 'bt_pick' };
  }
  if (OBSIDIAN_ROCK.test(block)) {
    if (tool.kind !== 'pick' || !metal) return { refuse: 'Needs a metal pick' };
    return { time: 2.4, yields: [y('obsidian', 2, 3)], removes: true, regrow: REGROW.ore, xp: 6, sound: 'bt_pick' };
  }

  if (SOIL.test(block)) {
    const stony = block === 'gravel' || block === 'sand' || block === 'clay' || block === 'red_sand' || block === 'ash';
    return {
      time: 1.8,
      yields: stony ? [y('stone', 1), y('flint', 1, 1, 0.5)] : [y('stone', 1, 1, 0.7), y('flint', 1, 1, 0.25), y('fiber', 1, 1, 0.35)],
      removes: false,
      regrow: 0,
      xp: 1,
      sound: 'bt_dig',
    };
  }
  return null;
}

/** A tool guessed from an item's id alone (`stone_pick`, `metal_hatchet`), until the survival part says. */
export function toolFromId(item: string | null | undefined): Tool {
  if (!item) return { kind: 'hand', tier: 0 };
  const kind: ToolKind = item.endsWith('_pick') ? 'pick' : item.endsWith('_hatchet') ? 'hatchet' : item.endsWith('_sickle') ? 'sickle' : 'hand';
  if (kind === 'hand') return { kind, tier: 0 };
  return { kind, tier: item.startsWith('metal_') ? 2 : 1 };
}
