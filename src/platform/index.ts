/**
 * Voxel platform: public API for games.
 *
 * ```ts
 * import { defineGame, Blueprint, Models, Skins, Behaviors } from '@platform';
 * export default defineGame({ id: 'my-game', title: 'My Game', setup(game) { ... } });
 * ```
 * See docs/PLATFORM.md for a guide.
 */
export * from './api/types';
export { Blueprint } from './api/blueprint';
export { Models, Skins, HeldModels } from './api/models';
export { Behaviors } from './api/behaviors';
export * as vec from './api/vec';
export * as math from './api/math';

import type { GameDefinition } from './api/types';

/** Identity helper that gives game definitions full type checking and editor completion. */
export function defineGame(def: GameDefinition): GameDefinition {
  return def;
}
