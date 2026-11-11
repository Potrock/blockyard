import type { BlockDefinition, WorldOptions } from '@platform';
import { blocks as islandBlocks } from './blocks';
import { CELL, ORIGIN, SIZE, Z, islandMap } from './map';
import { PALETTE } from './zones';

/**
 * The island's world for the shared definition: a map world (the platform's `terrain: 'map'`)
 * whose land is the island's grids. The grids are built when a world is first made, on the
 * server and on each screen, from the same seed.
 */
export const world: WorldOptions = {
  // The engine's own noise (fine detail, caves, where each tree stands) comes from this.
  seed: 20261111,
  terrain: 'map',
  map: () => {
    const { heights, zones, water } = islandMap();
    return { origin: { x: ORIGIN, z: ORIGIN }, cell: CELL, width: SIZE, depth: SIZE, heights, zones, water, palette: PALETTE, outside: { height: 30, zone: Z.ocean } };
  },
  persist: true,
  // Castaway Shore, looking north up the beach to the plains.
  spawn: { x: 0.5, y: 65.1, z: 2248.5 },
  spawnYaw: 0,
  time: 0.3,
  // The island is big country: see a fair way across it (a phone holds itself to less).
  viewDistance: 16,
};

/** The island's blocks (ore, crystal, obsidian, berry bushes...): 14 variants of the game's 24. */
export const blocks: Record<string, BlockDefinition> = islandBlocks;
