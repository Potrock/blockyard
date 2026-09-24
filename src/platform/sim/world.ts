import type { VoxelWorld } from '@engine/voxel_engine.js';

/**
 * Where the simulation's blocks live and how edits land. In the browser the chunk streamer
 * provides it (an edit also remeshes and relights what it touches); headless, it's a plain block
 * store with columns generated around the players.
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
