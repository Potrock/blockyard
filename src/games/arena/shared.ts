import { defineShared } from '@platform';
import meta from './meta';
import { buildArena, FLOOR } from './structure';

/** The middle of the arena floor, on the dais: where everyone starts, and comes back to. */
export const CENTER = { x: 0.5, y: FLOOR + 2, z: 0.5 };

/** The colosseum (every screen builds its blocks too) and the player. */
export const shared = defineShared({
  ...meta,
  world: {
    // No landscape to make: the arena stands on a plain ground over the void (below its rim, so
    // from inside it's all sky), and nothing past the haze is loaded.
    terrain: 'void',
    ground: { y: FLOOR, top: 'grass_block', fill: 'dirt', depth: 4 },
    maxViewDistance: 8,
    structures: [buildArena()],
    spawn: { x: CENTER.x, y: CENTER.y + 0.05, z: CENTER.z },
    spawnYaw: 0,
    time: 0.66,
    freezeTime: true,
  },
  player: { health: 20, regen: { delay: 6, perSecond: 0.35 }, fallDamage: true, hotbar: 'items' },
});
