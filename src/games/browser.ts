import type { GameDefinition } from '@platform';
import { defineClient, type GameEntry } from '@platform/client';
import { devGames as allDev, games as all } from './index';

// TRANSITIONAL (phase 1 contract): until each game is split into meta / shared / server / client,
// the catalog wraps the whole definitions. Its exports are final: the runtime reads only these.

const entry = (g: GameDefinition): GameEntry => ({
  meta: { id: g.id, title: g.title, tagline: g.tagline, accent: g.accent, controls: g.controls, gamepad: g.gamepad, instances: g.instances },
  load: async () => defineClient(g),
});

/** The browser's catalog: the games the launcher lists, in order (the first is the default). Each loads its client code when picked. */
export const games: GameEntry[] = all.map(entry);

/** Development-only games (open by id, `?game=gallery`; not listed, not in production builds). */
export async function devGames(): Promise<GameEntry[]> {
  return (await allDev()).map(entry);
}
