import type { GameDefinition } from '@platform';
import { devGames as allDev, games as all } from './index';

// TRANSITIONAL (phase 1 contract): until each game is split, this re-exports the whole definitions.
// Its exports are final: the server and the headless tests read only these.

/** The games a server hosts, as it runs them (shared definition and rules). */
export const games: GameDefinition[] = all;

/** Development-only games (a development server hosts them when named; the headless tests use them). */
export async function devGames(): Promise<GameDefinition[]> {
  return allDev();
}
