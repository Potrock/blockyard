import { defineShared } from '@platform';
import { tieFighter, tieInterceptor, xwing } from '../ships';
import meta from './shipyard.meta';

// Dev preview for ship builds: each ship stamped full size (1 block = 1 m here) on a flat world.
// X-wing at x = -70, TIE fighter at x = 0, TIE interceptor at x = 70, centres at y = 90.
const Y = 90;
export const shared = defineShared({
  ...meta,
  world: {
    terrain: 'flat',
    flatHeight: 64,
    structures: [xwing().blueprint.moved({ x: -70, y: Y, z: 0 }), tieFighter().blueprint.moved({ x: 0, y: Y, z: 0 }), tieInterceptor().blueprint.moved({ x: 70, y: Y, z: 0 })],
    spawn: { x: 0.5, y: Y + 10, z: 70.5 },
    time: 0.42,
    freezeTime: true,
  },
  player: { build: true, fly: true, health: false, hotbar: 'blocks' },
});
