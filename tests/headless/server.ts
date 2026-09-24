import { readFileSync } from 'node:fs';
import { serveGame } from '../../src/platform/host/server';
import { decode, encode } from '../../src/platform/net/codec';
import type { ClientCommand, ServerWelcome, TimedBatch } from '../../src/platform/net/protocol';
import { check, games } from './_harness';

/** A client as the browser is one: a socket, the welcome, then batches; it sends commands. */
async function join(port: number, name: string) {
  const ws = new WebSocket(`ws://localhost:${port}/?name=${name}`);
  const batches: TimedBatch[] = [];
  const welcome = await new Promise<ServerWelcome>((resolve, reject) => {
    ws.onerror = () => reject(new Error('socket error'));
    ws.onmessage = (e) => {
      const m = decode<ServerWelcome | TimedBatch>(String(e.data));
      if ('t' in m && m.t === 'welcome') resolve(m);
      else batches.push(m as TimedBatch);
    };
  });
  return {
    welcome,
    batches,
    send: (c: ClientCommand) => ws.send(encode(c)),
    me: () => batches.at(-1)?.frame?.players.find((p) => p.id === welcome.player),
    close: () => ws.close(),
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The game server over real sockets: two players join Sandbox, see each other, one walks and builds. */
export default async function server() {
  const def = games.find((g) => g.id === 'sandbox')!;
  const srv = await serveGame(def, { port: 0, seed: 9, wasm: readFileSync('engine/pkg/voxel_engine_bg.wasm'), tickRate: 30 });
  try {
    const ann = await join(srv.port, 'Ann');
    const bob = await join(srv.port, 'Bob');
    check(ann.welcome.game === 'sandbox' && ann.welcome.seed === srv.host('sandbox')!.seed && ann.welcome.player === 'p1' && bob.welcome.player === 'p2', `welcomes: ${JSON.stringify([ann.welcome, bob.welcome])}`);
    ann.send({ t: 'start' });
    bob.send({ t: 'start' });
    await wait(300);
    const b0 = bob.me()!;
    const names = ann.batches.at(-1)!.frame!.players.map((p) => p.name).join();
    check(names === 'Ann,Bob', `Ann sees both players: ${names}`);
    // Bob holds W for a second (inputs flow at the client's frame rate).
    for (let i = 0; i < 30; i++) {
      bob.send({ t: 'input', input: { active: true, down: ['KeyW'], pressed: [], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: Math.PI / 2, pitch: 0, viewSeq: b0.view.seq } });
      await wait(33);
    }
    await wait(150);
    const bobSeenByAnn = ann.batches.at(-1)!.frame!.players.find((p) => p.id === 'p2')!;
    const moved = Math.hypot(bobSeenByAnn.x - b0.x, bobSeenByAnn.z - b0.z);
    check(moved > 0.5, `Ann saw Bob walk: ${moved.toFixed(2)}`);
    // Bob runs a command; only Bob gets the answer.
    bob.send({ t: 'exec', id: 1, line: 'help' });
    await wait(150);
    const answered = (c: typeof ann) => c.batches.some((b) => b.events.some((e) => e.t === 'reply'));
    check(answered(bob) && !answered(ann), 'the reply went to Bob only');
    const times = ann.batches.map((b) => b.time);
    const rate = (times.length - 1) / (times.at(-1)! - times[0]);
    console.log(`  2 players over sockets · ${ann.batches.length} batches to Ann at ${rate.toFixed(0)}/s of host time · Bob walked ${moved.toFixed(1)} blocks`);
    bob.close();
    await wait(200);
    check(srv.host('sandbox')?.connected === 1, `Bob's leaving was noticed: ${srv.host('sandbox')?.connected}`);
    ann.close();
  } finally {
    await srv.close();
  }
}
