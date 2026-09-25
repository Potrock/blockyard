import { Blueprint, defineGame, HeldModels, math, Models, type Entity } from '@platform';
import auctioneer from './models/auctioneer_npc.gltf?url';
import blocky from './models/blocky.gltf?url';
import blockySword from './models/blocky_sword.gltf?url';
import barrier from './models/barrier.gltf?url';
import cards from './models/card_and_token.gltf?url';
import monitor from './models/casino_monitor.gltf?url';
import chair from './models/chair.gltf?url';
import barChair from './models/chair_bar_brown.gltf?url';
import bigWin from './models/game_bigwin.gltf?url';
import slot from './models/game_slot.gltf?url';
import sofa from './models/sofa_red.gltf?url';
import billiards from './models/table_billiards.gltf?url';
import blackjack from './models/table_blackjack.gltf?url';
import roulette from './models/table_roulette.gltf?url';
import vending from './models/vending_machine.gltf?url';

/** The pieces on show, in rows. (Models from the hytopia-casino project's own set, not the HYTOPIA asset pack.) */
const PIECES: [string, string][] = [
  ['Slot machine', slot],
  ['Big win', bigWin],
  ['Vending machine', vending],
  ['Monitor', monitor],
  ['Blackjack', blackjack],
  ['Roulette', roulette],
  ['Billiards', billiards],
  ['Sofa', sofa],
  ['Chair', chair],
  ['Bar stool', barChair],
  ['Barrier', barrier],
  ['Cards and tokens', cards],
];

/** Standing height: the floor's blocks are just below. */
const FLOOR = 64;
const UP = new math.Vector3(0, 1, 0);

/** A casino floor in the void: black tiles, red carpet aisles, lights set in the floor. */
function casinoFloor(): Blueprint {
  const bp = new Blueprint({ x: -16, y: FLOOR - 2, z: -32 }, { x: 33, y: 2, z: 48 });
  bp.fill({ x: -16, y: FLOOR - 2, z: -32 }, { x: 16, y: FLOOR - 2, z: 15 }, 'black_concrete');
  bp.fill({ x: -16, y: FLOOR - 1, z: -32 }, { x: 16, y: FLOOR - 1, z: 15 }, 'black_concrete');
  for (const x of [-3, 3]) bp.fill({ x: x - 1, y: FLOOR - 1, z: -32 }, { x: x + 1, y: FLOOR - 1, z: 15 }, 'red_wool');
  for (let x = -14; x <= 14; x += 7) for (let z = -30; z <= 12; z += 7) bp.set(x, FLOOR - 1, z, 'glowstone');
  return bp;
}
const SPOTS = [
  { x: -6, z: -4 },
  { x: 6, z: -4 },
  { x: 6, z: -16 },
  { x: -6, z: -16 },
];

/** Blockyard's own player as a glTF model (`tests/headless/_export-models.ts` writes it). */
const BLOCKY = Models.gltf(blocky, { clips: { idle: 'idle', walk: 'walk', run: 'run', attack: 'attack' }, head: 'head', hand: 'armR' });

/**
 * Model gallery (a development preview, `?game=gallery`): glTF models as props, labelled, and as
 * figures: an auctioneer standing (a prop looping its idle) and one strolling between the tables
 * (an entity), a runner (walking, then running), players as a glTF model (their first-person arm
 * is its arm), and glTF items: a sword in hand and on the floor, and the cards (held as their
 * model, their icon a picture of it).
 */
