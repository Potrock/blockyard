import { Blueprint, defineGame, HeldModels, HumanoidJoints, math, Models, type BlockDefinition, type BlockTexture, type Entity } from '@platform';
import auctioneer from './models/auctioneer_npc.gltf?url';
import blocky from './models/blocky.gltf?url';
import blockySword from './models/blocky_sword.gltf?url';
import barrier from './models/barrier.gltf?url';
import cards from './models/card_and_token.gltf?url';
import monitor from './models/casino_monitor.gltf?url';
import chair from './models/chair.gltf?url';
import mannequin from './models/mannequin.glb?url';
import mannequinMixamo from './models/mannequin_mixamo.glb?url';
import mannequinSkinned from './models/mannequin_skinned.glb?url';
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
/** Rungs on two rails, the rest clear (a ladder's texture). */
const LADDER: BlockTexture = {
  paint: (x, y) => (x === 2 || x === 3 || x === 12 || x === 13 ? (x % 2 ? '#6b4a2b' : '#7d5733') : x > 1 && x < 14 && y % 4 < 2 ? (y % 4 ? '#7a5530' : '#8a6238') : null),
};

/** A picture of a sun over hills, framed (a poster's front). */
const POSTER: BlockTexture = {
  paint: (x, y) => {
    if (x === 0 || x === 15 || y === 0 || y === 15) return '#5a3a1e';
    if ((x - 10) ** 2 + (y - 4) ** 2 < 7) return '#ffd84a';
    if (y > 10 + 2 * Math.sin(x * 0.45)) return '#3b7a2c';
    if (y > 8 + 2.5 * Math.sin(x * 0.35 + 2)) return '#5aa845';
    return y < 4 ? '#7cc6f2' : '#9ad6f7';
  },
};

/** Lines of writing on a board (a sign's front; the board is the texture's upper half). */
const SIGN: BlockTexture = {
  paint: (x, y) => ((y === 2 || y === 4 || y === 6) && x > 1 && x < 14 && (x * 7 + y * 3) % 5 !== 0 ? '#3a2412' : (x + y) % 5 ? '#b08a55' : '#a27d4a'),
};

/** Stone with a fire behind a grate (a stove's front). */
const STOVE: BlockTexture = {
  paint: (x, y) => {
    if (x > 2 && x < 13 && y > 6 && y < 14) return y > 10 ? (x % 2 ? '#ff9d2e' : '#ffcf4a') : y === 7 || x % 3 === 0 ? '#2a2a2a' : '#121212';
    return (x * 5 + y * 3) % 7 ? '#8b8b8b' : '#6f6f6f';
  },
};

/** Leaves hanging down a stem, mostly clear (a vine). */
const VINE: BlockTexture = {
  paint: (x, y) => (x === 8 || (x * 13 + y * 7) % 5 < 2 ? ((x + y) % 3 ? '#3f8f2f' : '#2f7324') : null),
};

/** Iron bars: uprights and two crossbars, the rest clear. */
const BARS: BlockTexture = { paint: (x, y) => (x % 4 === 1 || y === 2 || y === 13 ? (y % 2 ? '#5b6168' : '#4a4f55') : null) };

/**
 * Blocks of shapes of the game's own, a yard of them to the east of the casino floor: a fence
 * (joins fences and solid blocks, 1.5 high to bodies), panes (thin walls that join), beams (a post
 * with an axis), a ladder you climb, a poster and a sign that face a way, a stove with a front, a
 * vine, and a table and chairs made of boxes.
 */
