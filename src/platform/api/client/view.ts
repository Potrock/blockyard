import type { Node } from './core';
import type { Vec3 } from './math';

/**
 * The first-person layer: drawn over the world with its own lens, lit by the light where the
 * player's eyes are. The engine loads what's in hand and builds the player's arms; a kit places
 * them (see `firstPerson.standard()`).
 *
 * (Phase 2: the first-person agent fills this in: `held`, `arms`, `sprite`, the camera.)
 */
export interface ViewLayer {
  /** Everything in the layer hangs from this. */
  readonly root: Node;
  /**
   * A named point of the held item on show (`'muzzle'`), in the world, as it's drawn this frame
   * (into `out`, if given); null when nothing's in hand or it has no such point.
   */
  worldPoint(name: string, out?: Vec3): Vec3 | null;
}
