import { defineShared } from '@platform';
import { MAPS, WORLD } from '../map';
import meta from './map.meta';

/**
 * Dev preview: the maps on their own, to fly round (double-tap Space, or F), in their world and
 * at their time of day. It starts on Jackrabbit Lane; `/tp 512 70 30` goes to Big Kahuna Burger.
 */
export const shared = defineShared({
  ...meta,
  world: {
    seed: WORLD.seed,
    terrain: 'void',
    ground: { y: WORLD.floorY - 1, top: 'grass_block', fill: 'dirt', depth: 10 },
    structures: WORLD.structures,
    terraform: WORLD.terraform,
    spawn: MAPS[0].spawns[0],
    spawnYaw: MAPS[0].spawns[0].yaw,
    time: WORLD.time,
    freezeTime: true,
  },
  player: { health: false, fly: true, hotbar: 'items' },
});
