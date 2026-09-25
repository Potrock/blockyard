import { readFileSync } from 'node:fs';
import { defineGame } from '../../src/platform';
import { GameHost } from '../../src/platform/host/game';
import type { PlayerInput } from '../../src/platform/net/protocol';
import { check } from './_harness';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');

/** A yard with two guns and no reloading by itself; whoever joins as "Late" is frozen as they join. */
const yard = defineGame({
  id: 'yard',
  title: 'Yard',
  world: { terrain: 'void', ground: { y: 40 }, spawn: { x: 0.5, y: 41, z: 0.5 }, time: 0.5, freezeTime: true },
  player: { health: 100, hotbar: 'items' },
  guns: { autoReload: false },
  setup(game) {
    const still = { spread: { hip: 0, aim: 0, move: 0, air: 0, bloom: 0 }, recoil: { up: 0, side: 0 } };
    game.items.define('pistol', { kind: 'gun', name: 'Pistol', icon: 'iron_sword', rpm: 300, damage: 10, magazine: 6, reserve: 30, reload: 0.5, ...still });
    game.items.define('rifle', { kind: 'gun', name: 'Rifle', icon: 'iron_sword', rpm: 600, auto: true, damage: 10, magazine: 20, reload: 1, ...still });
    game.events.on('playerJoin', ({ player }) => {
      if (player.name === 'Late') player.freeze(true, { weapons: true });
    });
  },
});

/**
 * Freezing: `freeze(true, { weapons: true })` locks a player's weapons with their body (no
 * switching, reloading or firing, and the shots their screen sends anyway are refused, no rounds
 * spent), a plain freeze leaves them free, and the lock ends with the freeze. `player.frozen` and
 * `player.reloading` say how they are; a freeze as they join holds when they press Play. And the
 * clocks: a restart puts `clock.now` back to 0, and `clock.total` runs on.
 */
export default function freeze() {
  const host = new GameHost(yard, { engine: wasm, seed: 1, remote: true, radius: 2, budget: Infinity, player: { id: 'p1', name: 'Ann' } });
  const ann = host.connect('Ann');
  host.command(ann.id, { t: 'start' });
  const sim = host.sim;
  const A = sim.players.find((p) => p.id === ann.id)!;
  const a = A.api;
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) host.step(1 / 30);
  };
  step(10);
  a.inventory.give('pistol');
  a.inventory.give('rifle');
  a.inventory.select(0);
  step(15);
  const heard = { shots: 0 };
  sim.ctx.events.on('shot', () => heard.shots++);
  const shots = () => heard.shots;
  let serial = 0;
  /** One step of Ann's controls: a shot her screen fired (and the click), and keys pressed. */
  const act = (o: { fire?: boolean; pressed?: string[] } = {}) => {
    const input: PlayerInput = { active: true, down: [...(o.pressed ?? [])], pressed: o.pressed ?? [], buttons: o.fire ? 1 : 0, clicked: o.fire ? 1 : 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: 0, viewSeq: A.viewSeq, shots: o.fire ? [[++serial, 0, 0, 0]] : [] };
    host.command(ann.id, { t: 'input', input });
    step();
    // (Held keys let go.)
    host.command(ann.id, { t: 'input', input: { ...input, down: [], pressed: [], buttons: 0, clicked: 0, shots: [] } });
    step(8);
  };
  const mag = () => a.inventory.ammo('pistol')!.magazine;
  const frame = () => sim.frame().players.find((p) => p.id === a.id)!;

  // Locked: nothing answers, nothing is spent.
  a.freeze(true, { weapons: true });
  check(a.frozen && frame().locked, `frozen and locked: ${a.frozen}, ${frame().locked}`);
  act({ fire: true });
  act({ fire: true, pressed: ['Digit2'] });
  act({ pressed: ['KeyR'] });
  check(shots() === 0 && mag() === 6, `a locked gun fired nothing and spent nothing: ${shots()} shots, ${mag()} rounds`);
  check(a.inventory.selected === 0 && !a.reloading, `no switching or reloading while locked: slot ${a.inventory.selected}, reloading ${a.reloading}`);

  // Frozen alone: the weapons are free (as a plain freeze always was).
  a.freeze(true);
  act({ fire: true });
  check(a.frozen && !frame().locked && shots() === 1 && mag() === 5, `a plain freeze leaves the gun working: ${shots()} shots, ${mag()} rounds`);

  // Let go: free, and reloading shows.
  a.freeze(false);
  act({ fire: true });
  check(!a.frozen && shots() === 2 && mag() === 4, `free again: ${shots()} shots, ${mag()} rounds`);
  host.command(ann.id, { t: 'input', input: { active: true, down: ['KeyR'], pressed: ['KeyR'], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: 0, viewSeq: A.viewSeq, shots: [] } });
  step();
  const reloading = a.reloading;
  step(30);
  check(reloading && !a.reloading && mag() === 6, `player.reloading while the rounds go in, then full: ${reloading}, ${a.reloading}, ${mag()}`);

  // The lock ends with the freeze: a revive lets them go, and the gun with them.
  a.freeze(true, { weapons: true });
  a.revive();
  act({ fire: true });
  check(!a.frozen && !frame().locked && shots() === 3, `a revive ends the freeze and its lock: ${shots()} shots`);

  // Frozen as they joined (before they pressed Play): still frozen, and locked, once in play.
  const late = host.connect();
  host.command(late.id, { t: 'start', name: 'Late' });
  step();
  const L = sim.players.find((p) => p.name === 'Late')!;
  check(L.api.frozen && L.weaponsLocked, `a freeze at playerJoin holds through Play: frozen ${L.api.frozen}, locked ${L.weaponsLocked}`);

  // The clocks: the match's back to 0 on a restart, all the game's time runs on.
  const now = sim.ctx.clock.now;
  const total = sim.ctx.clock.total;
  check(now > 1 && Math.abs(total - now) < 1e-9, `before a restart the clocks agree: ${now.toFixed(2)}, ${total.toFixed(2)}`);
  sim.ctx.restart();
  check(sim.ctx.clock.now === 0 && sim.ctx.clock.total === total, `a restart: now ${sim.ctx.clock.now}, total ${sim.ctx.clock.total.toFixed(2)}`);
  check(!L.api.frozen && !L.weaponsLocked, 'a restart lets everyone go');
  step(30);
  check(Math.abs(sim.ctx.clock.now - 1) < 1e-6 && Math.abs(sim.ctx.clock.total - total - 1) < 1e-6, `both run on together: ${sim.ctx.clock.now.toFixed(2)}, ${sim.ctx.clock.total.toFixed(2)}`);
  console.log(`  locked: 0 of 3 shots, no switch or reload; a plain freeze fired; ${shots()} shots in all; frozen at join held through Play; clock.now back to 0 on restart, clock.total ${sim.ctx.clock.total.toFixed(1)} s`);
}
