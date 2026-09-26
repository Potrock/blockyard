import { defineShared } from '@platform';
import { MAP } from '../map';
import meta from './map.meta';

/** Dev preview: Jackrabbit Lane on its own, to fly round (double-tap Space, or F), frozen at the map's time. */
export const shared = defineShared({
  ...meta,
  world: {
    seed: MAP.seed,
    structures: MAP.structures,
    terraform: MAP.terraform,
    spawn: MAP.spawns[0],
    spawnYaw: MAP.spawns[0].yaw,
    time: MAP.time,
    freezeTime: true,
  },
  player: { health: false, fly: true, hotbar: 'items' },
});
