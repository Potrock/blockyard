/**
 * Voxel platform: the API for a game's code on each player's screen (`src/games/<id>/client.ts`).
 * It never runs on the server, and a game's server code never reaches the browser.
 *
 * ```ts
 * import { defineClient } from '@platform/client';
 * import { shared } from './shared';
 * export default defineClient(shared, { ... });
 * ```
 */
import type { GameMeta, SharedDefinition } from './types';

/** What a game does on each player's screen, beyond its shared definition. */
// (Filled in as the client API grows: the first-person layer, figures, local state, messages.)
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ClientDefinition {}

/** A game as a player's screen runs it: its shared definition and its client code. */
export interface ClientGame {
  readonly shared: SharedDefinition;
  readonly client: ClientDefinition;
}

/** The game on each player's screen (`client.ts`). */
export function defineClient(shared: SharedDefinition, client: ClientDefinition = {}): ClientGame {
  return { shared, client };
}

/**
 * A game in the browser's catalog (`src/games/browser.ts`): what the launcher shows, and how to
 * load the rest when someone picks it (a chunk of its own: its client and shared code).
 */
export interface GameEntry {
  readonly meta: GameMeta;
  load(): Promise<ClientGame>;
}
