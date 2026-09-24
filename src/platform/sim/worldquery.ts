import * as engine from '@engine/voxel_engine.js';
import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { VehicleWorld } from '../api/types';
import type { Registry } from '../world/registry';

/** Highest non-air, non-plant block in a column (-1 if it isn't loaded). */
export function surfaceY(world: VoxelWorld, registry: Registry, x: number, z: number): number {
  for (let y = 255; y > 0; y--) {
    const id = world.get_block(x, y, z);
    if (id === 255) return -1;
    const d = registry.blocks[id];
    if (d && d.shape !== 'air' && d.shape !== 'cross') return y;
  }
  return 0;
}

/**
 * Read-only questions about a world: the host's, or a client's copy of it. A vehicle's `step`
 * asks the same questions on both, so a pilot's screen predicts what the host will do.
 */
export function worldQuery(world: VoxelWorld, registry: Registry): VehicleWorld {
  return {
    getBlock: (x, y, z) => {
      const id = world.get_block(Math.floor(x), Math.floor(y), Math.floor(z));
      return id === 255 ? -1 : id;
    },
    blockName: (id) => registry.blocks[id]?.name ?? 'unknown',
    raycast: (o, d, max) => {
      const r = world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, max);
      return r[0] ? { x: r[1], y: r[2], z: r[3], normal: { x: r[4], y: r[5], z: r[6] }, block: r[7] } : null;
    },
    lineOfSight: (a, b) => world.line_clear(a.x, a.y, a.z, b.x, b.y, b.z),
    surfaceY: (x, z) => surfaceY(world, registry, Math.floor(x), Math.floor(z)),
    seaLevel: engine.sea_level(),
  };
}
