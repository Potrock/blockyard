import { readFileSync } from 'node:fs';
import { GameHost } from '../../src/platform/host/game';
import type { HostBatch } from '../../src/platform/net/protocol';
import type { Game } from '../../src/games/blockilization/rules/state';
import { botTurn } from '../../src/games/blockilization/rules/ai';
import { seasonOf } from '../../src/games/blockilization/rules/disasters';
import { games } from './_harness';
import { devGames } from '../../src/games/server';

/**
 * Probe: what a Blockilization room costs as a game goes on, on the server and on a screen. One
 * person (their civ played by the bots' own rules, so it grows as a bot's would) and bots on a map
 * (`SIZE`, default small; `SPEED`, default quick; `DISASTERS=0` for none), played `TURNS` turns
 * (default 60), each turn ended as soon as the bots have played, then `SETTLE` seconds (default 3)
 * of the room running on. Each turn it prints the server's ticks (sum, worst), what the screen was
 * sent (bytes, blocks set and the edits events they came in) and the season; and the chunks the
 * screen meshes again for those blocks (in all, and in its worst tick), against what it would if
 * each block came by itself (as the living world's seasons, floods and rising sea once sent them:
 * a screen copies out and meshes each chunk round every one). A mesh is about 0.05 ms of the
 * screen's main thread and a millisecond or two of a worker's.
 * `node scripts/headless.mjs tests/headless/_civ-perf.ts` (add `node --cpu-prof` to find the hot spots).
 */
export default async function civPerf() {
  const def = [...games, ...(await devGames())].find((g) => g.id === 'blockilization')!;
  const host = new GameHost(def, { engine: readFileSync('engine/pkg/voxel_engine_bg.wasm'), seed: 7, remote: true, radius: 8, budget: 4, cheats: true, player: { id: 'p1', name: 'Player' } });
  const civ = (globalThis as unknown as { __civ: { game: () => Game | null; phase: () => string } }).__civ;
  const turns = Number(process.env.TURNS ?? 60);
  const settle = Number(process.env.SETTLE ?? 3);
  type Cell = [number, number, number, number];
  type Tally = { ticks: number; ms: number; worst: number; bytes: number; cells: number; editEvents: number; meshes: number; oneByOne: number; worstMeshes: number; views: number };
  const fresh = (): Tally => ({ ticks: 0, ms: 0, worst: 0, bytes: 0, cells: 0, editEvents: 0, meshes: 0, oneByOne: 0, worstMeshes: 0, views: 0 });
  /** The columns a screen meshes again for a block set by itself (`ChunkManager.remeshNear`: those whose light it could change). */
  const remeshNear = ([x, , z]: Cell) => {
    let n = 0;
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const [x0, x1, z0, z1] = [(cx + dx) * 16 - 1, (cx + dx) * 16 + 16, (cz + dz) * 16 - 1, (cz + dz) * 16 + 16];
        if (Math.max(x0 - x, 0, x - x1) + Math.max(z0 - z, 0, z - z1) <= 15) n++;
      }
    return n;
  };
  /** The columns a screen meshes again for blocks that come together (`remeshAround`: each one touched and those round it, once). */
  const remeshAround = (cells: Cell[]) => {
    const seen = new Set<string>();
    for (const [x, , z] of cells) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) seen.add(`${Math.floor(x / 16) + dx},${Math.floor(z / 16) + dz}`);
    return seen.size;
  };
  /** What a screen meshes for a batch's blocks (`mirrorEdits`, a run of edits events with nothing between taken together: `runtime.ts`). */
  const meshesFor = (b: HostBatch) => {
    let n = 0;
    let run: Cell[] = [];
    const end = () => {
      n += run.length === 1 ? remeshNear(run[0]) : run.length ? remeshAround(run) : 0;
      run = [];
    };
    for (const e of b.events) {
      if (e.t === 'edits') for (const c of e.cells) run.push(c);
      else end();
    }
    end();
    return n;
  };
  let tally = fresh();
  let me = '';
  const step = (seconds = 1 / 30) => {
    for (let t = 0; t < seconds; t += 1 / 30) {
      const t0 = performance.now();
      const out: Map<string, HostBatch> = host.step(1 / 30);
      const ms = performance.now() - t0;
      tally.ticks++;
      tally.ms += ms;
      tally.worst = Math.max(tally.worst, ms);
      const b = out.get(me);
      if (!b) continue;
      for (const e of b.events) {
        if (e.t === 'edits') {
          tally.editEvents++;
          tally.cells += e.cells.length;
          for (const c of e.cells) tally.oneByOne += remeshNear(c);
        } else if (e.t === 'call' && (e.call.method === 'view' || e.call.method === 'viewPart')) tally.views++;
      }
      const meshes = meshesFor(b);
      tally.meshes += meshes;
      tally.worstMeshes = Math.max(tally.worstMeshes, meshes);
      tally.bytes += JSON.stringify(b.events).length;
    }
  };
  const send = (name: string, data: unknown) => {
    host.command(me, { t: 'message', msg: { t: 'game', player: me, name, data } });
    step(2 / 30);
  };

  me = host.connect('Ann').id;
  host.command(me, { t: 'start' });
  // (A screen says how far it draws: the game's view distance. The server loads the world that far round.)
  host.command(me, { t: 'radius', columns: 16 });
  step(0.5);
  send('lobby', { a: 'settings', size: process.env.SIZE ?? 'small', speed: process.env.SPEED ?? 'quick', disasters: process.env.DISASTERS !== '0' });
  send('lobby', { a: 'start' });
  const t0 = performance.now();
  tally = fresh();
  for (let i = 0; i < 2000 && civ.phase() !== 'playing'; i++) step(0.5);
  console.log(`built in ${((performance.now() - t0) / 1000).toFixed(1)} s: ${tally.ticks} ticks, ${tally.cells} blocks in ${tally.editEvents} edit events`);
  const g = civ.game()!;
  const ann = g.players.find((p) => p.name === 'Ann')!;
  // Where the screen looks: the middle of the map (as it first does).
  step(settle);
  console.log('turn season    ticks  sum ms  worst ms  sent KB  blocks  edit events  chunk meshes  worst a tick  one by one  views');
  for (let n = 0; n < turns && !g.over; n++) {
    tally = fresh();
    const turn = g.turn;
    if (ann.alive) botTurn(g, ann);
    send('order', { t: 'ready', ready: true });
    for (let i = 0; i < 600 && g.turn === turn; i++) step(0.1);
    step(settle);
    const t = tally;
    console.log(`${String(g.turn).padStart(4)} ${seasonOf(g).padEnd(7)} ${String(t.ticks).padStart(6)} ${t.ms.toFixed(0).padStart(7)} ${t.worst.toFixed(1).padStart(9)} ${(t.bytes / 1024).toFixed(0).padStart(8)} ${String(t.cells).padStart(7)} ${String(t.editEvents).padStart(12)} ${String(t.meshes).padStart(13)} ${String(t.worstMeshes).padStart(13)} ${String(t.oneByOne).padStart(11)} ${String(t.views).padStart(6)}`);
  }
}