const SHAPES: Record<string, BlockDefinition> = {
  picket_fence: { label: 'Picket Fence', texture: 'oak_planks', shape: 'fence', hardness: 1 },
  glass_pane: { texture: 'glass', shape: 'pane', transparency: 'cutout' },
  iron_bars: { texture: BARS, shape: 'pane', transparency: 'cutout' },
  beam: { label: 'Oak Beam', texture: { top: 'oak_log_top', bottom: 'oak_log_top', side: 'oak_log' }, shape: 'post', facing: 'axis' },
  ladder: { texture: LADDER, boxes: [[0, 0, 14, 16, 16, 16]], facing: true, climbable: true, transparency: 'cutout' },
  poster: { texture: { front: POSTER, all: 'oak_planks' }, boxes: [[1, 2, 15, 15, 14, 16]], facing: true, solid: false },
  sign: { texture: { front: SIGN, all: 'oak_planks' }, boxes: [[0, 7, 7, 16, 16, 9], [7, 0, 7, 9, 7, 9]], facing: true, solid: false },
  stove: { texture: { front: STOVE, top: 'stone', all: 'cobblestone' }, facing: true },
  vine: { texture: VINE, shape: 'cross', climbable: true },
  table: { texture: 'oak_planks', boxes: [[0, 13, 0, 16, 16, 16], [1, 0, 1, 3, 13, 3], [13, 0, 1, 15, 13, 3], [1, 0, 13, 3, 13, 15], [13, 0, 13, 15, 13, 15]] },
  chair: {
    texture: 'spruce_planks',
    // Facing north: its back to the south.
    boxes: [[3, 0, 3, 5, 8, 5], [11, 0, 3, 13, 8, 5], [3, 0, 11, 5, 8, 13], [11, 0, 11, 13, 8, 13], [3, 8, 3, 13, 10, 13], [3, 10, 11, 13, 16, 13]],
    facing: true,
  },
};

/** The yard of block shapes, east of the casino floor: a hut with a ladder up it, a pergola, a fence round it all. */
function shapesYard(): Blueprint {
  const [x0, x1, z0, z1] = [17, 33, -10, 14];
  const bp = new Blueprint({ x: x0, y: FLOOR - 2, z: z0 }, { x: x1 - x0 + 1, y: 9, z: z1 - z0 + 1 });
  bp.fill({ x: x0, y: FLOOR - 2, z: z0 }, { x: x1, y: FLOOR - 2, z: z1 }, 'dirt');
  bp.fill({ x: x0, y: FLOOR - 1, z: z0 }, { x: x1, y: FLOOR - 1, z: z1 }, 'grass_block');
  bp.fill({ x: x0, y: FLOOR - 1, z: 0 }, { x: 21, y: FLOOR - 1, z: 0 }, 'gravel');
  // A fence round three sides, into stone brick pillars at the corners, a gap on the south.
  for (let x = x0; x <= x1; x++) {
    bp.set(x, FLOOR, z0, 'picket_fence');
    if (x < 20 || x > 22) bp.set(x, FLOOR, z1, 'picket_fence');
  }
  for (let z = z0; z <= z1; z++) bp.set(x1, FLOOR, z, 'picket_fence');
  for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) bp.fill({ x, y: FLOOR, z }, { x, y: FLOOR + 1, z }, 'stone_bricks');
  // The hut: plank walls on log corners, a plank roof, a door on the west.
  const [hx0, hx1, hz0, hz1] = [22, 28, -4, 2];
  bp.fill({ x: hx0, y: FLOOR - 1, z: hz0 }, { x: hx1, y: FLOOR - 1, z: hz1 }, 'oak_planks');
  bp.fill({ x: hx0, y: FLOOR, z: hz0 }, { x: hx1, y: FLOOR + 3, z: hz1 }, 'spruce_planks');
  bp.fill({ x: hx0 + 1, y: FLOOR, z: hz0 + 1 }, { x: hx1 - 1, y: FLOOR + 3, z: hz1 - 1 }, 'air');
  for (const [x, z] of [[hx0, hz0], [hx1, hz0], [hx1, hz1], [hx0, hz1]]) bp.fill({ x, y: FLOOR, z }, { x, y: FLOOR + 3, z }, 'oak_log');
  bp.fill({ x: hx0, y: FLOOR + 4, z: hz0 }, { x: hx1, y: FLOOR + 4, z: hz1 }, 'oak_planks');
  bp.set(25, FLOOR + 4, -1, 'sea_lantern');
  bp.fill({ x: hx0, y: FLOOR, z: 0 }, { x: hx0, y: FLOOR + 1, z: 0 }, 'air');
  // Windows: glass panes on the south, iron bars on the west.
  bp.fill({ x: 24, y: FLOOR + 1, z: hz1 }, { x: 26, y: FLOOR + 2, z: hz1 }, 'glass_pane');
  bp.fill({ x: hx0, y: FLOOR + 1, z: -3 }, { x: hx0, y: FLOOR + 2, z: -2 }, 'iron_bars');
  // A ladder up the east wall to the roof; a poster on the south wall; a vine down the north.
  for (let y = FLOOR; y <= FLOOR + 4; y++) bp.set(hx1 + 1, y, -1, 'ladder[facing=east]');
  bp.set(27, FLOOR + 1, hz1 + 1, 'poster[facing=south]');
  for (let y = FLOOR + 1; y <= FLOOR + 3; y++) bp.set(25, y, hz0 - 1, 'vine');
  // Inside: a stove facing the door, a table and two chairs.
  bp.set(27, FLOOR, -3, 'stove[facing=west]');
  bp.set(25, FLOOR, -1, 'table');
  bp.set(24, FLOOR, -1, 'chair[facing=east]');
  bp.set(26, FLOOR, -1, 'chair[facing=west]');
  // A pergola: upright beams, beams across the top, a table and chairs under it.
  for (const [x, z] of [[19, 5], [24, 5], [19, 10], [24, 10]]) bp.fill({ x, y: FLOOR, z }, { x, y: FLOOR + 2, z }, 'beam');
  for (let x = 19; x <= 24; x++) for (const z of [5, 10]) bp.set(x, FLOOR + 3, z, 'beam[axis=x]');
  for (let z = 6; z <= 9; z++) for (const x of [19, 24]) bp.set(x, FLOOR + 3, z, 'beam[axis=z]');
  bp.set(21, FLOOR, 7, 'table');
  bp.set(21, FLOOR, 8, 'chair[facing=north]');
  bp.set(22, FLOOR, 7, 'table');
  bp.set(22, FLOOR, 6, 'chair[facing=south]');
  bp.set(21, FLOOR, 6, 'chair[facing=south]');
  bp.set(22, FLOOR, 8, 'chair[facing=north]');
  // A sign at the gate, facing the casino.
  bp.set(18, FLOOR, 1, 'sign[facing=west]');
  return bp;
}

