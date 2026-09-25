import { readFileSync } from 'node:fs';
import { Blueprint, Models, Skins, defineGame, type Prop } from '../../src/platform';
import type { BlockRef } from '../../src/platform/api/types';
import { ClientMovers } from '../../src/platform/client/movers';
import { Predictor } from '../../src/platform/client/predict';
import { Content } from '../../src/platform/content';
import { GameHost, GeneratedWorld } from '../../src/platform/host/game';
import { worldGenConfig } from '../../src/platform/host/spawn';
import type { HostBatch, PlayerInput } from '../../src/platform/net/protocol';
import { loadRegistry } from '../../src/platform/world/registry';
import { check } from './_harness';

const engine = readFileSync('engine/pkg/voxel_engine_bg.wasm');

/** A 12 x 1 x 16 deck with a rail at the back, its origin at the middle of its top face. */
const deckPlan = new Blueprint({ x: 0, y: 0, z: 0 }, { x: 12, y: 2, z: 16 }).fill({ x: 0, y: 0, z: 0 }, { x: 11, y: 0, z: 15 }, 'oak_planks').fill({ x: 0, y: 1, z: 15 }, { x: 11, y: 1, z: 15 }, 'oak_planks');

let deck: Prop;
let wall: Prop;
/** How the deck moves: `sail` seconds in, where it is and which way it faces. */
let sail: (t: number, deck: Prop) => void = () => {};

const game = defineGame({
  id: 'movers-test',
  title: 'Movers',
  world: { terrain: 'flat', flatHeight: 64, spawn: { x: 0.5, y: 90, z: 0.5 }, time: 0.5, freezeTime: true },
  player: { health: false, hotbar: 'items' },
  setup(g) {
    g.entities.define('dummy', { name: 'Dummy', model: Models.humanoid({ skin: Skins.player }), hitbox: { width: 0.6, height: 1.8 }, health: 20, speed: 3 });
    g.items.define('gem', { kind: 'misc', name: 'Gem', icon: 'heart' });
  },
  start(g) {
    const model = g.props.model(deckPlan, { pivot: { x: 6, y: 1, z: 8 } });
    deck = g.props.spawn(model, { position: { x: 0, y: 80, z: 0 }, solid: true });
    const slab = g.props.model(new Blueprint({ x: 0, y: 0, z: 0 }, { x: 1, y: 3, z: 6 }).fill({ x: 0, y: 0, z: 0 }, { x: 0, y: 2, z: 5 }, 'stone'), { pivot: { x: 0, y: 0, z: 3 } });
    wall = g.props.spawn(slab, { position: { x: 30, y: 65, z: 0 }, solid: true });
  },
  update(g) {
    sail(g.clock.now, deck);
  },
});

export default function movers() {
  riding();
  predicting();
}

/** On the host: standing, riding, turning, a creature aboard, a wall that shoves, rays. */
function riding() {
  const host = new GameHost(game, { engine, seed: 7, remote: true, radius: 4, budget: Infinity });
  const g = host.sim.ctx;
  const ann = host.connect('Ann');
  host.command(ann.id, { t: 'start' });
  const me = g.players[0];
  const step = (n: number) => {
    for (let i = 0; i < n; i++) host.step(1 / 30);
  };
  sail = () => {};
  step(2);
  me.teleport({ x: 1.5, y: 82, z: 2.5 });
  const dummy = g.entities.spawn('dummy', { x: -2.5, y: 82, z: -3.5 });
  const gem = g.items.spawnPickup('gem', { x: 4.5, y: 83, z: 6.5 }, { despawn: 1e9 });
  step(30);
  check(me.onGround && Math.abs(me.position.y - 80) < 0.05, `Ann stands on the deck: ${JSON.stringify(me.position)}`);
  check(me.riding === deck && dummy.riding === deck, 'both ride it');

  // It sails east at 5 blocks a second, turning a quarter turn every 4 seconds, and bobs.
  const start = g.clock.now;
  sail = (t, d) => {
    const s = t - start;
    d.position.set(5 * s, 80 + Math.sin(s * 2) * 0.5, 0);
    d.quaternion.setFromAxisAngle({ x: 0, y: 1, z: 0 } as never, (s * Math.PI) / 8);
  };
  step(90);
  const local = (p: { x: number; y: number; z: number }) => {
    const v = { x: p.x - deck.position.x, y: p.y - deck.position.y, z: p.z - deck.position.z };
    const a = -(g.clock.now - start) * (Math.PI / 8);
    return { x: v.x * Math.cos(a) + v.z * Math.sin(a), y: v.y, z: -v.x * Math.sin(a) + v.z * Math.cos(a) };
  };
  const l = local(me.position);
  check(Math.abs(l.x - 1.5) < 0.05 && Math.abs(l.z - 2.5) < 0.05 && Math.abs(l.y) < 0.05, `Ann stayed put on the turning, bobbing deck: ${JSON.stringify(l)}`);
  const ld = local(dummy.position);
  check(Math.abs(ld.x + 2.5) < 0.3 && Math.abs(ld.z + 3.5) < 0.3, `so did the dummy: ${JSON.stringify(ld)}`);
  check(me.riding === deck && dummy.riding === deck, 'still riding');
  const lg = local(gem.position);
  check(gem.alive && Math.abs(lg.x - 4.5) < 0.05 && Math.abs(lg.z - 6.5) < 0.05 && Math.abs(lg.y - 0.3) < 0.05, `the gem dropped on deck rode along: ${JSON.stringify(lg)}`);

  // Rays and lines of sight stop at it.
  const below = { x: deck.position.x, y: 70, z: deck.position.z };
  const above = { x: deck.position.x, y: 90, z: deck.position.z };
  check(!g.world.lineOfSight(below, above), 'no line of sight through the deck');
  const hit = g.props.raycast(above, { x: 0, y: -1, z: 0 }, 30);
  check(hit?.prop === deck && Math.abs(hit.distance - (90 - deck.position.y)) < 0.02, `props.raycast finds the deck top: ${hit?.distance} (top at ${deck.position.y})`);

  // It sinks away: Ann is left standing on the flat ground (riding nothing), the deck gone from under her.
  sail = (t, d) => d.position.set(d.position.x, 80 - (t - start) * 8, d.position.z);
  me.teleport({ x: 20.5, y: 65, z: 10.5 });
  step(30);
  check(me.riding === null && me.onGround, 'on the ground, riding nothing');

  // A solid wall driven into her shoves her along (over ground cleared of trees).
  for (let x = 28; x < 48; x++) for (let z = -4; z <= 4; z++) for (let y = 64; y < 72; y++) g.world.setBlock(x, y, z, 'air');
  const wallStart = g.clock.now;
  me.teleport({ x: 32.5, y: 65, z: 0.5 });
  step(10);
  sail = (t) => wall.position.set(30 + (t - wallStart) * 4, 65, 0);
  step(45);
  check(me.position.x > wall.position.x + 1.25, `pushed along by the wall: Ann at ${me.position.x.toFixed(2)}, wall face at ${(wall.position.x + 1).toFixed(2)}`);
  deck.remove();
  check(me.riding === null, 'nothing to ride once it is gone');
  console.log('  stood, rode a turning bobbing deck (with a creature), stopped rays, got shoved by a wall');
}

