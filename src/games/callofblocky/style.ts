import type { GltfSpec } from '@platform';

/**
 * How the platform draws and moves the voxel fighters (`Models.gltf` options), for their chunky
 * proportions (a big head, big fists):
 *
 * - `heldScale` 0.68 (the platform's 0.52): guns big enough in those fists to read, as the voxel
 *   figures this look comes from carry them; a pistol is held as one under 0.6 m as held.
 * - The rifle at the hip and aimed held further out and lower, clear of the big head.
 * - First person: the arms a little under the platform's size, the fists smaller again (`hands`),
 *   so life-size hands close on the grips with forearms of a proper thickness (the figures' own
 *   fists, drawn to match the gun, would fill the screen).
 * - The feet as far apart as the hips.
 */
export const FIGHTER_STYLE: Pick<GltfSpec, 'firstPerson' | 'poses'> = {
  firstPerson: { scale: 0.78, hands: 0.7 },
  poses: {
    heldScale: 0.68,
    pistolUnder: 0.6,
    gait: { width: 0.15 },
    rifle: { hip: [-0.13, -0.22, 0.32], ads: [-0.05, -0.12, 0.36] },
  },
};
