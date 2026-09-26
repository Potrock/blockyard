import type { ClientKit } from '@platform/client';
import * as firstPerson from './firstperson';
import * as figures from './figures';
import * as hud from './hud';
import * as effects from './effects';
import * as sounds from './sounds';

/**
 * Every kit the platform has, as its games have always looked and sounded (while phase 2 moves the
 * engine's presentation into kits, each game's `client.ts` uses this; then they list their own).
 */
export function standardKits(): ClientKit[] {
  return [...sounds.standard(), ...firstPerson.standard(), ...figures.standard(), ...hud.standard(), ...effects.standard()];
}