/**
 * Prediction aboard: a client walks around a deck that sails and turns, predicting on its own
 * copy of the world with its own copy of the deck, and gets the server's frames 100 ms late.
 * Measured on the deck, the server's word should barely move it.
 */
function predicting() {
  const host = new GameHost(game, { engine, seed: 9, remote: true, radius: 4, budget: Infinity });
  const registry = loadRegistry();
  const resolve = (b: BlockRef) => (typeof b === 'number' ? b : registry.byName.get(b)!.id);
  const mine = new GeneratedWorld(host.seed, worldGenConfig(game, resolve));
  const ann = host.connect('Ann');
  const content = new Content();
  for (const e of ann.batch.events) if (e.t === 'content') content.apply(e.def);
  host.command(ann.id, { t: 'start' });
  const me = host.sim.players[0];
  const predictor = new Predictor(mine.world);
  const movers = new ClientMovers(mine.world, content, registry, resolve);
  sail = () => {};
  const late: HostBatch[] = [];
  let worst = 0;
  let sum = 0;
  let n = 0;
  let aboard = 0;
  for (let frame = 0; frame < 60 * 12; frame++) {
    mine.update([me.state], 4, Infinity);
    if (frame === 10) {
      me.api.teleport({ x: 0.5, y: 81, z: 0.5 });
      const t0 = host.sim.ctx.clock.now;
      sail = (t, d) => {
        const s = Math.max(0, t - t0 - 1);
        d.position.set(6 * s, 80 + Math.sin(s) * 0.4, 0);
        d.quaternion.setFromAxisAngle({ x: 0, y: 1, z: 0 } as never, s * 0.3);
      };
    }
    const t = frame / 60;
    const input: PlayerInput = {
      active: true,
      down: frame % 180 < 120 ? ['KeyW'] : frame % 180 < 130 ? ['Space'] : [],
      pressed: frame % 180 === 120 ? ['Space'] : [],
      buttons: 0,
      clicked: 0,
      mouseX: 0,
      mouseY: 0,
      wheel: 0,
      // Round and round in a small circle on the deck.
      yaw: t * 3,
      pitch: 0,
      viewSeq: me.viewSeq,
    };
    predictor.step(input, 1 / 60, frame + 1);
    host.command(ann.id, { t: 'input', input, seq: frame + 1, dt: 1 / 60 });
    if (frame % 2 === 1) {
      late.push(host.step(1 / 30).get(ann.id)!);
      if (late.length > 3) {
        const b = late.shift()!;
        for (const e of b.events) if (e.t === 'content') content.apply(e.def);
        const f = b.frame!;
        movers.sync(f.props, f.clock);
        predictor.reconcile(f.players.find((p) => p.id === me.id)!);
        const shown = predictor.shown();
        if (frame > 150 && shown?.ride) {
          aboard++;
          worst = Math.max(worst, predictor.lastCorrection);
          sum += predictor.lastCorrection;
          n++;
        }
      }
    }
  }
  console.log(`  12 s walking and jumping about a sailing, turning deck with 100 ms latency: ${aboard} frames aboard, corrections average ${(sum / n).toFixed(5)}, worst ${worst.toFixed(5)} blocks (on the deck)`);
  check(aboard > 250, `stayed aboard: ${aboard}`);
  check(worst < 0.05, `prediction aboard drifted: worst correction ${worst}`);
}
