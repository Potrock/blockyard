import type { Node } from './core';

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
}
