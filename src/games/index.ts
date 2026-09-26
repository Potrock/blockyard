import type { GameDefinition } from '@platform';
import { devGames as serverDevGames } from './server';

// TEMPORARY (phase 1): for what still imports './games' (src/main.ts, src/sim.worker.ts, src/server.ts,
// tests/headless/_harness.ts) until they read `./games/browser` or `./games/server`. Delete it then.
export { games } from './server';

/** Dev-only previews, in development only (as before the split). */
export async function devGames(): Promise<GameDefinition[]> {
  if (!import.meta.env.DEV) return [];
  return serverDevGames();
}
