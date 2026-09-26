import { defineShared } from '@platform';
import { buildMap } from '../map';
import meta from './map.meta';

const map = buildMap();

/** Dev preview: the Bed Wars map in the void. Hang in the air; move with player.teleport + debugView (freeze again after). */
export const shared = defineShared({
  ...meta,
  world: { terrain: 'void', structures: map.blueprints, spawn: { x: map.center.x, y: map.center.y + 40, z: map.center.z + 60 }, time: 0.42, freezeTime: true },
  player: { build: true, fly: true, health: false, hotbar: 'blocks' },
});
