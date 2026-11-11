import type { BlockDefinition, WorldOptions } from '@platform';

/** The island's world options and its own blocks, for the shared definition. PLACEHOLDER until the island part lands. */
export const world: WorldOptions = { seed: 20261111, spawn: 'auto', time: 0.3 };

/** The island's blocks (ore, crystal, obsidian, berry bushes...): at most 24 variants. */
export const blocks: Record<string, BlockDefinition> = {};
