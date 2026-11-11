import { readFileSync } from 'node:fs';
import { GameHost } from '../../src/platform/host/game';
import type { PlayerInput } from '../../src/platform/net/protocol';
import { check, games } from './_harness';

const walk = (viewSeq: number): PlayerInput => ({ active: true, down: ['KeyW'], pressed: [], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: 0, viewSeq });

/** A fresh sandbox with one player in it, and how far they've gone from where they started. */
function room() {
  const def = games.find((g) => g.id === 'sandbox')!;
  const host = new GameHost(def, { engine: readFileSync('engine/pkg/voxel_engine_bg.wasm'), seed: 4242, remote: true, radius: 3, budget: Infinity });
  const ann = host.connect('Ann');
  host.command(ann.id, { t: 'start' });
  const me = host.sim.players[0];
  // (High in the air: nothing in the way of walking on, for as long as this takes.)
  me.api.teleport({ x: me.state.x, y: 250, z: me.state.z });
  const from = { x: me.state.x, z: me.state.z };
  /** How far they've gone by now; or (`settled`) once the inputs still waiting have played out, the client sending no more. */
  const gone = (settled = false) => {
    for (let i = 0; settled && i < 30 * 12; i++) host.step(1 / 30);
    return Math.hypot(me.state.x - from.x, me.state.z - from.z);
  };
  return { host, id: ann.id, me, gone };
}

/**
 * A player moves as far as the server's time allows, whatever their client sends: one that says
 * each of its inputs lasted longer than it did, and sends more of them than there were frames,
 * goes no faster than one that plays fair. And a fair client that fell behind while the server
 * stalled (its inputs for that time all arriving at once) is still caught up at once.
 */
export default function speedhack() {
  const SECONDS = 3;
  // Fair: 60 inputs a second, each a 60th, the server stepping 30 times a second.
  const fair = room();
  let seq = 0;
  for (let step = 0; step < 30 * SECONDS; step++) {
    for (let k = 0; k < 2; k++) fair.host.command(fair.id, { t: 'input', input: walk(fair.me.viewSeq), seq: ++seq, dt: 1 / 60 });
    fair.host.step(1 / 30);
  }
  const fairNow = fair.gone();
  const honest = fair.gone(true);
  check(honest > 2, `a fair client walks (${honest.toFixed(1)} blocks in ${SECONDS} s)`);

  // Cheating: ten inputs a step (the most the server's message limit lets through), each claiming a tenth of a second.
  const cheat = room();
  seq = 0;
  for (let step = 0; step < 30 * SECONDS; step++) {
    for (let k = 0; k < 10; k++) cheat.host.command(cheat.id, { t: 'input', input: walk(cheat.me.viewSeq), seq: ++seq, dt: 0.1 });
    cheat.host.step(1 / 30);
  }
  const cheated = cheat.gone();
  check(cheated < fairNow * 1.25, `a client claiming thirty seconds of movement a second goes no faster: ${cheated.toFixed(1)} blocks against a fair ${fairNow.toFixed(1)}`);

  // The server stalls for a second and a half (its step loses the time; the client walked on): the
  // inputs for that time arrive together, and they're caught up at once, as far as a fair walk goes.
  const stalled = room();
  seq = 0;
  const run = (steps: number) => {
    for (let step = 0; step < steps; step++) {
      for (let k = 0; k < 2; k++) stalled.host.command(stalled.id, { t: 'input', input: walk(stalled.me.viewSeq), seq: ++seq, dt: 1 / 60 });
      stalled.host.step(1 / 30);
    }
  };
  run(30);
  for (let k = 0; k < 90; k++) stalled.host.command(stalled.id, { t: 'input', input: walk(stalled.me.viewSeq), seq: ++seq, dt: 1 / 60 });
  stalled.host.step(0.1, true, 1.5);
  run(30 * SECONDS - 30 - 45);
  const caught = stalled.gone(true);
  check(Math.abs(caught - honest) < honest * 0.05, `a fair client is caught up after the server stalls: ${caught.toFixed(1)} blocks against ${honest.toFixed(1)}`);
  console.log(`  a fair client ${fairNow.toFixed(1)} blocks in ${SECONDS} s · one claiming 30x the time ${cheated.toFixed(1)} · caught up after a 1.5 s stall (${caught.toFixed(1)})`);
}
