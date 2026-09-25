import { Blueprint, defineGame, math } from '@platform';
import { MAP } from './map';
import { GUNS } from './models';

/**
 * Dev-only previews (never in production builds):
 * - `?game=cob-map`: Jackrabbit Lane on its own, to fly round (double-tap Space, or F), frozen at the map's time.
 * - `?game=cob-guns`: the gun models on pedestals in a lit room, each slowly turning.
 */
const mapPreview = defineGame({
  id: 'cob-map',
  title: 'Call of Blocky: map',
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

const FLOOR = 64;
/** A dark gallery floor with pedestals in a row along x, one per gun. */
function room(n: number): Blueprint {
  const w = n * 4 + 8;
  const bp = new Blueprint({ x: -4, y: FLOOR - 1, z: -8 }, { x: w, y: 10, z: 14 });
  bp.fill({ x: -4, y: FLOOR - 1, z: -8 }, { x: w - 5, y: FLOOR - 1, z: 5 }, 'black_concrete');
  bp.fill({ x: -4, y: FLOOR + 8, z: -8 }, { x: w - 5, y: FLOOR + 8, z: 5 }, 'black_concrete');
  bp.fill({ x: -4, y: FLOOR, z: -8 }, { x: w - 5, y: FLOOR + 7, z: -8 }, 'white_concrete');
  for (let i = 0; i < n; i++) {
    const x = i * 4;
    bp.fill({ x, y: FLOOR, z: -1 }, { x: x + 1, y: FLOOR, z: 0 }, 'yellow_concrete');
    bp.set(x, FLOOR + 8, -2, 'sea_lantern');
    bp.set(x + 1, FLOOR + 8, 1, 'sea_lantern');
  }
  return bp;
}

const gunPreview = defineGame({
  id: 'cob-guns',
  title: 'Call of Blocky: guns',
  world: { terrain: 'void', structures: [room(GUNS.length)], spawn: { x: 6, y: FLOOR, z: 4 }, spawnYaw: 0, time: 0.5, freezeTime: true },
  player: { health: false, fly: true, hotbar: 'items' },
  start(game) {
    GUNS.forEach((g, i) => {
      const model = game.props.gltf(g.url, { scale: 2 });
      const prop = game.props.spawn(model, { position: { x: i * 4 + 1, y: FLOOR + 1.6, z: 0 } });
      let a = 0;
      game.clock.every(1 / 30, () => {
        a += 0.02;
        prop.quaternion.setFromAxisAngle(new math.Vector3(0, 1, 0), a);
      });
      game.hud.marker(`gun${i}`, { x: i * 4 + 1, y: FLOOR + 3.2, z: 0 }, { label: g.name, shape: 'dot', size: 3 });
    });
  },
});

export const previews = [mapPreview, gunPreview];
