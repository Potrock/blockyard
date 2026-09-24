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
  /** Undo every edit this session (restart). */
  revert(): number;
}
