import type { GameDefinition } from '@platform';
import sandbox from './sandbox';
import arena from './arena';
import heartHunt from './heart-hunt';
import starfighter from './starfighter';
import bedwars from './bedwars';

/** Games shown in the launcher, in order. The first is the default. */
export const games: GameDefinition[] = [arena, starfighter, bedwars, sandbox, heartHunt];

/** Dev-only previews (open by id, e.g. `?game=shipyard`; not listed, not in production builds). */
export async function devGames(): Promise<GameDefinition[]> {
  if (!import.meta.env.DEV) return [];
  const [sf, bw, gallery] = await Promise.all([import('./starfighter/previews'), import('./bedwars/previews'), import('./gallery')]);
  return [...sf.previews, ...bw.previews, gallery.default];
}
