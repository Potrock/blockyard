import type { VoxelWorld } from '@engine/voxel_engine.js';

/**
 * Where the simulation's blocks live and how edits land: the host's own world (columns generated
 * around the players), which also tells the clients about each edit so they can mirror it.
 */
export interface WorldHost {
  readonly world: VoxelWorld;
  /** Set one block. False if its chunk isn't loaded. */
  edit(x: number, y: number, z: number, id: number): boolean;
  /** Set many (explosions) so they appear together; returns how many changed. */
  editMany(cells: [number, number, number, number][]): number;
  /** Undo every edit this session (restart): blocks put back, whole. */
  revert(): number;
  /**
   * Carve little voxels out of destructible blocks (`VoxelWorld.carve`): a channel from `o` along
   * `d`, `radius` round and `depth` long. Returns how many went, and the blocks carved to nothing
   * (air now, as edits): where, and what they were.
   */
  carve(o: [number, number, number], d: [number, number, number], radius: number, depth: number): { removed: number; emptied: [number, number, number, number][] };
}