const SPOTS = [
  { x: -6, z: -4 },
  { x: 6, z: -4 },
  { x: 6, z: -16 },
  { x: -6, z: -16 },
];

/**
 * Figures on the humanoid rig (`scripts/mannequin.mjs` makes them): rigid parts; one skinned
 * mesh; and the same skin on a Mixamo-style skeleton (resting in a T-pose, its bones named and
 * turned its own way), which `joints` maps onto the rig. The skinned ones have `wave` and `cheer` clips.
 */
const MANNEQUINS: { id: string; label: string; model: ReturnType<typeof Models.gltf> }[] = [
  { id: 'mannequin', label: 'Rigid mannequin', model: Models.gltf(mannequin, { rig: 'humanoid' }) },
  { id: 'mannequin_skinned', label: 'Skinned mannequin', model: Models.gltf(mannequinSkinned, { rig: 'humanoid' }) },
  { id: 'mannequin_mixamo', label: 'Mixamo-style skeleton', model: Models.gltf(mannequinMixamo, { rig: 'humanoid', joints: HumanoidJoints.mixamo() }) },
];

/** Blockyard's own player as a glTF model (`tests/headless/_export-models.ts` writes it). */
const BLOCKY = Models.gltf(blocky, { clips: { idle: 'idle', walk: 'walk', run: 'run', attack: 'attack' }, head: 'head', hand: 'armR' });

/**
 * Model gallery (a development preview, `?game=gallery`): glTF models as props, labelled, and as
 * figures: an auctioneer standing (a prop looping its idle) and one strolling between the tables
 * (an entity), a runner (walking, then running), players as a glTF model (their first-person arm
 * is its arm), and glTF items: a sword in hand and on the floor, and the cards (held as their
 * model, their icon a picture of it); and humanoids on the platform's rig pacing the front aisle
 * (rigid, skinned, and a Mixamo-style skeleton), waving as they go (a clip over the upper body),
 * and one cheering (a clip over the whole body).
 */
