import { defineGame } from '@platform';
import { buildDestroyer } from '../destroyer';
import { DESTROYER_CENTER, SEED } from '../layout';

// Dev preview: the capital ship in place over the battle terrain. Hang in the air and move the
// camera with player.teleport + debugView (teleport unfreezes: freeze again after).
export default defineGame({
  id: 'drydock',
  title: 'Drydock (dev preview)',
  tagline: 'The capital ship in place',
  world: { seed: SEED, structures: [buildDestroyer(DESTROYER_CENTER).blueprint], spawn: { x: -99.5, y: 150, z: 40.5 }, time: 0.42, freezeTime: true },
  player: { build: true, fly: true, health: false, hotbar: 'blocks' },
  start: (game) => game.player.freeze(true),
});
