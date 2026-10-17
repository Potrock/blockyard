import { prefs } from './prefs';

/**
 * Quick movement and quick combat, Civilization V's options (the player's preferences): how much
 * faster units' marches and fights play than they're drawn to (1 as they are), or 0 for not at all,
 * where what they show is simply there.
 */

const SPEED = { normal: 1, fast: 3, skip: 0 } as const;

/** How fast marches play (0: units are simply where they went). */
export const marchSpeed = () => SPEED[prefs.moves];

/** How fast fights play (0: no lunge or volley, the blow lands at once). */
export const combatSpeed = () => SPEED[prefs.combat];