export default defineGame({
  id: 'gallery',
  title: 'Model gallery',
  tagline: 'glTF models: props and figures',
  world: { terrain: 'void', structures: [casinoFloor(), shapesYard()], spawn: { x: 0.5, y: FLOOR, z: 10 }, spawnYaw: 0, time: 0.35, freezeTime: true },
  player: { fly: true, health: false, hotbar: 'items', model: BLOCKY },
  blocks: SHAPES,

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
    for (const m of MANNEQUINS) {
      game.entities.define(m.id, {
        name: m.label,
        model: m.model,
        hitbox: { width: 0.6, height: 1.85 },
        health: 20,
        speed: 1.8,
        invulnerable: true,
        // Paces the aisle, waving for a while every few seconds (the skinned ones: the rigid one has no clips).
        ai: (self: Entity, _game, dt) => {
          const s = self.data as { home: number; dir?: number; t?: number; waving?: boolean };
          s.dir ??= 1;
          if (Math.abs(self.position.x - s.home) > 3) s.dir = self.position.x > s.home ? -1 : 1;
          self.moveTo({ x: s.home + s.dir * 3.5, y: FLOOR, z: 3.5 });
          s.t = (s.t ?? 0) + dt;
          const wave = s.t % 7 > 4;
          if (wave !== !!s.waving) {
            s.waving = wave;
            self.animate(wave ? 'wave' : 'none', { layer: 'upper', loop: true, fade: 0.3 });
          }
        },
      });
    }
    game.entities.define('cheerer', {
      name: 'Cheering mannequin',
      model: MANNEQUINS[1].model,
      hitbox: { width: 0.6, height: 1.85 },
      health: 20,
      speed: 0,
      invulnerable: true,
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
    MANNEQUINS.forEach((m, i) => {
      const home = (i - 1) * 7.5;
      const e = game.entities.spawn(m.id, { x: home, y: FLOOR, z: 3.5 }, { data: { home } });
      game.hud.marker(`mannequin${i}`, e, { offset: { x: 0, y: 2.3, z: 0 }, shape: 'dot', size: 4, color: '#b6f09c', label: m.label });
    });
    const cheerer = game.entities.spawn('cheerer', { x: 5, y: FLOOR, z: -24 }, { yaw: 0 });
    cheerer.animate('cheer', { loop: true });
    game.hud.marker('cheerer', cheerer, { offset: { x: 0, y: 2.4, z: 0 }, shape: 'dot', size: 4, color: '#b6f09c', label: 'Skinned, cheering (a full-body clip)' });
    game.items.spawnPickup('blocky_sword', { x: 10, y: FLOOR + 0.5, z: 6 }, { beam: '#ffd36b', despawn: 1e9 });
    for (const p of game.players) {
      p.inventory.give('blocky_sword');
      p.inventory.give('cards');
    }
    // The block shapes yard, labelled.
    const shapes: [string, number, number, number][] = [
      ['Fence: joins fences and walls', 32.5, FLOOR + 1.4, -3.5],
      ['Ladder: climb it', 29.5, FLOOR + 5.4, -0.5],
      ['Panes: glass, iron bars', 25.5, FLOOR + 3.3, 2.5],
      ['Poster, facing south', 27.5, FLOOR + 1.9, 3.5],
      ['Beams (posts), tables and chairs (boxes)', 21.5, FLOOR + 4.4, 7.5],
      ['Sign, facing west', 18.5, FLOOR + 1.3, 1.5],
      ['Vine: climb it', 25.5, FLOOR + 4.3, -4.5],
    ];
    shapes.forEach(([label, x, y, z], i) => game.hud.marker(`shape${i}`, { x, y, z }, { shape: 'dot', size: 4, color: '#ffb36b', label }));
    game.hud.objective('glTF models: 12 props and an animated figure · block shapes to the east');
  },
});
