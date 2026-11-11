import type { GameContext } from '@platform';

/**
 * One part of the game's rules (the creatures, survival, building, the island). `server.ts` runs
 * every part's hooks in a fixed order, so a part never needs to know where it sits among the rest.
 */
export interface Part {
  /** Once, before the world streams in: define items and entity types, listen for events. */
  setup?(game: GameContext): void;
  /** When play begins, and again after a restart: reset the part's state. */
  start?(game: GameContext): void;
  /** Every step while the game runs. */
  update?(game: GameContext, dt: number): void;
}