export default defineGame({
  id: 'gallery',
  title: 'Model gallery',
  tagline: 'glTF models: props and figures',
  world: { terrain: 'void', structures: [casinoFloor()], spawn: { x: 0.5, y: FLOOR, z: 10 }, spawnYaw: 0, time: 0.35, freezeTime: true },
  player: { fly: true, health: false, hotbar: 'items', model: BLOCKY },

  setup(game) {
    game.items.define('blocky_sword', { kind: 'melee', name: 'Blocky Sword', icon: { gltf: blockySword }, damage: 6, cooldown: 0.45, reach: 3.5, hold: { model: HeldModels.gltf(blockySword, { grip: [0, 0, 2] }) } });
    game.items.define('cards', { kind: 'misc', name: 'Cards and Tokens', icon: { gltf: cards }, hold: { model: HeldModels.gltf(cards, { scale: 0.3, grip: [0, -1, 0] }) } });
    game.entities.define('runner', {
      name: 'Runner',
      model: BLOCKY,
      hitbox: { width: 0.6, height: 1.8 },
      health: 20,
      speed: 3,
      invulnerable: true,
      // Laps the floor: a lap walking, a lap running.
      ai: (self: Entity) => {
        const s = self.data as { spot?: number; laps?: number };
        const spots = [{ x: -12, z: 8 }, { x: 12, z: 8 }, { x: 12, z: -28 }, { x: -12, z: -28 }];
        const to = spots[(s.spot ??= 0)];
        if (Math.hypot(self.position.x - to.x, self.position.z - to.z) < 1.2) {
          s.spot = (s.spot + 1) % spots.length;
          if (s.spot === 0) s.laps = (s.laps ?? 0) + 1;
        }
        self.setSpeed((s.laps ?? 0) % 2 ? 2.2 : 1);
        self.moveTo({ x: to.x, y: FLOOR, z: to.z });
      },
    });
    // Everyone gets the sword and the cards, however late they come.
    game.events.on('playerJoin', ({ player }) => {
      if (!player.inventory.count('blocky_sword')) player.inventory.give('blocky_sword');
      if (!player.inventory.count('cards')) player.inventory.give('cards');
    });
    game.entities.define('auctioneer', {
      name: 'Auctioneer',
      // Blockbench models face -z (north): turned to face +z, the way figures walk.
      model: Models.gltf(auctioneer, { clips: { idle: 'idle' }, head: 'h_head', hand: 'r_rightArm', yaw: Math.PI }),
      hitbox: { width: 0.9, height: 2.9 },
      health: 20,
      speed: 1.6,
      invulnerable: true,
      // Strolls from spot to spot, looking at whoever's nearest.
      ai: (self: Entity) => {
        const s = self.data as { spot?: number };
        const to = SPOTS[(s.spot ??= 0)];
        const d = Math.hypot(self.position.x - to.x, self.position.z - to.z);
        if (d < 1) s.spot = (s.spot + 1) % SPOTS.length;
        self.moveTo({ x: to.x, y: FLOOR, z: to.z });
        const p = self.nearestPlayer();
        if (p && self.distanceTo(p) < 8) self.lookAt(p);
      },
    });
  },

  start(game) {
    const cols = 4;
    PIECES.forEach(([name, url], i) => {
      const model = game.props.gltf(url);
      const x = ((i % cols) - (cols - 1) / 2) * 6;
      const z = -Math.floor(i / cols) * 7 - 2;
      const prop = game.props.spawn(model, { position: { x, y: FLOOR, z } });
      // Their fronts toward the entrance (they face -z, as Blockbench models do).
      prop.quaternion.setFromAxisAngle(UP, Math.PI);
      game.hud.marker(`piece${i}`, prop, { offset: { x: 0, y: 3.4, z: 0 }, shape: 'dot', size: 4, color: '#ffd36b', label: name });
    });
    const standing = game.props.spawn(game.props.gltf(auctioneer, { animation: 'idle' }), { position: { x: 0, y: FLOOR, z: -24 } });
    standing.quaternion.setFromAxisAngle(UP, Math.PI);
    game.hud.marker('standing', standing, { offset: { x: 0, y: 3.4, z: 0 }, shape: 'dot', size: 4, color: '#8fd0ff', label: 'Auctioneer (a prop, idling)' });
    game.entities.spawn('auctioneer', { x: SPOTS[0].x, y: FLOOR, z: SPOTS[0].z });
    game.entities.spawn('runner', { x: -12, y: FLOOR, z: 8 });
    game.items.spawnPickup('blocky_sword', { x: 10, y: FLOOR + 0.5, z: 6 }, { beam: '#ffd36b', despawn: 1e9 });
    for (const p of game.players) {
      p.inventory.give('blocky_sword');
      p.inventory.give('cards');
    }
    game.hud.objective('glTF models: 12 props and an animated figure');
  },
});
