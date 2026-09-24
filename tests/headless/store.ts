import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GameHost } from '../../src/platform/host/game';
import { SqliteStore } from '../../src/platform/host/sqlite';
import { check, games } from './_harness';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');
const game = (id: string) => games.find((g) => g.id === id)!;

/**
 * Kept across restarts, in SQLite: a Sandbox server's world (seed, builds, time of day), each
 * player's place by name, and the game's own data; Bed Wars' all-time stats per player.
 */
export default function store() {
  const dir = mkdtempSync(join(tmpdir(), 'voxel-store-'));
  try {
    sandbox(join(dir, 'sandbox.sqlite'));
    bedwars(join(dir, 'bedwars.sqlite'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function sandbox(path: string) {
  // First run: Ann builds a little tower, flies up beside it and leaves; the game notes a visit.
  let db = SqliteStore.open(path, 'sandbox');
  let host = new GameHost(game('sandbox'), { engine: wasm, seed: 777, remote: true, radius: 3, budget: Infinity, store: db });
  let ann = host.connect('Ann');
  host.command(ann.id, { t: 'start' });
  for (let i = 0; i < 5; i++) host.step(1 / 30);
  const p = host.sim.players[0];
  const x = Math.floor(p.state.x) + 3;
  const z = Math.floor(p.state.z) + 3;
  const top = host.sim.surfaceY(x, z);
  for (let y = top + 1; y <= top + 4; y++) check(host.sim.placeBlockAt(x, y, z, 'glowstone', p.api), `placing at ${y}`);
  host.sim.env.time = 0.8;
  p.allowFlight = true;
  host.world.world.set_flying(p.slot, true);
  p.api.teleport({ x: x + 1.5, y: top + 6, z: z + 0.5 }, 1.25, -0.4);
  host.step(1 / 30);
  host.sim.ctx.store.set('visits', { Ann: 1 });
  const where = { x: p.state.x, y: p.state.y, z: p.state.z };
  host.disconnect(ann.id);
  host.persist();
  db.close();

  // A new server on the same database: the same world, and Ann where she was.
  db = SqliteStore.open(path, 'sandbox');
  const kept = db.world();
  check(kept?.seed === 777 && kept.edits !== null, `the world is kept: ${JSON.stringify({ seed: kept?.seed, edits: kept?.edits?.length })}`);
  host = new GameHost(game('sandbox'), { engine: wasm, seed: kept!.seed, remote: true, radius: 3, budget: Infinity, store: db });
  ann = host.connect('Ann');
  const w = host.sim.ctx.world;
  const tower = [1, 2, 3, 4].map((dy) => w.blockName(w.getBlock(x, top + dy, z)));
  check(tower.every((b) => b === 'glowstone'), `the tower is back: ${tower}`);
  const q = host.sim.players[0];
  check(Math.hypot(q.state.x - where.x, q.state.y - where.y, q.state.z - where.z) < 0.01 && Math.abs(q.yaw - 1.25) < 1e-9, `Ann is where she left: ${q.state.x},${q.state.y},${q.state.z} yaw ${q.yaw}`);
  check(Math.abs(host.sim.env.time - 0.8) < 0.01, `time of day kept: ${host.sim.env.time}`);
  check((host.sim.ctx.store.get<{ Ann: number }>('visits')?.Ann ?? 0) === 1, 'game.store kept');
  // Someone new starts at the spawn.
  host.connect('Bob');
  const bob = host.sim.players[1];
  check(Math.hypot(bob.state.x - q.state.x, bob.state.z - q.state.z) > 1, 'Bob starts at the spawn');
  db.close();

  // A database belongs to its game.
  let wrong = '';
  try {
    SqliteStore.open(path, 'bedwars');
  } catch (err) {
    wrong = (err as Error).message;
  }
  check(wrong.includes('holds a sandbox world'), `opening it for another game fails: ${wrong}`);
  console.log(`  sandbox: seed, a 4-block tower, time of day, Ann's place and game data survived a restart`);
}

function bedwars(path: string) {
  let db = SqliteStore.open(path, 'bedwars');
  const run = () => {
    const host = new GameHost(game('bedwars'), { engine: wasm, seed: 1, remote: true, radius: 4, budget: Infinity, cheats: true, store: db });
    const ann = host.connect('Ann');
    host.command(ann.id, { t: 'start' });
    for (let i = 0; i < 5; i++) host.step(1 / 30);
    host.command(ann.id, { t: 'exec', id: 1, line: 'bw win' });
    for (let i = 0; i < 70; i++) host.step(1 / 30);
    host.persist();
  };
  run();
  db.close();
  db = SqliteStore.open(path, 'bedwars');
  run();
  const stats = db.data().get('stats:Ann') as { games: number; wins: number } | undefined;
  check(stats?.games === 2 && stats.wins === 2, `Ann's all-time stats across two servers: ${JSON.stringify(stats)}`);
  db.close();
  console.log(`  bedwars: all-time stats per player kept (${JSON.stringify(stats)})`);
}
